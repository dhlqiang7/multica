package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// systemWakeupChildDone is the platform rule that wakes a parent's assignee
// when a stage of its sub-issues finishes (see notifyParentOfChildDone). It
// used to be implicit; exposing it as a rule lets people see what the parent
// is waiting for, turn it off per issue, and add an instruction.
const systemWakeupChildDone = "child_done"

const maxSystemWakeupInstruction = 4000

type systemWakeupTarget struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

type systemWakeupResponse struct {
	Rule        string `json:"rule"`
	Enabled     bool   `json:"enabled"`
	Instruction string `json:"instruction"`
	// Staged is false for an unstaged sub-issue set, which waits for every
	// sub-issue. Stage is the lowest unfinished stage otherwise.
	Staged    bool   `json:"staged"`
	Stage     *int32 `json:"stage"`
	Total     int    `json:"total"`
	Remaining int    `json:"remaining"`
	// Identifiers of the unfinished sub-issues in scope, at most five.
	Waiting []string            `json:"waiting"`
	Target  *systemWakeupTarget `json:"target"`
	// Blocked explains why the rule would not wake anyone right now:
	// "backlog", "member_assignee" or "no_assignee". Empty when it would.
	Blocked string `json:"blocked"`
}

// childDoneRule reads the per-issue override. A missing row, or a failed read,
// keeps the default: enabled with no supplementary instruction, which is the
// behavior before the rule could be configured.
func (h *Handler) childDoneRule(ctx context.Context, parent db.Issue) (bool, string) {
	rule, err := h.Queries.GetIssueSystemWakeup(ctx, db.GetIssueSystemWakeupParams{IssueID: parent.ID, WorkspaceID: parent.WorkspaceID, Rule: systemWakeupChildDone})
	if errors.Is(err, pgx.ErrNoRows) {
		return true, ""
	}
	if err != nil {
		slog.Warn("child done: failed to read system wakeup rule", "error", err, "parent_id", uuidToString(parent.ID))
		return true, ""
	}
	return rule.Enabled, rule.Instruction
}

// childDoneSystemWakeup describes what the parent is waiting for. It returns
// nil when there is nothing left to wait for: no sub-issues, every stage has
// finished, or the parent itself is closed.
func (h *Handler) childDoneSystemWakeup(ctx context.Context, parent db.Issue) (*systemWakeupResponse, error) {
	effective := h.childStatusResolver(ctx)
	parentStatus, err := effective(parent)
	if err != nil {
		return nil, err
	}
	if parentStatus == "done" || parentStatus == "cancelled" {
		return nil, nil
	}
	children, err := h.Queries.ListChildIssues(ctx, parent.ID)
	if err != nil {
		return nil, err
	}
	if len(children) == 0 {
		return nil, nil
	}
	statuses, err := resolveChildStatuses(children, effective)
	if err != nil {
		return nil, err
	}
	staged := siblingsAreStaged(children)
	var stage int32
	found := false
	for _, c := range children {
		if statuses.isTerminal(c) || (staged && !c.Stage.Valid) {
			continue
		}
		if !staged {
			found = true
			break
		}
		if !found || c.Stage.Int32 < stage {
			stage, found = c.Stage.Int32, true
		}
	}
	if !found {
		return nil, nil
	}
	out := &systemWakeupResponse{Rule: systemWakeupChildDone, Staged: staged, Waiting: []string{}}
	if staged {
		out.Stage = &stage
	}
	prefix := h.getIssuePrefix(ctx, parent.WorkspaceID)
	for _, c := range children {
		if staged && (!c.Stage.Valid || c.Stage.Int32 != stage) {
			continue
		}
		out.Total++
		if !statuses.isTerminal(c) {
			out.Remaining++
			if len(out.Waiting) < 5 {
				out.Waiting = append(out.Waiting, prefix+"-"+strconv.Itoa(int(c.Number)))
			}
		}
	}
	out.Enabled, out.Instruction = h.childDoneRule(ctx, parent)
	switch {
	case !parent.AssigneeType.Valid || !parent.AssigneeID.Valid:
		out.Blocked = "no_assignee"
	case parent.AssigneeType.String == "member":
		out.Blocked = "member_assignee"
	case parent.AssigneeType.String == "agent":
		if agent, e := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{ID: parent.AssigneeID, WorkspaceID: parent.WorkspaceID}); e == nil {
			out.Target = &systemWakeupTarget{Type: "agent", ID: uuidToString(agent.ID), Name: agent.Name}
		}
	case parent.AssigneeType.String == "squad":
		if squad, e := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{ID: parent.AssigneeID, WorkspaceID: parent.WorkspaceID}); e == nil {
			out.Target = &systemWakeupTarget{Type: "squad", ID: uuidToString(squad.ID), Name: squad.Name}
		}
	}
	if out.Blocked == "" && parentStatus == "backlog" {
		out.Blocked = "backlog"
	}
	if out.Blocked == "" && out.Target == nil {
		out.Blocked = "no_assignee"
	}
	return out, nil
}

