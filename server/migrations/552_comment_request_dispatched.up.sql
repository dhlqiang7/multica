-- A send's comment is saved before its agents are started or steered. This
-- marks the second half done, so a retry of a send whose server stopped in
-- between finishes it instead of only returning the saved comment.
--
-- Nullable with no default, so this is a metadata-only change. The runner
-- sends this file as one implicit transaction: bound lock acquisition and
-- execution so it fails fast and retries on the next run rather than parking a
-- pending ACCESS EXCLUSIVE lock in front of every comment query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE comment ADD COLUMN IF NOT EXISTS client_request_dispatched_at TIMESTAMPTZ NULL;
