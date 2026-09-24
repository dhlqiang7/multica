-- One logical send per author on an issue. Only request-carrying comments are
-- indexed, so ordinary comment writes never touch it.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS comment_client_request_uidx
    ON comment (issue_id, author_id, client_request_id)
    WHERE client_request_id IS NOT NULL;
