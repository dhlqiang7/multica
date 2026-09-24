package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/cobra"
	"golang.org/x/crypto/bcrypt"

	"github.com/multica-ai/multica/server/internal/cli"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// User namespace exists so the daemon-injected `## Requesting User` brief
// has a CLI surface a human can mirror without having to construct
// PATCH /api/me by hand. Today only profile-description is wired; future
// per-user knobs (e.g. preferred language) should land as further
// subcommands here rather than expand the verb surface elsewhere.

var userCmd = &cobra.Command{
	Use:   "user",
	Short: "Work with your user account",
}

var userSetPasswordCmd = &cobra.Command{
	Use:   "set-password <email>",
	Short: "Issue a random login password for a user (password auth mode)",
	Long: "服务端管理命令：为账号生成随机登录密码，bcrypt 哈希直接写入数据库。\n" +
		"须在能访问服务端数据库的主机上运行（设置 DATABASE_URL，与 self-host\n" +
		"后端同一连接串）。明文密码仅本次输出一次；重复执行覆盖旧密码。\n" +
		"登录形态由服务端 MULTICA_AUTH_MODE=password 开启。",
	Args: cobra.ExactArgs(1),
	RunE: runUserSetPassword,
}

var userProfileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Get or update your personal profile",
	Long: "Manage the personal profile that agents see when they start a run " +
		"on your behalf. The description is injected into the agent brief under " +
		"`## Requesting User`, so use it to share role, stack, and collaboration " +
		"preferences.",
}

var userProfileGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Show your current user profile",
	RunE:  runUserProfileGet,
}

var userProfileUpdateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update your user profile (currently: profile description)",
	Long: "Set the personal profile description that gets injected into agent " +
		"briefs as `## Requesting User`. Pass an empty value to clear it.\n\n" +
		"Pick the input mode that preserves your content:\n" +
		"  --description \"...\"          inline (decodes \\n / \\t escapes)\n" +
		"  --description-stdin           pipe a HEREDOC (preserves verbatim)\n" +
		"  --description-file <path>     read a UTF-8 file (Windows-safe)\n",
	RunE: runUserProfileUpdate,
}

func init() {
	userCmd.AddCommand(userProfileCmd)
	userCmd.AddCommand(userSetPasswordCmd)
	userProfileCmd.AddCommand(userProfileGetCmd)
	userProfileCmd.AddCommand(userProfileUpdateCmd)

	userProfileGetCmd.Flags().String("output", "table", "Output format: table or json")

	userProfileUpdateCmd.Flags().String("description", "", "New profile description (decodes \\n, \\r, \\t, \\\\; pipe via --description-stdin to preserve literal backslashes)")
	userProfileUpdateCmd.Flags().Bool("description-stdin", false, "Read description from stdin (preserves multi-line content verbatim)")
	userProfileUpdateCmd.Flags().String("description-file", "", "Read description from a UTF-8 file (preserves multi-line content verbatim; use this on Windows when stdin piping mangles non-ASCII bytes). The path must be inside the current working directory unless --allow-external-file is set.")
	userProfileUpdateCmd.Flags().Bool("allow-external-file", false, "Allow --description-file to read a path outside the current working directory. Off by default so a stale temp file from another run/environment can't be picked up (MUL-4252).")
	userProfileUpdateCmd.Flags().Bool("clear", false, "Clear the profile description (equivalent to --description \"\")")
	userProfileUpdateCmd.Flags().String("output", "table", "Output format: table or json")
}

func runUserProfileGet(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var me map[string]any
	if err := client.GetJSON(ctx, "/api/me", &me); err != nil {
		return fmt.Errorf("get user profile: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, me)
	}

	printUserProfileTable(os.Stdout, me)
	return nil
}

func runUserProfileUpdate(cmd *cobra.Command, _ []string) error {
	// `--clear` is its own flag (not "pass an empty string") because cobra's
	// default value for a Changed("") flag would otherwise be ambiguous with
	// "user typed `--description ""`". Keep both forms supported — the inline
	// empty string is what someone scripting bash would reach for.
	clearFlag, _ := cmd.Flags().GetBool("clear")
	desc, hasDesc, err := resolveTextFlag(cmd, "description")
	if err != nil {
		return err
	}

	if clearFlag && hasDesc {
		return fmt.Errorf("--clear cannot be combined with --description / --description-stdin / --description-file")
	}
	if !clearFlag && !hasDesc && !cmd.Flags().Changed("description") {
		return fmt.Errorf("nothing to update; pass --description, --description-stdin, --description-file, or --clear")
	}

	if clearFlag {
		desc = ""
	}

	body := map[string]any{"profile_description": desc}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var me map[string]any
	if err := client.PatchJSON(ctx, "/api/me", body, &me); err != nil {
		return fmt.Errorf("update user profile: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, me)
	}

	printUserProfileTable(os.Stdout, me)
	return nil
}

func printUserProfileTable(out *os.File, me map[string]any) {
	w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	defer w.Flush()

	fmt.Fprintf(w, "ID\t%s\n", strVal(me, "id"))
	fmt.Fprintf(w, "NAME\t%s\n", strVal(me, "name"))
	fmt.Fprintf(w, "EMAIL\t%s\n", strVal(me, "email"))
	desc := strVal(me, "profile_description")
	if desc == "" {
		desc = "(not set)"
	}
	fmt.Fprintf(w, "PROFILE DESCRIPTION\t%s\n", desc)
}

// runUserSetPassword 为账号生成 22 字符随机密码（16 字节熵，base64url），
// bcrypt 哈希入库，明文仅打印一次。直连数据库而不走 API：这是管理员
// 操作，服务端未提供（也不应提供）匿名可达的设密端点。
func runUserSetPassword(cmd *cobra.Command, args []string) error {
	email := strings.ToLower(strings.TrimSpace(args[0]))
	if email == "" {
		return fmt.Errorf("email is required")
	}

	// 错误信息刻意不带 dbURL 内容——连接串含数据库凭据
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL is required (run on the server host, same database as the backend)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()

	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("generate password: %w", err)
	}
	password := base64.RawURLEncoding.EncodeToString(raw)

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	n, err := db.New(pool).SetUserPasswordHash(ctx, db.SetUserPasswordHashParams{
		Email:        email,
		PasswordHash: string(hash),
	})
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("user %q not found", email)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "email:    %s\npassword: %s\nsaved:    bcrypt hash written (明文仅此一次，请立即保存)\n", email, password)
	return nil
}
