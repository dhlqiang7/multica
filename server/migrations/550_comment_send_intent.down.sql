ALTER TABLE comment
    DROP COLUMN IF EXISTS suppressed_agent_ids,
    DROP COLUMN IF EXISTS client_request_id;
