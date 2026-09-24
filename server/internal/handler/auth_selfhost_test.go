package handler

// selfhost 定制层测试（auth_selfhost.go）：认证模式分发 + 固定密码校验。
// 独立文件、独立 mock（不碰上游测试的 mockDB），同步上游零冲突。

import (
	"context"
	"github.com/jackc/pgx/v5/pgtype"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------------------
// currentAuthMode：模式分发（纯函数，t.Setenv 驱动）
// ---------------------------------------------------------------------------

func TestCurrentAuthMode(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		want authMode
	}{
		{"no env defaults to code", nil, authModeCode},
		{"explicit code", map[string]string{"MULTICA_AUTH_MODE": "code"}, authModeCode},
		{"explicit password", map[string]string{"MULTICA_AUTH_MODE": "password"}, authModePassword},
		{"explicit passwordless", map[string]string{"MULTICA_AUTH_MODE": "passwordless"}, authModePasswordless},
		{"case and whitespace tolerant", map[string]string{"MULTICA_AUTH_MODE": "  PASSWORD "}, authModePassword},
		{"invalid value falls back to code", map[string]string{"MULTICA_AUTH_MODE": "banana"}, authModeCode},
		// 关键回归：显式非法值不得落入 legacy 分支被 PASSWORDLESS=true
		// 接管——否则配置错误被静默升级成更宽松的无码直登。
		{
			"invalid explicit value is not rescued by legacy flag",
			map[string]string{"MULTICA_AUTH_MODE": "banana", "MULTICA_AUTH_PASSWORDLESS": "true"},
			authModeCode,
		},
		{"legacy flag true equals passwordless", map[string]string{"MULTICA_AUTH_PASSWORDLESS": "true"}, authModePasswordless},
		{"legacy flag case insensitive", map[string]string{"MULTICA_AUTH_PASSWORDLESS": "TRUE"}, authModePasswordless},
		{"legacy flag false stays code", map[string]string{"MULTICA_AUTH_PASSWORDLESS": "false"}, authModeCode},
		{"explicit mode wins over legacy flag", map[string]string{"MULTICA_AUTH_MODE": "password", "MULTICA_AUTH_PASSWORDLESS": "true"}, authModePassword},
		// production 硬回落：无论怎么配，一律 code。
		{"production forces code despite password mode", map[string]string{"APP_ENV": "production", "MULTICA_AUTH_MODE": "password"}, authModeCode},
		{"production forces code despite passwordless legacy", map[string]string{"APP_ENV": "Production", "MULTICA_AUTH_PASSWORDLESS": "true"}, authModeCode},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for k, v := range tt.env {
				t.Setenv(k, v)
			}
			got := currentAuthMode()
			if got != tt.want {
				t.Fatalf("currentAuthMode() = %q, want %q (env: %v)", got, tt.want, tt.env)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// verifyUserPassword：统一 401（防账号枚举）+ 正确密码放行
// ---------------------------------------------------------------------------

func TestVerifyUserPassword(t *testing.T) {
	const invalid = "invalid email or password"

	hashed, err := bcrypt.GenerateFromPassword([]byte("s3cret-pass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	setHash := pgtype.Text{String: string(hashed), Valid: true}
	noHash := pgtype.Text{}

	tests := []struct {
		name       string
		user       *db.User
		getErr     error
		password   string
		wantStatus int   // 0 = 成功（无 HTTP 错误写出）
		wantBody   bool  // 是否断言统一 401 文案
		wantOK     bool
	}{
		{"empty password is rejected", nil, nil, "", http.StatusUnauthorized, true, false},
		{"unknown user gets uniform 401", nil, pgx.ErrNoRows, "whatever", http.StatusUnauthorized, true, false},
		{"user without stored hash gets uniform 401", &db.User{Email: "a@x.com", PasswordHash: noHash}, nil, "whatever", http.StatusUnauthorized, true, false},
		{"wrong password gets uniform 401", &db.User{Email: "a@x.com", PasswordHash: setHash}, nil, "wrong", http.StatusUnauthorized, true, false},
		{"correct password passes", &db.User{Email: "a@x.com", PasswordHash: setHash}, nil, "s3cret-pass", 0, false, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(Config{})
			h.Queries = db.New(&selfhostDB{user: tt.user, getErr: tt.getErr})

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
			user, ok := h.verifyUserPassword(rec, req, "a@x.com", tt.password)

			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if tt.wantStatus == 0 {
				if rec.Code != http.StatusOK {
					t.Fatalf("success path should not write an error status, got %d", rec.Code)
				}
				if user.Email != "a@x.com" {
					t.Fatalf("returned user email = %q, want a@x.com", user.Email)
				}
				return
			}
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", tt.wantStatus, rec.Code)
			}
			if tt.wantBody && !strings.Contains(rec.Body.String(), invalid) {
				t.Fatalf("body %q must contain uniform message %q (anti-enumeration)", rec.Body.String(), invalid)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// maybeDirectLogin：password 模式端到端（分派 → 校验 → JWT 签发 → LoginResponse）
// ---------------------------------------------------------------------------

func TestMaybeDirectLoginPasswordEndToEnd(t *testing.T) {
	t.Setenv("MULTICA_AUTH_MODE", "password")
	hashed, err := bcrypt.GenerateFromPassword([]byte("s3cret-pass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	h := newTestHandler(Config{})
	h.Queries = db.New(&selfhostDB{user: &db.User{
		Email:        "root@localhost",
		PasswordHash: pgtype.Text{String: string(hashed), Valid: true},
	}})

	t.Run("correct credentials return LoginResponse", func(t *testing.T) {
		res := testutil.Call(t, func(w http.ResponseWriter, r *http.Request) {
			if h.maybeDirectLogin(w, r, "root@localhost", "s3cret-pass") != true {
				t.Fatal("password mode must handle the request (return true)")
			}
		}, httptest.NewRequest(http.MethodPost, "/auth/send-code", nil))
		res.Want(http.StatusOK)

		var body struct {
			Token string `json:"token"`
			User  struct {
				Email string `json:"email"`
			} `json:"user"`
		}
		res.JSON(&body)
		if body.Token == "" {
			t.Fatal("direct login must return a JWT token")
		}
		if body.User.Email != "root@localhost" {
			t.Fatalf("user.email = %q", body.User.Email)
		}
	})

	t.Run("wrong credentials get uniform 401 and short-circuit", func(t *testing.T) {
		res := testutil.Call(t, func(w http.ResponseWriter, r *http.Request) {
			if h.maybeDirectLogin(w, r, "root@localhost", "wrong") != true {
				t.Fatal("password mode must consume the request even on failure")
			}
		}, httptest.NewRequest(http.MethodPost, "/auth/send-code", nil))
		res.Want(http.StatusUnauthorized)
		if !strings.Contains(res.Text(), "invalid email or password") {
			t.Fatalf("body %q must contain uniform 401 message", res.Text())
		}
	})
}

// ---------------------------------------------------------------------------
// mock：仅实现 GetUserByEmail 路径（DBTX 最小面），独立于上游 mockDB
// ---------------------------------------------------------------------------

type selfhostDB struct {
	db.DBTX
	user   *db.User
	getErr error
}

func (m *selfhostDB) QueryRow(_ context.Context, sqlText string, _ ...interface{}) pgx.Row {
	if strings.HasPrefix(sqlText, "-- name: GetUserByEmail :one") {
		return &selfhostRow{user: m.user, err: m.getErr}
	}
	return &selfhostRow{err: fmt.Errorf("selfhostDB: unexpected query: %s", sqlText)}
}

// selfhostRow 按 GetUserByEmail 的 15 列序（user.sql.go Scan 顺序）回填。
type selfhostRow struct {
	err  error
	user *db.User
}

func (r *selfhostRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if r.user == nil {
		return pgx.ErrNoRows
	}
	u := r.user
	sources := []interface{}{
		&u.ID, &u.Name, &u.Email, &u.AvatarUrl, &u.CreatedAt, &u.UpdatedAt,
		&u.OnboardedAt, &u.OnboardingQuestionnaire, &u.CloudWaitlistEmail,
		&u.CloudWaitlistReason, &u.StarterContentState, &u.Language,
		&u.ProfileDescription, &u.Timezone, &u.PasswordHash,
	}
	if len(dest) != len(sources) {
		return fmt.Errorf("selfhostRow: expected %d destinations, got %d", len(sources), len(dest))
	}
	for i, src := range sources {
		dstVal := reflect.ValueOf(dest[i])
		if dstVal.Kind() != reflect.Ptr {
			return fmt.Errorf("selfhostRow: destination %d is %T, want pointer", i, dest[i])
		}
		dstVal.Elem().Set(reflect.ValueOf(src).Elem())
	}
	return nil
}