func (h *Handler) listSystemWakeups(ctx context.Context, issue db.Issue) ([]systemWakeupResponse, error) {
	rules := []systemWakeupResponse{}
	childDone, err := h.childDoneSystemWakeup(ctx, issue)
	if err != nil {
		return nil, err
	}
	if childDone != nil {
		rules = append(rules, *childDone)
	}
	return rules, nil
}

func (h *Handler) ListIssueSystemWakeups(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rules, err := h.listSystemWakeups(r.Context(), issue)
	if err != nil {
		slog.Warn("list system wakeups failed", "error", err, "issue_id", uuidToString(issue.ID))
		writeError(w, 500, "could not load system wakeups")
		return
	}
	writeJSON(w, 200, rules)
}

// UpdateIssueSystemWakeup turns a platform rule on or off for one issue and
// sets its supplementary instruction. Any workspace member who can see the
// issue may change it: the rule wakes the issue's own assignee, whose
// invocation was already authorized when the issue was assigned.
func (h *Handler) UpdateIssueSystemWakeup(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if chi.URLParam(r, "rule") != systemWakeupChildDone {
		writeError(w, 404, "system wakeup not found")
		return
	}
	var in struct {
		Enabled     bool   `json:"enabled"`
		Instruction string `json:"instruction"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, 400, "invalid system wakeup body")
		return
	}
	in.Instruction = strings.TrimSpace(in.Instruction)
	if len(in.Instruction) > maxSystemWakeupInstruction {
		writeError(w, 400, "instruction must be at most 4000 bytes")
		return
	}
	actorType, actorID := h.resolveActor(r, requestUserID(r), uuidToString(issue.WorkspaceID))
	originator := h.invokeOriginatorFromRequest(r, actorType, actorID)
	if originator == "" {
		writeError(w, 403, "a human originator is required")
		return
	}
	if _, err := h.getWorkspaceMember(r.Context(), originator, uuidToString(issue.WorkspaceID)); err != nil {
		writeError(w, 403, "wakeup permission denied")
		return
	}
	if _, err := h.Queries.UpsertIssueSystemWakeup(r.Context(), db.UpsertIssueSystemWakeupParams{
		IssueID: issue.ID, WorkspaceID: issue.WorkspaceID, Rule: systemWakeupChildDone,
		Enabled: in.Enabled, Instruction: in.Instruction, UpdatedBy: parseUUID(originator),
	}); err != nil {
		slog.Warn("update system wakeup failed", "error", err, "issue_id", uuidToString(issue.ID))
		writeError(w, 500, "could not save system wakeup")
		return
	}
	rules, err := h.listSystemWakeups(r.Context(), issue)
	if err != nil {
		writeError(w, 500, "could not load system wakeups")
		return
	}
	writeJSON(w, 200, rules)
}
