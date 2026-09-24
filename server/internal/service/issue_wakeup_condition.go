package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/issuestatus"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
)

// conditionPollInterval bounds how long a platform-evaluated condition can
// stay satisfied before its rule notices. Same-issue field conditions also
// subscribe to the matching event, so they usually react on the next tick.
const conditionPollInterval = 30 * time.Second

// WakeupCondition is a structured predicate the platform evaluates itself, so
// a rule only wakes its agent when the predicate becomes true. It compares
// stored facts (a field value, sub-issue status, a linked pull request's
// state); it does not interpret business meaning.
type WakeupCondition struct {
	// issue_field | children_done | pull_request | other_issue
	Type string `json:"type"`
	// issue_field: status | assignee | label | property
	Field        string          `json:"field,omitempty"`
	Value        json.RawMessage `json:"value,omitempty"`
	AssigneeType string          `json:"assignee_type,omitempty"`
	AssigneeID   string          `json:"assignee_id,omitempty"`
	LabelID      string          `json:"label_id,omitempty"`
	PropertyID   string          `json:"property_id,omitempty"`
	// children_done: a stage number, or every sub-issue when omitted.
	Stage *int32 `json:"stage,omitempty"`
	// pull_request: checks_finished | merged
	Event string `json:"event,omitempty"`
	// other_issue: the watched issue and done | ended | in_review. The
	// identifier is recorded for display; clients never set it.
	IssueID    string `json:"issue_id,omitempty"`
	State      string `json:"state,omitempty"`
	Identifier string `json:"identifier,omitempty"`
}

var errBadCondition = errors.New("invalid condition")

func badCondition(msg string) error {
	return fmt.Errorf("%w: %w: %s", ErrWakeupInput, errBadCondition, msg)
}

