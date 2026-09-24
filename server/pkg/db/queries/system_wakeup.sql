-- name: GetIssueSystemWakeup :one
SELECT * FROM issue_system_wakeup WHERE issue_id= @issue_id AND workspace_id= @workspace_id AND rule= @rule;

-- name: UpsertIssueSystemWakeup :one
INSERT INTO issue_system_wakeup(issue_id,workspace_id,rule,enabled,instruction,updated_by)
VALUES(@issue_id,@workspace_id,@rule,@enabled,@instruction,sqlc.narg(updated_by))
ON CONFLICT (issue_id,rule) DO UPDATE SET enabled=EXCLUDED.enabled,instruction=EXCLUDED.instruction,
 updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()
RETURNING *;
