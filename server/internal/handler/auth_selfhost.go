package handler

// 本文件是 selfhost 定制层（与上游 auth.go 解耦，便于同步原始仓库）：
// 非 code 认证模式（passwordless / password）的类型、开关与直登实现。
// 上游 auth.go 仅在 SendCode 中保留一处分派调用，其余零改动。
//
// 认证模式总开关：code（默认，上游原生验证码）/ passwordless（输邮箱即
// 登录）/ password（固定密码，用 `multica user set-password` 生成）。
// 与 MULTICA_AUTH_PASSWORDLESS 的关系：AUTH_MODE 显式取值优先；未设时
// 旧开关 =true 等价 passwordless（兼容期）。production 下一律回退 code。

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/logger"
	obsmetrics "github.com/multica-ai/multica/server/internal/metrics"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// 无码直登环境变量开关（legacy，见 currentAuthMode）
const passwordlessAuthEnv = "MULTICA_AUTH_PASSWORDLESS"

const authModeEnv = "MULTICA_AUTH_MODE"

type authMode string

const (
	authModeCode         authMode = "code"
	authModePasswordless authMode = "passwordless"
	authModePassword     authMode = "password"
)

func currentAuthMode() authMode {
	if isProductionEnv() {
		return authModeCode
	}
	// 显式设置了 AUTH_MODE：只认合法值，拼错一律回落 code——
	// 不能落入 legacy 分支被残留的 PASSWORDLESS=true 接管，
	// 那会把配置错误静默升级成更宽松的无码直登。
	if raw, ok := os.LookupEnv(authModeEnv); ok && strings.TrimSpace(raw) != "" {
		switch authMode(strings.ToLower(strings.TrimSpace(raw))) {
		case authModePasswordless:
			return authModePasswordless
		case authModePassword:
			return authModePassword
		default:
			slog.Warn("auth: invalid MULTICA_AUTH_MODE value, falling back to code", "value", raw)
			return authModeCode
		}
	}
	// 未设 AUTH_MODE：兼容旧开关（=true 等价 passwordless）。
	if strings.EqualFold(strings.TrimSpace(os.Getenv(passwordlessAuthEnv)), "true") {
		return authModePasswordless
	}
	return authModeCode
}

// maybeDirectLogin 是上游 SendCode 的直登分派钩子：非 code 模式下处理
// 请求并返回 true（响应已写出）；code 模式返回 false，SendCode 继续
// 原生验证码流程。调用点须位于 signup 资格检查之后、rate limit 之前。
func (h *Handler) maybeDirectLogin(w http.ResponseWriter, r *http.Request, email, password string) bool {
	switch currentAuthMode() {
	case authModePasswordless:
		// 无码直登：输邮箱即登录（隧道即鉴权层的本地场景）。
		user, isNew, err := h.findOrCreateUser(r.Context(), email)
		if err != nil {
			h.writeDirectLoginError(w, r, err, email, "find_user")
			return true
		}
		if isNew {
			obsmetrics.RecordEvent(h.Analytics, h.Metrics, analytics.Signup(uuidToString(user.ID), user.Email, signupSourceFromRequest(r)))
		}
		h.issueAndRespond(w, r, user, "passwordless")
		return true
	case authModePassword:
		// 固定密码：bcrypt 校验通过后直登。不自动建号——凭据必须先由
		// 管理员用 `multica user set-password` 配置。
		user, ok := h.verifyUserPassword(w, r, email, password)
		if !ok {
			return true
		}
		h.issueAndRespond(w, r, user, "password")
		return true
	}
	return false
}

// writeDirectLoginError 统一翻译直登路径上 findOrCreateUser/issueJWT 的
// 错误（临时禁用 / signup 资格 / 内部错误），stage 用于日志定位。
func (h *Handler) writeDirectLoginError(w http.ResponseWriter, r *http.Request, err error, email, stage string) {
	if errors.Is(err, auth.ErrTemporarilyDisabledUser) {
		writeError(w, http.StatusForbidden, auth.TemporarilyDisabledUserError)
		return
	}
	var signupErr SignupError
	if errors.As(err, &signupErr) {
		writeError(w, http.StatusForbidden, signupErr.Error())
		return
	}
	slog.Warn("direct login failed", append(logger.RequestAttrs(r), "error", err, "email", email, "stage", stage)...)
	writeError(w, http.StatusInternalServerError, "failed to log in")
}

// issueAndRespond 签发 JWT、设置 HttpOnly auth + CSRF cookie（与
// VerifyCode 成功路径一致）并写出 LoginResponse。method 用于日志区分
// passwordless / password。
func (h *Handler) issueAndRespond(w http.ResponseWriter, r *http.Request, user db.User, method string) {
	tokenString, err := h.issueJWT(user)
	if err != nil {
		h.writeDirectLoginError(w, r, err, user.Email, "issue_jwt")
		return
	}
	if err := auth.SetAuthCookies(w, tokenString); err != nil {
		slog.Warn("failed to set auth cookies", "error", err)
	}
	slog.Info("user logged in ("+method+")", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", user.Email)...)
	writeJSON(w, http.StatusOK, LoginResponse{
		Token: tokenString,
		User:  h.userToResponse(user),
	})
}

// dummyPasswordHash 用于抹平认证时序：用户不存在 / 未设密码时也跑一次
// 等价的 bcrypt 比较，让"账号存在且已设密"无法通过响应耗时被测量区分。
// 进程启动时生成一次（~100ms），盐固定不影响安全性——比较必然失败。
var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("multica-timing-equalizer"), bcrypt.DefaultCost)

// verifyUserPassword 校验固定密码（MULTICA_AUTH_MODE=password）。
// 失败统一 401 "invalid email or password"——不区分用户不存在 / 未设
// 密码 / 密码错误，且各失败路径耗时一致，避免账号枚举（含时序侧信道）。
// bcrypt 计算本身 ~100ms/次构成天然减速；本模式面向本地/私网部署，
// 未叠加额外失败限流。
func (h *Handler) verifyUserPassword(w http.ResponseWriter, r *http.Request, email, password string) (db.User, bool) {
	const invalid = "invalid email or password"
	if password == "" {
		writeError(w, http.StatusUnauthorized, invalid)
		return db.User{}, false
	}
	user, err := h.Queries.GetUserByEmail(r.Context(), email)
	if err != nil || !user.PasswordHash.Valid {
		// 与真实失败路径跑同一次 bcrypt 比较，耗时不泄露账号状态。
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		writeError(w, http.StatusUnauthorized, invalid)
		return db.User{}, false
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(password)) != nil {
		writeError(w, http.StatusUnauthorized, invalid)
		return db.User{}, false
	}
	return user, true
}