// validateCondition normalizes a condition against the issue's workspace and
// returns the same-issue events that should trigger an early evaluation.
func validateCondition(ctx context.Context, tx pgx.Tx, issue db.Issue, raw json.RawMessage) (json.RawMessage, []string, error) {
	var c WakeupCondition
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, nil, badCondition("unreadable condition")
	}
	ws := issue.WorkspaceID
	exists := func(sql string, args ...any) (bool, error) {
		var ok bool
		err := tx.QueryRow(ctx, "SELECT EXISTS("+sql+")", args...).Scan(&ok)
		return ok, err
	}
	uuidArg := func(s, what string) (pgtype.UUID, error) {
		id, err := util.ParseUUID(s)
		if err != nil {
			return id, badCondition(what + " must be a UUID")
		}
		return id, nil
	}
	var events []string
	var out WakeupCondition
	switch c.Type {
	case "issue_field":
		out = WakeupCondition{Type: c.Type, Field: c.Field}
		switch c.Field {
		case "status":
			var status string
			if json.Unmarshal(c.Value, &status) != nil || status == "" {
				return nil, nil, badCondition("status value must be a status key")
			}
			if !issuestatus.IsBuiltIn(status) {
				ok, err := exists("SELECT 1 FROM issue_status WHERE workspace_id=$1 AND key=$2", ws, status)
				if err != nil {
					return nil, nil, err
				}
				if !ok {
					return nil, nil, badCondition("unknown status")
				}
			}
			out.Value, _ = json.Marshal(status)
			events = []string{"issue.status_changed"}
		case "assignee":
			id, err := uuidArg(c.AssigneeID, "assignee_id")
			if err != nil {
				return nil, nil, err
			}
			var ok bool
			switch c.AssigneeType {
			case "member":
				ok, err = exists("SELECT 1 FROM member WHERE workspace_id=$1 AND user_id=$2", ws, id)
			case "agent":
				ok, err = exists("SELECT 1 FROM agent WHERE workspace_id=$1 AND id=$2", ws, id)
			case "squad":
				ok, err = exists("SELECT 1 FROM squad WHERE workspace_id=$1 AND id=$2", ws, id)
			default:
				return nil, nil, badCondition("assignee_type must be member, agent or squad")
			}
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				return nil, nil, badCondition("unknown assignee")
			}
			out.AssigneeType, out.AssigneeID = c.AssigneeType, util.UUIDToString(id)
			events = []string{"issue.assignee_changed"}
		case "label":
			id, err := uuidArg(c.LabelID, "label_id")
			if err != nil {
				return nil, nil, err
			}
			ok, err := exists("SELECT 1 FROM issue_label WHERE workspace_id=$1 AND id=$2", ws, id)
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				return nil, nil, badCondition("unknown label")
			}
			out.LabelID = util.UUIDToString(id)
			events = []string{"issue.labels_changed"}
		case "property":
			id, err := uuidArg(c.PropertyID, "property_id")
			if err != nil {
				return nil, nil, err
			}
			ok, err := exists("SELECT 1 FROM issue_property WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL", ws, id)
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				return nil, nil, badCondition("unknown property")
			}
			value := canonicalWakeupPayload(c.Value)
			if len(c.Value) == 0 || string(value) == "null" || len(value) > 1024 {
				return nil, nil, badCondition("property value must be a JSON value within 1 KB")
			}
			out.PropertyID, out.Value = util.UUIDToString(id), value
			events = []string{"issue.properties_changed"}
		default:
			return nil, nil, badCondition("field must be status, assignee, label or property")
		}
	case "children_done":
		if c.Stage != nil && (*c.Stage < 1 || *c.Stage > 1000) {
			return nil, nil, badCondition("stage must be a positive number")
		}
		out = WakeupCondition{Type: c.Type, Stage: c.Stage}
	case "pull_request":
		if c.Event != "checks_finished" && c.Event != "merged" {
			return nil, nil, badCondition("event must be checks_finished or merged")
		}
		out = WakeupCondition{Type: c.Type, Event: c.Event}
	case "other_issue":
		id, err := uuidArg(c.IssueID, "issue_id")
		if err != nil {
			return nil, nil, err
		}
		if id == issue.ID {
			return nil, nil, badCondition("watch another issue, not this one")
		}
		if c.State != "done" && c.State != "ended" && c.State != "in_review" {
			return nil, nil, badCondition("state must be done, ended or in_review")
		}
		var identifier string
		err = tx.QueryRow(ctx, "SELECT ws.issue_prefix||'-'||i.number FROM issue i JOIN workspace ws ON ws.id=i.workspace_id WHERE i.workspace_id=$1 AND i.id=$2", ws, id).Scan(&identifier)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, badCondition("unknown issue")
		}
		if err != nil {
			return nil, nil, err
		}
		out = WakeupCondition{Type: c.Type, IssueID: util.UUIDToString(id), State: c.State, Identifier: identifier}
	default:
		return nil, nil, badCondition("type must be issue_field, children_done, pull_request or other_issue")
	}
	normalized, _ := json.Marshal(out)
	return normalized, events, nil
}

