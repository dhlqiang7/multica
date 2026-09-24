-- name: GetIssueSystemWakeup :one
SELECT * FROM issue_system_wakeup WHERE issue_id= @issue_id AND workspace_id= @workspace_id AND rule= @rule;

-- name: UpsertIssueSystemWakeup :one
INSERT INTO issue_system_wakeup(issue_id,workspace_id,rule,enabled,instruction,updated_by)
VALUES(@issue_id,@workspace_id,@rule,@enabled,@instruction,sqlc.narg(updated_by))
ON CONFLICT (issue_id,rule) DO UPDATE SET enabled=EXCLUDED.enabled,instruction=EXCLUDED.instruction,
 updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()
RETURNING *;

-- name: ClaimChildDoneEvents :many
-- Claim a parent's recorded child transitions. A claim that was not finished
-- within five minutes (a crashed or failed attempt) can be claimed again.
UPDATE issue_child_done_event SET claimed_at=clock_timestamp()
WHERE parent_id= @parent_id AND processed_at IS NULL
 AND (claimed_at IS NULL OR claimed_at < clock_timestamp()-interval '5 minutes')
RETURNING *;

-- name: FinishChildDoneEvents :exec
UPDATE issue_child_done_event SET processed_at=clock_timestamp() WHERE id=ANY(@ids::uuid[]);

-- name: ListStaleChildDoneParents :many
-- Parents whose transitions were not processed right after their write.
SELECT DISTINCT parent_id FROM issue_child_done_event
WHERE processed_at IS NULL
 AND ((claimed_at IS NULL AND created_at < clock_timestamp()-interval '30 seconds') OR claimed_at < clock_timestamp()-interval '5 minutes')
LIMIT 50;

-- name: DeleteProcessedChildDoneEvents :execrows
WITH batch AS MATERIALIZED (
 SELECT e.id FROM issue_child_done_event e WHERE e.processed_at < @cutoff
 ORDER BY e.processed_at LIMIT 1000 FOR UPDATE SKIP LOCKED
)
DELETE FROM issue_child_done_event d USING batch WHERE d.id=batch.id;
