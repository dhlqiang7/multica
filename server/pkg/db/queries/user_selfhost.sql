-- selfhost 定制层：固定密码登录模式（MULTICA_AUTH_MODE=password）。
-- 与上游 user.sql 解耦，便于同步原始仓库；密码由
-- `multica user set-password` 生成（bcrypt 哈希），空串写 NULL 即清除。

-- name: SetUserPasswordHash :execrows
UPDATE "user" SET
    password_hash = NULLIF(sqlc.arg('password_hash')::text, ''),
    updated_at = now()
WHERE email = sqlc.arg('email');
