package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/testutil"
)

type deliveryIssueRow struct {
	IssueID        string  `json:"issue_id"`
	Identifier     string  `json:"identifier"`
	StatusKind     string  `json:"status_kind"`
	ProjectID      *string `json:"project_id"`
	Source         string  `json:"source"`
	AgentID        string  `json:"agent_id"`
	AssignedAt     string  `json:"assigned_at"`
	DeliveredAt    *string `json:"delivered_at"`
	AcceptedAt     *string `json:"accepted_at"`
	BounceCount    int32   `json:"bounce_count"`
	LastBounceAt   *string `json:"last_bounce_at"`
	RunCount       int32   `json:"run_count"`
	FailedRunCount int32   `json:"failed_run_count"`
	RunSeconds     int64   `json:"run_seconds"`
}

type deliveryResponse struct {
	WindowStart         string             `json:"window_start"`
	PreviousWindowStart string             `json:"previous_window_start"`
	Issues              []deliveryIssueRow `json:"issues"`
}

func readDelivery(t *testing.T, userID, query string) deliveryResponse {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.GetDashboardDelivery(w, newRequestAs(userID, "GET", "/api/dashboard/delivery?"+query, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("delivery: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp deliveryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("delivery: decode: %v", err)
	}
	return resp
}

func findDeliveryIssue(resp deliveryResponse, issueID string) (deliveryIssueRow, bool) {
	for _, row := range resp.Issues {
		if row.IssueID == issueID {
			return row, true
		}
	}
	return deliveryIssueRow{}, false
}

// statusChange writes the activity row the activity listener records for a
// status move, at a fixed instant.
func statusChange(t *testing.T, issueID, actorType, actorID, from, to string, at time.Time) {
	t.Helper()
	dbfx.Insert(t, "activity_log", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"issue_id":     issueID,
		"actor_type":   actorType,
		"actor_id":     actorID,
		"action":       "status_changed",
		"details":      `{"from":"` + from + `","to":"` + to + `"}`,
		"created_at":   at,
	})
}

// TestDashboardDeliveryIssueFacts walks one issue through the full review
// loop — picked up, delivered, sent back, delivered again, accepted — and pins
// every fact the analytics page folds from it, plus the two cohort rules: an
// issue an agent touched before the window is not in it, and the project
// filter scopes the rows.
func TestDashboardDeliveryIssueFacts(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	now := pinDayWindowClock(t, time.Now())
	var agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, testWorkspaceID).Scan(&agentID)
	runtimeID := handlerTestRuntimeID(t)
	projectID := dbfx.Project(t, "delivery project")

	// Reviewed issue: picked up at the start of today (UTC), ten-minute run,
	// delivered, bounced by a member, delivered again, accepted. Every instant
	// is anchored on the days=1 boundary itself so the fixture sits inside the
	// window at any hour.
	start := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	at := func(seconds int) time.Time { return start.Add(time.Duration(seconds) * time.Second) }

	reviewed := dbfx.Issue(t, "delivery reviewed", testutil.Cols{"status": "done"})
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":     reviewed,
		"runtime_id":   runtimeID,
		"status":       "completed",
		"created_at":   at(0),
		"started_at":   at(1),
		"completed_at": at(601),
	})
	// A review-round run after the first delivery: counted as a run, but not
	// toward the pre-delivery run time.
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":     reviewed,
		"runtime_id":   runtimeID,
		"status":       "failed",
		"created_at":   at(700),
		"started_at":   at(701),
		"completed_at": at(760),
	})
	statusChange(t, reviewed, "agent", agentID, "todo", "in_progress", at(2))
	statusChange(t, reviewed, "agent", agentID, "in_progress", "in_review", at(610))
	statusChange(t, reviewed, "member", testUserID, "in_review", "in_progress", at(650))
	statusChange(t, reviewed, "agent", agentID, "in_progress", "in_review", at(800))
	statusChange(t, reviewed, "member", testUserID, "in_review", "done", at(900))

	// In a project, still being worked on: never delivered.
	open := dbfx.Issue(t, "delivery open", testutil.Cols{"status": "in_progress", "project_id": projectID})
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   open,
		"runtime_id": runtimeID,
		"status":     "running",
		"created_at": at(5),
		"started_at": at(6),
	})

	// An agent already worked on this one long before both periods, so it
	// belongs to an older window even though it has a fresh task.
	carried := dbfx.Issue(t, "delivery carried over", testutil.Cols{"status": "in_review"})
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   carried,
		"runtime_id": runtimeID,
		"status":     "completed",
		"created_at": now.Add(-10 * 24 * time.Hour),
	})
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   carried,
		"runtime_id": runtimeID,
		"status":     "queued",
		"created_at": at(10),
	})

	resp := readDelivery(t, testUserID, "days=1&tz=UTC")

	wantStart := start.Format(time.RFC3339)
	wantPrevious := start.AddDate(0, 0, -1).Format(time.RFC3339)
	if resp.WindowStart != wantStart || resp.PreviousWindowStart != wantPrevious {
		t.Errorf("window = %s / %s, want %s / %s", resp.WindowStart, resp.PreviousWindowStart, wantStart, wantPrevious)
	}

	row, ok := findDeliveryIssue(resp, reviewed)
	if !ok {
		t.Fatalf("reviewed issue missing from %+v", resp.Issues)
	}
	if row.AgentID != agentID || row.Source != deliverySourceMember || row.StatusKind != "done" {
		t.Errorf("reviewed: agent=%s source=%s category=%s", row.AgentID, row.Source, row.StatusKind)
	}
	if !strings.Contains(row.Identifier, "-") {
		t.Errorf("reviewed: identifier %q has no prefix", row.Identifier)
	}
	if row.DeliveredAt == nil || !mustParseTime(t, *row.DeliveredAt).Equal(at(610)) {
		t.Errorf("reviewed: delivered_at = %v, want the first move into review at %s", row.DeliveredAt, at(610))
	}
	if row.AcceptedAt == nil || !mustParseTime(t, *row.AcceptedAt).Equal(at(900)) {
		t.Errorf("reviewed: accepted_at = %v, want %s", row.AcceptedAt, at(900))
	}
	if row.BounceCount != 1 || row.LastBounceAt == nil || !mustParseTime(t, *row.LastBounceAt).Equal(at(650)) {
		t.Errorf("reviewed: bounces = %d (last %v), want 1 at %s", row.BounceCount, row.LastBounceAt, at(650))
	}
	if row.RunCount != 2 || row.FailedRunCount != 1 {
		t.Errorf("reviewed: runs = %d failed = %d, want 2 / 1", row.RunCount, row.FailedRunCount)
	}
	if row.RunSeconds != 600 {
		t.Errorf("reviewed: run_seconds = %d, want 600 — only the run before the first delivery", row.RunSeconds)
	}
	if !mustParseTime(t, row.AssignedAt).Equal(at(0)) {
		t.Errorf("reviewed: assigned_at = %s, want the first task at %s", row.AssignedAt, at(0))
	}

	openRow, ok := findDeliveryIssue(resp, open)
	if !ok {
		t.Fatalf("open issue missing")
	}
	if openRow.DeliveredAt != nil || openRow.AcceptedAt != nil || openRow.BounceCount != 0 {
		t.Errorf("open: expected undelivered, got %+v", openRow)
	}
	if openRow.ProjectID == nil || *openRow.ProjectID != projectID {
		t.Errorf("open: project_id = %v, want %s", openRow.ProjectID, projectID)
	}

	if _, ok := findDeliveryIssue(resp, carried); ok {
		t.Errorf("carried-over issue is in the window although an agent picked it up 10 days ago")
	}

	scoped := readDelivery(t, testUserID, "days=1&tz=UTC&project_id="+projectID)
	if _, ok := findDeliveryIssue(scoped, open); !ok {
		t.Errorf("project scope: open issue missing")
	}
	if _, ok := findDeliveryIssue(scoped, reviewed); ok {
		t.Errorf("project scope: issue outside the project leaked in")
	}
}

