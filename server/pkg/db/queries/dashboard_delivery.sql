-- name: ListDashboardDeliveryIssues :many
-- One row per issue an agent picked up inside the window: the analytics
-- page's delivery funnel, first-pass rate, cycle time and agent scorecard are
-- all folded client-side from these rows, so every figure on the page
-- reconciles with every other one.
--
-- Cohort: issues whose FIRST agent task was created at or after @since. An
-- issue an agent had already touched before @since belongs to an earlier
-- window and is excluded, so a long-running issue is counted once, in the
-- window where the agent work on it began. The caller passes the start of the
-- PREVIOUS period as @since and splits current / previous client-side.
--
-- Status history comes from activity_log `status_changed` rows, whose details
-- carry the from/to status KEYS. Each key is reduced to a status KIND — the
-- built-in status it behaves as. A built-in key is its own kind. A custom
-- status only has a lifecycle category (unstarted / started / done / closed),
-- which cannot tell review apart from work in progress, so it maps to todo,
-- in_progress, done or cancelled; review is only ever the built-in in_review.
-- A key with no catalog row (history from before the catalog) is its own
-- kind. Only transitions at or after the first agent task count — a status
-- the issue passed through before any agent worked on it says nothing about
-- the agent's delivery.
--
--   delivered_at  first move into in_review or done
--   last_done_at  latest move into done (the client only reads it while the
--                 issue still sits in a done status)
--   bounce_count  moves from in_review back to backlog / todo / in_progress
--
-- The attributed agent is the one that made the first delivery when an agent
-- made it; otherwise the agent of the latest task created before that
-- delivery (or the latest task at all when the issue was never delivered).
--
-- run_seconds only counts runs that started before the first delivery: it is
-- the agent's share of the cycle time, and review-round runs belong to rework.
WITH status_kinds AS (
    SELECT
        s.key,
        CASE
            WHEN s.key IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')
                THEN s.key
            WHEN s.category = 'done' THEN 'done'
            WHEN s.category = 'closed' THEN 'cancelled'
            WHEN s.category = 'unstarted' THEN 'todo'
            ELSE 'in_progress'
        END AS kind
    FROM issue_status s
    WHERE s.workspace_id = @workspace_id
),
window_tasks AS (
    SELECT atq.issue_id, MIN(atq.created_at)::timestamptz AS first_task_at
    FROM agent_task_queue atq
    JOIN agent a ON a.id = atq.agent_id
    WHERE a.workspace_id = @workspace_id
      AND atq.issue_id IS NOT NULL
      AND atq.created_at >= @since::timestamptz
    GROUP BY atq.issue_id
),
cohort AS (
    SELECT wt.issue_id, wt.first_task_at
    FROM window_tasks wt
    WHERE NOT EXISTS (
        SELECT 1 FROM agent_task_queue prior
        WHERE prior.issue_id = wt.issue_id
          AND prior.created_at < @since::timestamptz
    )
),
transitions AS (
    SELECT
        al.issue_id,
        al.created_at,
        al.actor_type,
        al.actor_id,
        COALESCE(fk.kind, al.details->>'from') AS from_kind,
        COALESCE(tk.kind, al.details->>'to') AS to_kind
    FROM activity_log al
    JOIN cohort c ON c.issue_id = al.issue_id
    LEFT JOIN status_kinds fk ON fk.key = al.details->>'from'
    LEFT JOIN status_kinds tk ON tk.key = al.details->>'to'
    WHERE al.action = 'status_changed'
      AND al.created_at >= c.first_task_at
),
status_facts AS (
    SELECT
        t.issue_id,
        MIN(t.created_at) FILTER (WHERE t.to_kind IN ('in_review', 'done')) AS delivered_at,
        MAX(t.created_at) FILTER (WHERE t.to_kind = 'done') AS last_done_at,
        COUNT(*) FILTER (
            WHERE t.from_kind = 'in_review' AND t.to_kind IN ('backlog', 'todo', 'in_progress')
        ) AS bounce_count,
        MAX(t.created_at) FILTER (
            WHERE t.from_kind = 'in_review' AND t.to_kind IN ('backlog', 'todo', 'in_progress')
        ) AS last_bounce_at
    FROM transitions t
    GROUP BY t.issue_id
)
SELECT
    i.id AS issue_id,
    i.number,
    i.title,
    i.status,
    COALESCE(ck.kind, i.status)::text AS status_kind,
    i.project_id,
    i.creator_type,
    COALESCE(i.origin_type, '')::text AS origin_type,
    c.first_task_at,
    sf.delivered_at::timestamptz AS delivered_at,
    sf.last_done_at::timestamptz AS last_done_at,
    COALESCE(sf.bounce_count, 0)::int AS bounce_count,
    sf.last_bounce_at::timestamptz AS last_bounce_at,
    COALESCE(deliverer.actor_id, latest_task.agent_id)::uuid AS agent_id,
    runs.run_count,
    runs.failed_run_count,
    runs.run_seconds
