package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// Expand step for duplicate marks (MUL-7349). Nothing writes
// duplicate_of_issue_id in this release, so these tests seed it the way the
// release that enables marking will write it, and check that this server keeps
// it correct: a reopened issue loses its mark, cancelling it again does not
// bring the mark back, and deleting an original clears the marks pointing at
// it. That is what makes enabling marks safe to roll back to this release.

func duplicateState(t *testing.T, issueID string) (status string, duplicateOf *string, revision int64) {
	t.Helper()
	dbfx.QueryRow(t, `SELECT status, duplicate_of_issue_id::text, revision FROM issue WHERE id = $1`, issueID).
		Scan(&status, &duplicateOf, &revision)
	return status, duplicateOf, revision
}

func updateIssueRequest(issueID string, body map[string]any) *http.Request {
	return withURLParam(newRequest("PUT", "/api/issues/"+issueID, body), "id", issueID)
}

// seedDuplicate creates a cancelled issue already marked as a duplicate of
// originalID, standing in for a mark written by a later release.
func seedDuplicate(t *testing.T, title, originalID string) string {
	t.Helper()
	return dbfx.Issue(t, title, testutil.Cols{
		"status":                "cancelled",
		"duplicate_of_issue_id": testutil.Raw("'" + originalID + "'::uuid"),
	})
}

func TestReopeningClearsDuplicateMark(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	original := dbfx.Issue(t, "maint-reopen-original")
	duplicate := seedDuplicate(t, "maint-reopen-duplicate", original)

	testutil.Call(t, testHandler.UpdateIssue, updateIssueRequest(duplicate, map[string]any{
		"status": "todo",
	})).Want(http.StatusOK)

	status, pointer, _ := duplicateState(t, duplicate)
	if status != "todo" || pointer != nil {
		t.Fatalf("after reopening: (status, duplicate_of) = (%q, %v), want (todo, nil)", status, pointer)
	}
}

// The sequence a rollback has to survive: this release reopens a marked issue
// and then cancels it again. The mark must not come back.
func TestCancellingAgainDoesNotRestoreDuplicateMark(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	original := dbfx.Issue(t, "maint-recancel-original")
	duplicate := seedDuplicate(t, "maint-recancel-duplicate", original)

	testutil.Call(t, testHandler.UpdateIssue, updateIssueRequest(duplicate, map[string]any{
		"status": "todo",
	})).Want(http.StatusOK)
	testutil.Call(t, testHandler.UpdateIssue, updateIssueRequest(duplicate, map[string]any{
		"status": "cancelled",
	})).Want(http.StatusOK)

	status, pointer, _ := duplicateState(t, duplicate)
	if status != "cancelled" || pointer != nil {
		t.Fatalf("cancelling again restored the mark: (status, duplicate_of) = (%q, %v)", status, pointer)
	}
}

func TestNonStatusEditKeepsDuplicateMark(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	original := dbfx.Issue(t, "maint-edit-original")
	duplicate := seedDuplicate(t, "maint-edit-duplicate", original)

	testutil.Call(t, testHandler.UpdateIssue, updateIssueRequest(duplicate, map[string]any{
		"title": "maint-edit-duplicate renamed",
	})).Want(http.StatusOK)

	if _, pointer, _ := duplicateState(t, duplicate); pointer == nil || *pointer != original {
		t.Fatalf("a title edit dropped the duplicate mark: %v", pointer)
	}
}

func TestBackgroundStatusWriteClearsDuplicateMark(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	original := dbfx.Issue(t, "maint-bg-original")
	duplicate := seedDuplicate(t, "maint-bg-duplicate", original)

	// GitHub sync and task recovery write status through UpdateIssueStatus.
	if _, err := testHandler.Queries.UpdateIssueStatus(context.Background(), db.UpdateIssueStatusParams{
		ID:          parseUUID(duplicate),
		Status:      "done",
		WorkspaceID: parseUUID(testWorkspaceID),
	}); err != nil {
		t.Fatalf("UpdateIssueStatus: %v", err)
	}
	if status, pointer, _ := duplicateState(t, duplicate); status != "done" || pointer != nil {
		t.Fatalf("after background write: (status, duplicate_of) = (%q, %v), want (done, nil)", status, pointer)
	}
}

func TestDeletingOriginalClearsDuplicateMarks(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	original := dbfx.Issue(t, "maint-delete-original")
	duplicate := seedDuplicate(t, "maint-delete-duplicate", original)

	req := withURLParam(newRequest("DELETE", "/api/issues/"+original, nil), "id", original)
	testutil.Call(t, testHandler.DeleteIssue, req).Want(http.StatusNoContent)

	status, pointer, _ := duplicateState(t, duplicate)
	if status != "cancelled" || pointer != nil {
		t.Fatalf("after deleting the original: (status, duplicate_of) = (%q, %v), want (cancelled, nil)", status, pointer)
	}
}