// TestDashboardDeliveryMapsCustomStatuses: a custom status carries only a
// lifecycle category, so a "started" one is work in progress (never review)
// and a "done" one is delivered and accepted. Built-in keys keep their own
// meaning whatever the catalog says about their category.
func TestDashboardDeliveryMapsCustomStatuses(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	now := pinDayWindowClock(t, time.Now())
	var agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, testWorkspaceID).Scan(&agentID)
	runtimeID := handlerTestRuntimeID(t)
	customStatus := func(key, category string) {
		dbfx.Insert(t, "issue_status", testutil.Cols{
			"workspace_id": testWorkspaceID,
			"key":          key,
			"name":         key,
			"category":     category,
			"color":        "#336699",
			"position":     100,
		})
	}
	customStatus("delivery_qa", "started")
	customStatus("delivery_shipped", "done")

	start := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	at := func(seconds int) time.Time { return start.Add(time.Duration(seconds) * time.Second) }

	shipped := dbfx.Issue(t, "delivery custom shipped", testutil.Cols{"status": "delivery_shipped"})
	dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   shipped,
		"runtime_id": runtimeID,
		"status":     "completed",
		"created_at": at(0),
	})
	statusChange(t, shipped, "agent", agentID, "todo", "delivery_qa", at(5))
	statusChange(t, shipped, "member", testUserID, "delivery_qa", "delivery_shipped", at(60))

	resp := readDelivery(t, testUserID, "days=1&tz=UTC")
	row, ok := findDeliveryIssue(resp, shipped)
	if !ok {
		t.Fatalf("custom-status issue missing")
	}
	if row.StatusKind != "done" || row.AcceptedAt == nil {
		t.Errorf("status_kind = %s, accepted_at = %v; want done and accepted", row.StatusKind, row.AcceptedAt)
	}
	// The "started" custom status is not review, so the delivery is the move
	// into the done-category status, not the earlier move into delivery_qa.
	if row.DeliveredAt == nil || !mustParseTime(t, *row.DeliveredAt).Equal(at(60)) {
		t.Errorf("delivered_at = %v, want %s", row.DeliveredAt, at(60))
	}
}