FROM cohort c
JOIN issue i ON i.id = c.issue_id
LEFT JOIN status_kinds ck ON ck.key = i.status
LEFT JOIN status_facts sf ON sf.issue_id = c.issue_id
LEFT JOIN LATERAL (
    SELECT t.actor_id
    FROM transitions t
    WHERE t.issue_id = c.issue_id
      AND t.created_at = sf.delivered_at
      AND t.actor_type = 'agent'
      AND t.actor_id IS NOT NULL
    LIMIT 1
) deliverer ON true
LEFT JOIN LATERAL (
    SELECT atq.agent_id
    FROM agent_task_queue atq
    WHERE atq.issue_id = c.issue_id
    ORDER BY
        CASE WHEN sf.delivered_at IS NULL OR atq.created_at <= sf.delivered_at THEN 0 ELSE 1 END,
        atq.created_at DESC
    LIMIT 1
) latest_task ON true
CROSS JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE atq.status IN ('completed', 'failed', 'cancelled'))::int AS run_count,
        COUNT(*) FILTER (WHERE atq.status = 'failed')::int AS failed_run_count,
        COALESCE(
            SUM(EXTRACT(EPOCH FROM (atq.completed_at - atq.started_at))) FILTER (
                WHERE atq.started_at IS NOT NULL
                  AND atq.completed_at IS NOT NULL
                  AND (sf.delivered_at IS NULL OR atq.started_at < sf.delivered_at)
            ),
            0
        )::bigint AS run_seconds
    FROM agent_task_queue atq
    WHERE atq.issue_id = c.issue_id
) runs
WHERE i.workspace_id = @workspace_id
  AND (sqlc.narg('project_id')::uuid IS NULL OR i.project_id = sqlc.narg('project_id'))
ORDER BY c.first_task_at DESC, i.id;

-- name: ListDashboardUsageBreakdown :many
-- Per-(agent, runtime, project, provider, model) token aggregates from
-- `task_usage_hourly` — every dimension the rollup keeps, so the analytics
-- cost table can regroup by agent, model, runtime or project client-side
-- without a round trip per grouping. Same exact N-day @since and the same
-- provider normalisation and cost split as ListDashboardUsageByAgent.
SELECT
    agent_id,
    runtime_id,
    project_id,
    LOWER(provider) AS provider,
    model,
    SUM(input_tokens)::bigint        AS input_tokens,
    SUM(output_tokens)::bigint       AS output_tokens,
    SUM(cache_read_tokens)::bigint   AS cache_read_tokens,
    SUM(cache_write_tokens)::bigint  AS cache_write_tokens,
    SUM(cost_usd_ticks)::bigint                                          AS cost_usd_ticks,
    SUM(COALESCE(uncosted_input_tokens, input_tokens))::bigint           AS uncosted_input_tokens,
    SUM(COALESCE(uncosted_output_tokens, output_tokens))::bigint         AS uncosted_output_tokens,
    SUM(COALESCE(uncosted_cache_read_tokens, cache_read_tokens))::bigint AS uncosted_cache_read_tokens,
    SUM(COALESCE(uncosted_cache_write_tokens, cache_write_tokens))::bigint AS uncosted_cache_write_tokens,
    SUM(task_count)::int             AS task_count
FROM task_usage_hourly
WHERE workspace_id = $1
  AND bucket_hour >= @since::timestamptz
  AND (sqlc.narg('project_id')::uuid IS NULL OR project_id = sqlc.narg('project_id'))
GROUP BY agent_id, runtime_id, project_id, LOWER(provider), model
ORDER BY agent_id, runtime_id, project_id, LOWER(provider), model;