// evaluateCondition reports whether the predicate holds, a fingerprint of the
// satisfying facts (so a rule fires when they change, not on every tick) and a
// small observation for the woken agent's trigger facts.
func evaluateCondition(ctx context.Context, tx pgx.Tx, q *db.Queries, w db.IssueWakeup) (bool, string, map[string]any, error) {
	var c WakeupCondition
	if err := json.Unmarshal(w.Condition, &c); err != nil {
		return false, "", nil, err
	}
	switch c.Type {
	case "issue_field":
		var status, assigneeType string
		var assigneeID pgtype.UUID
		var property json.RawMessage
		var labeled bool
		err := tx.QueryRow(ctx, `SELECT status,COALESCE(assignee_type,''),assignee_id,COALESCE(properties->($2::text),'null'::jsonb),
			EXISTS(SELECT 1 FROM issue_to_label l WHERE l.issue_id=issue.id AND l.label_id::text=$3::text)
			FROM issue WHERE id=$1`, w.IssueID, c.PropertyID, c.LabelID).Scan(&status, &assigneeType, &assigneeID, &property, &labeled)
		if err != nil {
			return false, "", nil, err
		}
		switch c.Field {
		case "status":
			var want string
			_ = json.Unmarshal(c.Value, &want)
			return status == want, "status:" + status, map[string]any{"status": status}, nil
		case "assignee":
			met := assigneeType == c.AssigneeType && util.UUIDToString(assigneeID) == c.AssigneeID
			return met, "assignee:" + assigneeType + ":" + util.UUIDToString(assigneeID), map[string]any{"assignee_type": assigneeType, "assignee_id": util.UUIDToString(assigneeID)}, nil
		case "label":
			return labeled, "label", map[string]any{"label_id": c.LabelID, "attached": labeled}, nil
		case "property":
			value := canonicalWakeupPayload(property)
			return bytes.Equal(value, canonicalWakeupPayload(c.Value)), "property:" + string(value), map[string]any{"property_id": c.PropertyID, "value": json.RawMessage(value)}, nil
		}
	case "children_done":
		rows, err := tx.Query(ctx, "SELECT status,stage FROM issue WHERE parent_issue_id=$1 AND workspace_id=$2", w.IssueID, w.WorkspaceID)
		if err != nil {
			return false, "", nil, err
		}
		type child struct {
			status string
			stage  pgtype.Int4
		}
		var children []child
		for rows.Next() {
			var ch child
			if err = rows.Scan(&ch.status, &ch.stage); err != nil {
				rows.Close()
				return false, "", nil, err
			}
			children = append(children, ch)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return false, "", nil, err
		}
		terminal := map[string]bool{}
		finished := func(status string) (bool, error) {
			if v, ok := terminal[status]; ok {
				return v, nil
			}
			category, err := issuestatus.CategoryWithError(ctx, q, w.WorkspaceID, status)
			if err != nil {
				return false, err
			}
			terminal[status] = category == "done" || category == "closed"
			return terminal[status], nil
		}
		total, done, inStage := 0, 0, 0
		for _, ch := range children {
			if c.Stage != nil && (!ch.stage.Valid || ch.stage.Int32 > *c.Stage) {
				continue
			}
			if c.Stage != nil && ch.stage.Int32 == *c.Stage {
				inStage++
			}
			total++
			ok, err := finished(ch.status)
			if err != nil {
				return false, "", nil, err
			}
			if ok {
				done++
			}
		}
		met := total > 0 && done == total && (c.Stage == nil || inStage > 0)
		return met, fmt.Sprintf("children:%d", total), map[string]any{"finished": done, "total": total}, nil
	case "pull_request":
		rows, err := tx.Query(ctx, `SELECT pr.pr_number,pr.state,COALESCE(pr.snapshot_head_sha,''),COALESCE(pr.checks_rollup_state,'')
			FROM github_pull_request pr JOIN issue_pull_request ipr ON ipr.pull_request_id=pr.id WHERE ipr.issue_id=$1`, w.IssueID)
		if err != nil {
			return false, "", nil, err
		}
		var keys []string
		var prs []map[string]any
		for rows.Next() {
			var number int32
			var state, head, checks string
			if err = rows.Scan(&number, &state, &head, &checks); err != nil {
				rows.Close()
				return false, "", nil, err
			}
			switch c.Event {
			case "merged":
				if state == "merged" {
					keys = append(keys, fmt.Sprintf("%d", number))
					prs = append(prs, map[string]any{"number": number, "state": state})
				}
			case "checks_finished":
				if head != "" && slices.Contains([]string{"SUCCESS", "FAILURE", "ERROR"}, checks) {
					keys = append(keys, fmt.Sprintf("%d@%s:%s", number, head, checks))
					prs = append(prs, map[string]any{"number": number, "head_sha": head, "checks": strings.ToLower(checks)})
				}
			}
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return false, "", nil, err
		}
		sort.Strings(keys)
		return len(keys) > 0, "pr:" + strings.Join(keys, ","), map[string]any{"pull_requests": prs}, nil
	case "other_issue":
		var status string
		var number int32
		err := tx.QueryRow(ctx, "SELECT status,number FROM issue WHERE id=$1 AND workspace_id=$2", c.IssueID, w.WorkspaceID).Scan(&status, &number)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", map[string]any{"deleted": true}, nil
		}
		if err != nil {
			return false, "", nil, err
		}
		category, err := issuestatus.CategoryWithError(ctx, q, w.WorkspaceID, status)
		if err != nil {
			return false, "", nil, err
		}
		var met bool
		switch c.State {
		case "done":
			met = category == "done"
		case "ended":
			met = category == "done" || category == "closed"
		case "in_review":
			met = status == "in_review"
		}
		return met, "issue:" + status, map[string]any{"issue_id": c.IssueID, "status": status}, nil
	}
	return false, "", nil, fmt.Errorf("unknown condition type %q", c.Type)
}

