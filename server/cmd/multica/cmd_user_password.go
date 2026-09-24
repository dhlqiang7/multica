package main

// selfhost 定制层：固定密码登录模式的密码管理子命令（与上游 cmd_user.go
// 解耦，便于同步原始仓库）。上游 cmd_user.go 零改动，本文件经 init() 把
// userSetPasswordCmd 挂到上游 userCmd 上。

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/cobra"
	"golang.org/x/crypto/bcrypt"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

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

func init() {
	userCmd.AddCommand(userSetPasswordCmd)
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
		PasswordHash: string(hash),
		Email:        email,
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