// TestDashboardDeliveryFoldsRestrictedAgents: a plain member sees a private
// agent's issues, attributed to the restricted bucket instead of its id.
func TestDashboardDeliveryFoldsRestrictedAgents(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	privateAgentID, _, memberID := privateAgentTestFixture(t)
	runtimeID := handlerTestRuntimeID(t)

	issueID := dbfx.Issue(t, "delivery private agent")
	dbfx.Task(t, privateAgentID, testutil.Cols{
		"issue_id":   issueID,
		"runtime_id": runtimeID,
		"status":     "queued",
		"created_at": testutil.Raw("now()"),
	})

	// days=7 so an issue seeded just after local midnight is still inside.
	owner := readDelivery(t, testUserID, "days=7")
	member := readDelivery(t, memberID, "days=7")

	if row, ok := findDeliveryIssue(owner, issueID); !ok || row.AgentID != privateAgentID {
		t.Errorf("owner: expected the private agent's own id, got %+v (found=%v)", row, ok)
	}
	row, ok := findDeliveryIssue(member, issueID)
	if !ok {
		t.Fatalf("member: the issue itself must stay visible")
	}
	if row.AgentID != restrictedAgentsRowID {
		t.Errorf("member: agent_id = %s, want %s", row.AgentID, restrictedAgentsRowID)
	}
	body, _ := json.Marshal(member)
	if strings.Contains(string(body), privateAgentID) {
		t.Errorf("member response leaked private agent id %s", privateAgentID)
	}
}

// TestDashboardUsageBreakdownKeepsEveryDimension: the breakdown splits by
// runtime and project, and the project filter narrows it.
func TestDashboardUsageBreakdownKeepsEveryDimension(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	var agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at LIMIT 1`, testWorkspaceID).Scan(&agentID)
	runtimeID := handlerTestRuntimeID(t)
	projectID := dbfx.Project(t, "breakdown project")
	started, completed := runFinishedToday(pinDayWindowClock(t, time.Now()), dashboardFixtureLoc(t))

	seed := func(issueID string, tokens int64) {
		taskID := dbfx.Task(t, agentID, testutil.Cols{
			"issue_id":     issueID,
			"runtime_id":   runtimeID,
			"status":       "completed",
			"started_at":   started,
			"completed_at": completed,
			"created_at":   testutil.Raw("now()"),
		})
		dbfx.Exec(t, `
			INSERT INTO task_usage (task_id, provider, model, input_tokens, output_tokens, created_at)
			VALUES ($1, 'claude', 'breakdown-model', $2, 0, now())
		`, taskID, tokens)
	}
	seed(dbfx.Issue(t, "breakdown in project", testutil.Cols{"project_id": projectID}), 700)
	seed(dbfx.Issue(t, "breakdown no project"), 300)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM task_usage_hourly WHERE model = 'breakdown-model'`)
	})
	dbfx.Exec(t, `SELECT rollup_task_usage_hourly_window('1970-01-01'::timestamptz, now() + interval '1 hour')`)

	type row struct {
		AgentID     string `json:"agent_id"`
		RuntimeID   string `json:"runtime_id"`
		ProjectID   string `json:"project_id"`
		Model       string `json:"model"`
		InputTokens int64  `json:"input_tokens"`
	}
	read := func(query string) map[string]int64 {
		t.Helper()
		w := httptest.NewRecorder()
		testHandler.GetDashboardUsageBreakdown(w, newRequest("GET", "/api/dashboard/usage/breakdown?days=1&"+dashboardFixtureTZParam+query, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("breakdown: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var rows []row
		if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
			t.Fatalf("breakdown: decode: %v", err)
		}
		byProject := map[string]int64{}
		for _, r := range rows {
			if r.Model != "breakdown-model" {
				continue
			}
			if r.AgentID != agentID || r.RuntimeID != runtimeID {
				t.Errorf("breakdown: row lost its agent/runtime: %+v", r)
			}
			byProject[r.ProjectID] += r.InputTokens
		}
		return byProject
	}

	all := read("")
	if all[projectID] != 700 || all[""] != 300 {
		t.Errorf("breakdown: by project = %v, want %s:700 and none:300", all, projectID)
	}
	scoped := read("&project_id=" + projectID)
	if scoped[projectID] != 700 || scoped[""] != 0 {
		t.Errorf("breakdown project scope: %v, want only %s:700", scoped, projectID)
	}
}

func mustParseTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return parsed.UTC()
}