// conditionHintSQL selects the event receipts a condition rule subscribes to.
// They only prompt an early evaluation and never become run inputs.
const conditionHintSQL = "wakeup_id=$1 AND processed_at IS NULL AND event_type NOT IN ('condition.met','wakeup.timeout','wakeup.manual')"

func consumeConditionHints(ctx context.Context, tx pgx.Tx, id pgtype.UUID) (bool, error) {
	tag, err := tx.Exec(ctx, "UPDATE issue_wakeup_receipt SET processed_at=now() WHERE "+conditionHintSQL, id)
	return tag.RowsAffected() > 0, err
}

// pollCondition evaluates a condition rule when it is due or a related event
// arrived, and returns the next scheduled evaluation. A newly satisfied
// predicate becomes one condition.met input for the ordinary dispatch below.
func pollCondition(ctx context.Context, tx pgx.Tx, q *db.Queries, w db.IssueWakeup, now time.Time) (pgtype.Timestamptz, error) {
	hinted, err := consumeConditionHints(ctx, tx, w.ID)
	if err != nil {
		return w.NextFireAt, err
	}
	if !hinted && w.NextFireAt.Valid && w.NextFireAt.Time.After(now) {
		return w.NextFireAt, nil
	}
	met, fingerprint, observed, err := evaluateCondition(ctx, tx, q, w)
	if err != nil {
		return w.NextFireAt, err
	}
	// condition_state dedups a satisfied predicate; each new satisfaction
	// gets its own receipt key.
	state := w.ConditionState
	if met && fingerprint != state {
		payload, _ := json.Marshal(map[string]any{"condition": json.RawMessage(w.Condition), "observed": observed, "observed_at": now.UTC().Format(time.RFC3339)})
		if _, err = q.RecordWakeupReceipt(ctx, db.RecordWakeupReceiptParams{ID: dbid.NewV7(), WakeupID: w.ID, Revision: w.Revision, EventKey: "condition:" + now.UTC().Format(time.RFC3339Nano), EventType: wakeupConditionEventType, Payload: payload}); err != nil {
			return w.NextFireAt, err
		}
		state = fingerprint
	} else if !met {
		state = ""
	}
	next := pgtype.Timestamptz{Time: now.Add(conditionPollInterval), Valid: true}
	return next, q.SetWakeupConditionState(ctx, db.SetWakeupConditionStateParams{ID: w.ID, ConditionState: state, NextFireAt: next})
}

// conditionFiresOnChange reports whether facts already true at registration
// are ignored. Finished checks usually belong to the head the agent just
// replaced, so a checks condition waits for a newer result; states such as a
// status value, finished sub-issues or a merged PR fire as soon as they hold.
func conditionFiresOnChange(raw []byte) bool {
	var c WakeupCondition
	_ = json.Unmarshal(raw, &c)
	return c.Type == "pull_request" && c.Event == "checks_finished"
}

// baselineCondition records which facts already satisfy a new or re-enabled
// rule, so it wakes the agent when they change rather than immediately.
func baselineCondition(ctx context.Context, tx pgx.Tx, q *db.Queries, w db.IssueWakeup, now time.Time) error {
	met, fingerprint, _, err := evaluateCondition(ctx, tx, q, w)
	if err != nil {
		return err
	}
	if !met {
		fingerprint = ""
	}
	return q.SetWakeupConditionState(ctx, db.SetWakeupConditionStateParams{ID: w.ID, ConditionState: fingerprint, NextFireAt: pgtype.Timestamptz{Time: now.Add(conditionPollInterval), Valid: true}})
}
