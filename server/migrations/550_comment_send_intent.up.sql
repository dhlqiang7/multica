-- A composer send can carry what its author decided beyond the text:
--   * client_request_id names one logical send, so a retry after a lost
--     response returns the saved comment instead of posting it again, whether
--     that send steered a running turn or fell back to a normal trigger;
--   * suppressed_agent_ids lists the agents the author chose not to start for
--     this comment, so completion replay honors that choice too.
--
-- Nullable with no default, so this is a metadata-only change. The runner
-- sends this file as one implicit transaction: bound lock acquisition and
-- execution so it fails fast and retries on the next run rather than parking a
-- pending ACCESS EXCLUSIVE lock in front of every comment query.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE comment
    ADD COLUMN IF NOT EXISTS client_request_id UUID NULL,
    ADD COLUMN IF NOT EXISTS suppressed_agent_ids UUID[] NULL;
