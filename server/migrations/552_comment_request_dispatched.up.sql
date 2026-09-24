-- A send's comment is saved before its agents are started or steered. The
-- attempt that goes on to reach them claims the send here first, so a retry
-- of a send whose server stopped right after saving reaches them instead of
-- only returning the saved comment, and no retry reaches them twice.
--
-- Nullable with no default, so this is a metadata-only change. The runner
-- sends this file as one implicit transaction: bound lock acquisition and
-- execution so it fails fast and retries on the next run rather than parking a
-- pending ACCESS EXCLUSIVE lock in front of every comment query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE comment ADD COLUMN IF NOT EXISTS client_request_dispatched_at TIMESTAMPTZ NULL;
