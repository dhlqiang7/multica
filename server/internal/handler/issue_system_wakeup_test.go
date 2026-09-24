package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func createStagedChild(t *testing.T, parentID string, stage int, status string) IssueResponse {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.CreateIssue(w, newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title": "staged child " + time.Now().Format(time.RFC3339Nano), "status": status,
		"parent_issue_id": parentID, "stage": stage,
	}))
	if w.Code != http.StatusCreated {
		t.Fatalf("create staged child: %d %s", w.Code, w.Body.String())
	}
	var child IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&child); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { testPool.Exec(context.Background(), `DELETE FROM issue WHERE id=$1`, child.ID) })
	return child
}

func listSystemWakeupsFor(t *testing.T, issueID string) []systemWakeupResponse {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.ListIssueSystemWakeups(w, withURLParam(newRequest("GET", "/api/issues/"+issueID+"/system-wakeups", nil), "id", issueID))
	if w.Code != http.StatusOK {
		t.Fatalf("list system wakeups: %d %s", w.Code, w.Body.String())
	}
	var rules []systemWakeupResponse
	if err := json.NewDecoder(w.Body).Decode(&rules); err != nil {
		t.Fatal(err)
	}
	return rules
}

func putChildDoneRule(t *testing.T, issueID string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.UpdateIssueSystemWakeup(w, withURLParams(newRequest("PUT", "/api/issues/"+issueID+"/system-wakeups/child_done", body), "id", issueID, "rule", "child_done"))
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM issue_system_wakeup WHERE issue_id=$1`, issueID)
	})
	return w
}

// The implicit child-done wake is shown as a system rule describing what the
// parent is waiting for, and disappears once nothing is left to wait for.
func TestSystemWakeupDescribesUnstagedWait(t *testing.T) {
	fx := newChildDoneFixture(t, "in_progress")
	rules := listSystemWakeupsFor(t, fx.parent.ID)
	if len(rules) != 1 {
		t.Fatalf("expected the child-done rule, got %+v", rules)
	}
	rule := rules[0]
	if rule.Rule != "child_done" || !rule.Enabled || rule.Staged || rule.Stage != nil || rule.Total != 1 || rule.Remaining != 1 {
		t.Fatalf("unexpected rule: %+v", rule)
	}
	if len(rule.Waiting) != 1 || rule.Waiting[0] != fx.child.Identifier || rule.Blocked != "no_assignee" {
		t.Fatalf("waiting/blocked: %+v", rule)
	}
	updateChildStatus(t, fx.child.ID, "done")
	if rules = listSystemWakeupsFor(t, fx.parent.ID); len(rules) != 0 {
		t.Fatalf("finished sub-issues still reported: %+v", rules)
	}
	if rules = listSystemWakeupsFor(t, fx.child.ID); len(rules) != 0 {
		t.Fatalf("issue without sub-issues reports a rule: %+v", rules)
	}
}

func TestSystemWakeupDescribesLowestOpenStage(t *testing.T) {
	fx := newChildDoneFixture(t, "in_progress")
	// The fixture child is unstaged; staged siblings form the stages.
	createStagedChild(t, fx.parent.ID, 1, "done")
	open := createStagedChild(t, fx.parent.ID, 1, "in_progress")
	createStagedChild(t, fx.parent.ID, 2, "backlog")
	rules := listSystemWakeupsFor(t, fx.parent.ID)
	if len(rules) != 1 || !rules[0].Staged || rules[0].Stage == nil || *rules[0].Stage != 1 {
		t.Fatalf("expected stage 1: %+v", rules)
	}
	if rules[0].Total != 2 || rules[0].Remaining != 1 || rules[0].Waiting[0] != open.Identifier {
		t.Fatalf("stage progress: %+v", rules[0])
	}
}

// Turning the rule off for one issue suppresses the notification and wake;
// a supplementary instruction travels in the notification the assignee reads.
func TestSystemWakeupOverrideControlsChildDone(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		fx := newChildDoneFixture(t, "in_progress")
		if w := putChildDoneRule(t, fx.parent.ID, map[string]any{"enabled": false, "instruction": ""}); w.Code != http.StatusOK {
			t.Fatalf("disable: %d %s", w.Code, w.Body.String())
		}
		if rules := listSystemWakeupsFor(t, fx.parent.ID); len(rules) != 1 || rules[0].Enabled {
			t.Fatalf("override not reported: %+v", rules)
		}
		updateChildStatus(t, fx.child.ID, "done")
		if got := countSystemCommentsOn(t, fx.parent.ID); got != 0 {
			t.Fatalf("disabled rule still notified the parent: %d comments", got)
		}
	})
	t.Run("supplement", func(t *testing.T) {
		fx := newChildDoneFixture(t, "in_progress")
		if w := putChildDoneRule(t, fx.parent.ID, map[string]any{"enabled": true, "instruction": "  Ask Jiayuan to confirm the window first.  "}); w.Code != http.StatusOK {
			t.Fatalf("save: %d %s", w.Code, w.Body.String())
		}
		updateChildStatus(t, fx.child.ID, "done")
		content, _, _, _ := systemCommentOn(t, fx.parent.ID)
		if !strings.HasSuffix(content, "Supplementary instruction set on this issue:\nAsk Jiayuan to confirm the window first.") {
			t.Fatalf("supplement missing: %s", content)
		}
	})
	t.Run("validation", func(t *testing.T) {
		fx := newChildDoneFixture(t, "in_progress")
		if w := putChildDoneRule(t, fx.parent.ID, map[string]any{"enabled": true, "instruction": strings.Repeat("x", 4001)}); w.Code != http.StatusBadRequest {
			t.Fatalf("oversized instruction: %d", w.Code)
		}
		if w := putChildDoneRule(t, fx.parent.ID, map[string]any{"enabled": true, "extra": 1}); w.Code != http.StatusBadRequest {
			t.Fatalf("unknown field: %d", w.Code)
		}
		w := httptest.NewRecorder()
		testHandler.UpdateIssueSystemWakeup(w, withURLParams(newRequest("PUT", "/api/issues/"+fx.parent.ID+"/system-wakeups/other", map[string]any{"enabled": true}), "id", fx.parent.ID, "rule", "other"))
		if w.Code != http.StatusNotFound {
			t.Fatalf("unknown rule: %d", w.Code)
		}
	})
}
