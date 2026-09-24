-- 固定密码登录模式（MULTICA_AUTH_MODE=password）：user 表增加 bcrypt 哈希列。
-- 可空：验证码/无码直登模式下不写此列，行为不受影响。
ALTER TABLE "user"
    ADD COLUMN password_hash TEXT;
