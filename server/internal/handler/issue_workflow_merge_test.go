package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/issueworkflow"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Native workflow writes must retain the wakeup and duplicate guarantees of
// legacy status writes after merging the independent features.
func TestWorkflowNativeTransitionStopsWakeupsAndClearsDuplicate(t *testing.T) {
	ctx := context.Background()
	seedTestCatalog(t)
	ws := parseUUID(testWorkspaceID)
	workflow, err := issueworkflow.EnsureDefault(ctx, testHandler.Queries, ws)
	if err != nil {
		t.Fatal(err)
	}
	node := func(key string) pgtype.UUID {
		t.Helper()
		n, err := testHandler.Queries.GetIssueWorkflowStatusByLegacyKey(ctx, db.GetIssueWorkflowStatusByLegacyKeyParams{WorkspaceID: ws, WorkflowID: workflow.ID, LegacyStatusKey: pgtype.Text{String: key, Valid: true}})
		if err != nil {
			t.Fatal(err)
		}
		return n.ID
	}
	issue := dbfx.Issue(t, "native transition integration", testutil.Cols{"status": "todo", "workflow_id": workflow.ID, "workflow_status_id": node("todo")})
	agent := dbfx.Agent(t, "native wakeup", testRuntimeID)
	dbfx.Cleanup(t, "DELETE FROM issue_transition WHERE issue_id=$1", issue)
	dbfx.Cleanup(t, "DELETE FROM automation_execution WHERE issue_id=$1", issue)
	dbfx.Cleanup(t, "DELETE FROM issue_wakeup WHERE issue_id=$1", issue)
	dbfx.Cleanup(t, "DELETE FROM issue_wakeup_receipt WHERE wakeup_id IN (SELECT id FROM issue_wakeup WHERE issue_id=$1)", issue)
	testutil.Call(t, testHandler.CreateIssueWakeup, withURLParam(newRequest("POST", "/", map[string]any{"agent_id": agent, "kind": "at", "after_seconds": 600, "instruction": "check progress"}), "id", issue)).Want(http.StatusCreated)
	transition := func(key string) {
		t.Helper()
		testutil.Call(t, testHandler.TransitionIssueStatusNode, withURLParam(newRequest("POST", "/", map[string]any{"workflow_status_id": uuidToString(node(key))}), "id", issue)).Want(http.StatusOK)
	}
	transition("done")
	if dbfx.Count(t, "SELECT count(*) FROM issue_wakeup WHERE issue_id=$1 AND enabled", issue) != 0 {
		t.Fatal("native close left wakeups enabled")
	}
	transition("todo")
	if dbfx.Count(t, "SELECT count(*) FROM issue_wakeup WHERE issue_id=$1 AND enabled", issue) != 0 {
		t.Fatal("reopening restored wakeups")
	}
	original := dbfx.Issue(t, "native duplicate original")
	testutil.Call(t, testHandler.UpdateIssue, withURLParam(newRequest("PATCH", "/", map[string]any{
		"duplicate_of_issue_id": original, "workflow_status_id": uuidToString(node("todo")),
	}), "id", issue)).Want(http.StatusBadRequest)
	markDuplicate(t, issue, original).Want(http.StatusOK)
	transition("todo")
	if dbfx.Count(t, "SELECT count(*) FROM issue WHERE id=$1 AND duplicate_of_issue_id IS NOT NULL", issue) != 0 {
		t.Fatal("native reopen left duplicate mark")
	}
}
