"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Download,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import { SkillIcon } from "../lib/skill-icon";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
  Skill,
  SkillFile,
  UpdateSkillRequest,
} from "@multica/core/types";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import { useTimeAgo } from "../../i18n";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  agentListOptions,
  memberListOptions,
  selectSkillAssignments,
  skillDetailOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { resolvePublicFileUrl } from "@multica/core/workspace/avatar-url";
import {
  runtimeDisplayLabel,
  runtimeListOptions,
} from "@multica/core/runtimes";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { Button, buttonVariants } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { AppLink, useNavigation } from "../../navigation";
import { PAGE_GUTTER, PAGE_RAIL } from "../../layout/page-header";
import {
  DETAIL_CARD,
  DetailIconMark,
  DetailStatusPill,
  DetailSubline,
  EntityDetailHeader,
} from "../../layout/detail-header";
import { useCanEditSkill } from "../hooks/use-can-edit-skill";
import { useSkillPermissions } from "@multica/core/permissions";
import { CapabilityBanner } from "@multica/ui/components/common/capability-banner";
import {
  isRefreshableOrigin,
  originSourceUrl,
  readOrigin,
  totalFileCount,
  type OriginInfo,
} from "../lib/origin";
import { FileTree } from "./file-tree";
import { FileViewer, isMarkdownPath, type FileMode } from "./file-viewer";
import {
  AddToAgentDialog,
  type SkillActionsContext,
} from "./skill-list-actions";
import { RefreshSkillDialog } from "./refresh-skill-dialog";
import { useT } from "../../i18n";
import { ResourceLabelPicker } from "../../labels/resource-label-picker";

const SKILL_MD = "SKILL.md";

type DraftFile = { id?: string; path: string; content: string };

/** The four editable fields, as one snapshot. */
type SkillDraft = {
  name: string;
  description: string;
  content: string;
  files: DraftFile[];
};

/**
 * Server skill -> editable draft.
 *
 * `name` and `description` are trimmed here because Save trims them too:
 * normalizing once, at the single seam where server data becomes a draft, is
 * what lets every later comparison be plain equality. Trimming at comparison
 * time instead is how the two sides drifted apart in the first place — the
 * dirty check trimmed one operand and not the other, so a description ending
 * in a newline (what `description: |` frontmatter yields) never compared equal
 * to itself and the page opened permanently dirty.
 *
 * `content` and file bodies are deliberately NOT normalized: leading and
 * trailing whitespace in a SKILL.md body is content, not formatting.
 */
function toDraft(s: Skill): SkillDraft {
  return {
    name: s.name.trim(),
    description: s.description.trim(),
    content: s.content,
    files: (s.files ?? []).map((f: SkillFile) => ({
      id: f.id,
      path: f.path,
      content: f.content,
    })),
  };
}

/**
 * Order-insensitive snapshot of a file set. The two endpoints that return
 * files disagree on order — GET sorts by path, PUT echoes request order — and
 * an order difference is not a content difference.
 */
function fileSignature(files: DraftFile[]): string {
  return JSON.stringify(
    files
      .map((f) => ({ path: f.path, content: f.content }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
}

/**
 * Did the USER change anything, measured against the draft we handed them?
 *
 * Deliberately not "does the draft differ from the latest server skill": that
 * question conflates two independent causes — the user typed something, or the
 * server moved underneath us — and answering it as if only the first existed
 * is what made every remote update look like a local edit.
 */
function hasLocalEdits(draft: SkillDraft, baseline: SkillDraft | null): boolean {
  if (!baseline) return false;
  return (
    draft.name.trim() !== baseline.name ||
    draft.description.trim() !== baseline.description ||
    draft.content !== baseline.content ||
    fileSignature(draft.files) !== fileSignature(baseline.files)
  );
}

// ---------------------------------------------------------------------------
// File path validation + inline add
// ---------------------------------------------------------------------------

export function useValidateNewFilePath() {
  const { t } = useT("skills");
  return (path: string, existing: string[]): string => {
    const p = path.trim();
    if (!p) return t(($) => $.detail.add_file.errors.empty);
    if (p.startsWith("/")) return t(($) => $.detail.add_file.errors.absolute);
    if (p.split("/").includes("..")) return t(($) => $.detail.add_file.errors.double_dot);
    if (p === SKILL_MD) return t(($) => $.detail.add_file.errors.reserved);
    if (existing.includes(p)) return t(($) => $.detail.add_file.errors.exists);
    // Directories are inferred from paths, not stored, so a file named after
    // one merges into that folder's node when the tree is built — it drops off
    // the rail while still sitting in the draft. Rejected in both directions:
    // a file cannot take a folder's name, and cannot take a name that an
    // existing file is already nested under.
    if (existing.some((other) => other.startsWith(`${p}/`))) {
      return t(($) => $.detail.add_file.errors.is_directory);
    }
    if (existing.some((other) => p.startsWith(`${other}/`))) {
      return t(($) => $.detail.add_file.errors.under_file);
    }
    return "";
  };
}

function AddFileInline({
  existingPaths,
  onAdd,
  onCancel,
}: {
  existingPaths: string[];
  onAdd: (path: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT("skills");
  const validate = useValidateNewFilePath();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const err = validate(path, existingPaths);
    if (err) {
      setError(err);
      return;
    }
    onAdd(path.trim());
  };

  return (
    <div className="mt-1.5">
      <Input
        autoFocus
        value={path}
        onChange={(e) => {
          setPath(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t(($) => $.detail.add_file.placeholder)}
        className="h-7 font-mono text-caption"
      />
      {error && (
        <p role="alert" className="mt-1 text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button type="button" size="xs" onClick={submit}>
          {t(($) => $.detail.add_file.add)}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          {t(($) => $.detail.add_file.cancel)}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function useOriginLabel(origin: OriginInfo | null, runtime: AgentRuntime | null) {
  const { t } = useT("skills");
  if (!origin) return null;
  if (origin.type === "runtime_local") {
    return runtime
      ? t(($) => $.detail.subline.origin_runtime_named, {
          name: runtimeDisplayLabel(runtime),
        })
      : origin.provider
        ? t(($) => $.detail.subline.origin_runtime_provider, { provider: origin.provider })
        : t(($) => $.detail.subline.origin_runtime_unknown);
  }
  if (origin.type === "clawhub") return t(($) => $.detail.subline.origin_clawhub);
  if (origin.type === "skills_sh") return t(($) => $.detail.subline.origin_skills_sh);
  if (origin.type === "github") return t(($) => $.detail.subline.origin_github);
  return t(($) => $.detail.subline.origin_workspace);
}

/**
 * Where the skill came from, as the header's status pill. Imported skills
 * link to their upstream page.
 */
function OriginPill({
  origin,
  originRuntime,
}: {
  origin: OriginInfo | null;
  originRuntime: AgentRuntime | null;
}) {
  const originLabel = useOriginLabel(origin, originRuntime);
  const sourceUrl = originSourceUrl(origin);
  if (!originLabel) return null;
  const Icon =
    origin?.type === "runtime_local"
      ? HardDrive
      : origin?.type === "manual"
        ? Pencil
        : Download;
  return (
    <DetailStatusPill>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {sourceUrl ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate hover:underline"
              >
                {originLabel}
              </a>
            }
          />
          <TooltipContent side="top">{sourceUrl}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="min-w-0 truncate">{originLabel}</span>
      )}
    </DetailStatusPill>
  );
}

// ---------------------------------------------------------------------------
// File browser
// ---------------------------------------------------------------------------

/**
 * The skill IS its files, so the page opens straight on them: the tree on
 * the left, the open file in the middle. SKILL.md is pinned first because
 * it is what an agent loads; supporting files follow.
 */
function FileTreeRail({
  filePaths,
  selectedPath,
  canEdit,
  addingFile,
  onSelectPath,
  onStartAddFile,
  onAddFile,
  onCancelAddFile,
  onDeleteFile,
  onRenameFile,
  onEditFile,
}: {
  filePaths: string[];
  selectedPath: string;
  canEdit: boolean;
  addingFile: boolean;
  onSelectPath: (path: string) => void;
  onStartAddFile: () => void;
  onAddFile: (path: string) => void;
  onCancelAddFile: () => void;
  onDeleteFile: (path?: string) => void;
  onRenameFile: (from: string, to: string) => void;
  onEditFile: (path: string) => void;
}) {
  const { t } = useT("skills");
  const validatePath = useValidateNewFilePath();
  const supportingPaths = filePaths.filter((p) => p !== SKILL_MD);
  // Absent for read-only viewers so the tree never offers an action it would
  // then refuse. Both lists get the same object: SKILL.md keeps Edit and loses
  // rename/delete, which the tree derives from reservedPath.
  const treeActions = canEdit
    ? {
        onEdit: onEditFile,
        validatePath,
        onRename: onRenameFile,
        onDelete: onDeleteFile,
        reservedPath: SKILL_MD,
      }
    : undefined;

  return (
    <aside
      role="tablist"
      aria-orientation="vertical"
      aria-label={t(($) => $.detail.files.list_aria)}
      className="min-w-0 xl:overflow-y-auto"
    >
      <div className="flex items-center justify-between px-2.5 pb-1">
        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          {t(($) => $.detail.files.main)}
        </p>
      </div>
      <FileTree
        actions={treeActions}
        filePaths={[SKILL_MD]}
        selectedPath={selectedPath}
        onSelect={onSelectPath}
      />

      <p className="px-2.5 pb-1 pt-4 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {t(($) => $.detail.files.supporting, { count: supportingPaths.length })}
      </p>
      {supportingPaths.length > 0 ? (
        <FileTree
          actions={treeActions}
          filePaths={supportingPaths}
          selectedPath={selectedPath}
          onSelect={onSelectPath}
        />
      ) : (
        !addingFile && (
          <p className="px-2.5 py-1 text-caption text-muted-foreground">
            {t(($) => $.detail.files.supporting_empty)}
          </p>
        )
      )}

      {canEdit &&
        (addingFile ? (
          <div className="px-1">
            <AddFileInline
              existingPaths={filePaths}
              onAdd={onAddFile}
              onCancel={onCancelAddFile}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onStartAddFile}
            className="mt-2 h-8 w-full justify-start px-2.5 text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            {t(($) => $.detail.files.add_file)}
          </Button>
        ))}
    </aside>
  );
}

function FilePane({
  selectedPath,
  selectedContent,
  mode,
  canEdit,
  focusEditor,
  onModeChange,
  onDeleteFile,
  onContentChange,
  onFocusHandled,
}: {
  selectedPath: string;
  selectedContent: string;
  mode: FileMode;
  canEdit: boolean;
  focusEditor: boolean;
  onModeChange: (mode: FileMode) => void;
  onDeleteFile: (path?: string) => void;
  onContentChange: (content: string) => void;
  onFocusHandled: () => void;
}) {
  const { t } = useT("skills");
  const isMd = isMarkdownPath(selectedPath);
  return (
    <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface shadow-[var(--surface-shadow)] xl:min-h-0">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-surface-border px-4">
        <span className="truncate font-mono text-caption text-foreground">
          {selectedPath}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isMd && (
            // The second segment is named for what it does for THIS viewer:
            // "Edit" when the pane it opens accepts typing, "Plain text" when
            // the same pane is read-only. Same mode either way — only the
            // promise differs.
            <div
              role="group"
              aria-label={t(($) => $.detail.files.mode_aria)}
              className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
            >
              {(["preview", "raw"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => onModeChange(value)}
                  className={cn(
                    "h-6 rounded-xs px-2 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === value
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "preview"
                    ? t(($) => $.detail.files.mode_preview)
                    : canEdit
                      ? t(($) => $.detail.files.mode_edit)
                      : t(($) => $.detail.files.mode_raw)}
                </button>
              ))}
            </div>
          )}
          {selectedPath !== SKILL_MD && canEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDeleteFile()}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t(($) => $.detail.delete_file)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent>{t(($) => $.detail.delete_file)}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <FileViewer
          key={selectedPath}
          path={selectedPath}
          content={selectedContent}
          mode={mode}
          readOnly={!canEdit}
          autoFocus={focusEditor}
          onChange={onContentChange}
          onFocusHandled={onFocusHandled}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

function RailCard({
  title,
  titleFor,
  aside,
  children,
}: {
  title: string;
  titleFor?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={DETAIL_CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        {titleFor ? (
          <label htmlFor={titleFor} className="text-body font-medium">
            {title}
          </label>
        ) : (
          <h2 className="text-body font-medium">{title}</h2>
        )}
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The description is what an agent reads to decide whether to load the
 * skill, so it gets its own card at the top of the rail, sized for the
 * 500–900 characters real descriptions run to.
 */
function TriggerCard({
  description,
  canEdit,
  onDescriptionChange,
}: {
  description: string;
  canEdit: boolean;
  onDescriptionChange: (value: string) => void;
}) {
  const { t } = useT("skills");
  return (
    <RailCard
      title={t(($) => $.detail.overview.description)}
      titleFor="skill-description"
    >
      <Textarea
        id="skill-description"
        value={description}
        readOnly={!canEdit}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder={t(($) => $.detail.description_placeholder)}
        rows={7}
        className="text-body leading-relaxed read-only:cursor-default"
      />
      <p className="mt-2 text-caption text-muted-foreground">
        {t(($) => $.detail.overview.description_hint)}
        {" · "}
        <span className="tabular-nums">
          {t(($) => $.detail.overview.character_count, {
            count: description.length,
          })}
        </span>
      </p>
    </RailCard>
  );
}

/**
 * Who uses the skill, with a switch per agent. Off pauses the skill for
 * that agent and keeps the assignment, the same switch as on the agent's
 * configuration page.
 */
function UsedByCard({
  skillId,
  agents,
  canManageAgent,
  onAdd,
}: {
  skillId: string;
  agents: Agent[];
  canManageAgent: (agent: Agent) => boolean;
  onAdd: () => void;
}) {
  const { t } = useT("skills");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (agent: Agent, enabled: boolean) => {
    setBusyId(agent.id);
    try {
      await api.setAgentSkillEnabled(agent.id, skillId, enabled);
      await qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.detail.rail.toggle_failed),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <RailCard
      title={t(($) => $.detail.overview.used_by, { count: agents.length })}
      aside={
        <Button variant="ghost" size="xs" className="gap-1" onClick={onAdd}>
          <UserPlus className="h-3 w-3" />
          {t(($) => $.actions.add_to_agent)}
        </Button>
      }
    >
      {agents.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.detail.overview.used_by_empty)}
        </p>
      ) : (
        <ul className="-mx-2">
          {agents.map((agent) => {
            const enabled =
              agent.skills?.find((entry) => entry.id === skillId)?.enabled !==
              false;
            return (
              <li
                key={agent.id}
                className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5"
              >
                <ActorAvatar
                  name={agent.name}
                  initials={agent.name.slice(0, 2).toUpperCase()}
                  avatarUrl={resolvePublicFileUrl(agent.avatar_url)}
                  isAgent
                  size="md"
                />
                <span className="min-w-0 flex-1 truncate text-body">
                  {agent.name}
                </span>
                <Switch
                  size="sm"
                  checked={enabled}
                  disabled={!canManageAgent(agent) || busyId === agent.id}
                  onCheckedChange={(next) => void toggle(agent, next)}
                  aria-label={t(($) => $.detail.rail.toggle_aria, {
                    name: agent.name,
                  })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </RailCard>
  );
}

function PropertiesCard({
  skill,
  name,
  canEdit,
  creator,
  onNameChange,
}: {
  skill: Skill;
  name: string;
  canEdit: boolean;
  creator: MemberWithUser | null;
  onNameChange: (value: string) => void;
}) {
  const { t } = useT("skills");
  const timeAgo = useTimeAgo();
  return (
    <RailCard title={t(($) => $.detail.overview.properties)}>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="skill-name"
            className="text-caption text-muted-foreground"
          >
            {t(($) => $.detail.overview.name)}
          </label>
          <Input
            id="skill-name"
            value={name}
            readOnly={!canEdit}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t(($) => $.detail.name_placeholder)}
            className="mt-1 font-mono text-body read-only:cursor-default"
          />
        </div>
        <div>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.detail.overview.labels)}
          </p>
          <div className="mt-1">
            <ResourceLabelPicker
              resourceType="skill"
              resourceId={skill.id}
              canEdit={canEdit}
            />
          </div>
        </div>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption">
          <dt className="text-muted-foreground">
            {t(($) => $.table.created_by)}
          </dt>
          <dd className="truncate">{creator?.name ?? "—"}</dd>
          <dt className="text-muted-foreground">{t(($) => $.table.updated)}</dt>
          <dd>{timeAgo(skill.updated_at)}</dd>
        </dl>
        <p className="rounded-lg bg-muted px-3 py-2 text-caption leading-relaxed text-muted-foreground">
          {canEdit
            ? t(($) => $.detail.overview.permissions_owner)
            : creator
              ? t(($) => $.detail.overview.permissions_locked_creator, {
                  name: creator.name,
                })
              : t(($) => $.detail.overview.permissions_locked)}
        </p>
      </div>
    </RailCard>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const { t } = useT("skills");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const timeAgo = useTimeAgo();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const {
    data: skill,
    isLoading,
    error,
  } = useQuery(skillDetailOptions(wsId, skillId));
  const { data: agents = [], error: agentsError } = useQuery(
    agentListOptions(wsId),
  );
  const { data: members = [], error: membersError } = useQuery(
    memberListOptions(wsId),
  );
  const { data: runtimes = [], error: runtimesError } = useQuery(
    runtimeListOptions(wsId),
  );

  const assignments = useMemo(() => selectSkillAssignments(agents), [agents]);

  const canEdit = useCanEditSkill(skill, wsId);
  const skillPermissions = useSkillPermissions(skill ?? null, wsId);

  // Context for the shared "Add to agent" dialog (also used by the skills
  // list). Members see their own agents; workspace owners/admins see all.
  const myRole = useMemo(
    () => members.find((m) => m.user_id === currentUserId)?.role ?? null,
    [members, currentUserId],
  );
  const actionsCtx: SkillActionsContext = {
    wsId,
    agents,
    currentUserId,
    isAdmin: myRole === "owner" || myRole === "admin",
  };

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [selectedPath, setSelectedPath] = useState(SKILL_MD);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [showAddToAgents, setShowAddToAgents] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [conflictPending, setConflictPending] = useState(false);

  // Preview/raw is a property of how the user wants to work, so it lives here
  // and survives switching files. It used to live inside FileViewer, which the
  // per-file `key` remounted — every file switch silently snapped back.
  const [fileMode, setFileMode] = useState<FileMode>("preview");
  // Which file's editor is waiting for the caret. A path rather than a boolean
  // so a request raised for one row cannot land in another row's editor if the
  // selection moves before the effect runs.
  const [focusPath, setFocusPath] = useState<string | null>(null);

  const draftRef = useRef({ name, description, content, files });
  draftRef.current = { name, description, content, files };

  const seededKeyRef = useRef<string | null>(null);

  /**
   * The draft this page last handed the user, normalized by `toDraft`. Dirty
   * state is measured against THIS, never against the latest server skill.
   *
   * INVARIANT: `seedFromSkill` is the only writer, and it always writes the
   * same snapshot it pushes into state. `dirtySummary` is a `useMemo` keyed on
   * those state values, so every baseline write is paired with the state
   * change that recomputes it. Assigning this ref anywhere else breaks that
   * pairing and silently re-opens MUL-5645.
   */
  const baselineRef = useRef<SkillDraft | null>(null);

  const seedFromSkill = useCallback((s: Skill) => {
    const seeded = toDraft(s);
    setName(seeded.name);
    setDescription(seeded.description);
    setContent(seeded.content);
    setFiles(seeded.files);
    baselineRef.current = seeded;
  }, []);

  /**
   * Adopt a server version wholesale: draft, baseline, seeded key and conflict
   * flag all move together. Every path that accepts a server version goes
   * through here — first load, silent refresh, Save, Discard — so the four
   * pieces can never drift apart.
   */
  const adoptServerVersion = useCallback(
    (s: Skill, resetSelection = false) => {
      seededKeyRef.current = `${wsId}:${s.id}@${s.updated_at}`;
      setConflictPending(false);
      seedFromSkill(s);
      if (resetSelection) setSelectedPath(SKILL_MD);
    },
    [wsId, seedFromSkill],
  );

  useEffect(() => {
    if (!skill) return;
    if (seededKeyRef.current === `${wsId}:${skill.id}@${skill.updated_at}`) {
      return;
    }

    const sameSkill =
      seededKeyRef.current !== null &&
      seededKeyRef.current.startsWith(`${wsId}:${skill.id}@`);

    // Same skill, newer server version. Whether that is a conflict depends on
    // the local draft alone: with no local edits the user is simply reading
    // the page, so pull the new version in silently instead of accusing them
    // of an edit they never made and freezing the editor on stale text.
    //
    // Re-run on draft changes, not just on new server versions: a conflict the
    // user resolves by reverting their own edits has to release the page. The
    // save bar is dirty-gated, so holding the conflict past that point would
    // leave the banner above stale text with no Discard left to press.
    if (sameSkill && hasLocalEdits(draftRef.current, baselineRef.current)) {
      setConflictPending(true);
      return;
    }

    adoptServerVersion(skill, !sameSkill);
  }, [skill, wsId, adoptServerVersion, name, description, content, files]);

  const creator = useMemo<MemberWithUser | null>(
    () =>
      skill?.created_by
        ? members.find((m) => m.user_id === skill.created_by) ?? null
        : null,
    [members, skill?.created_by],
  );

  const origin = useMemo(() => (skill ? readOrigin(skill) : null), [skill]);
  const originRuntime = useMemo<AgentRuntime | null>(() => {
    if (!origin || origin.type !== "runtime_local" || !origin.runtime_id)
      return null;
    return runtimes.find((r) => r.id === origin.runtime_id) ?? null;
  }, [origin, runtimes]);

  const skillAgents = useMemo(
    () => assignments.get(skillId) ?? [],
    [assignments, skillId],
  );

  const fileMap = useMemo(() => {
    const map = new Map<string, string>();
    map.set(SKILL_MD, content);
    for (const f of files) if (f.path.trim()) map.set(f.path, f.content);
    return map;
  }, [content, files]);
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap]);
  const selectedContent = fileMap.get(selectedPath) ?? "";

  useEffect(() => {
    if (selectedPath !== SKILL_MD && !fileMap.has(selectedPath)) {
      setSelectedPath(SKILL_MD);
    }
  }, [fileMap, selectedPath]);

  // Compared against the seeded baseline, not against the latest server skill,
  // so a remote update can never read as a local edit. Files are matched by id
  // so a rename counts as one changed file, not a delete plus an add; SKILL.md
  // is its own entry since it lives in `content`.
  const dirtySummary = useMemo(() => {
    const baseline = baselineRef.current;
    if (!baseline) {
      return { nameChanged: false, descChanged: false, changedFileCount: 0 };
    }
    const baselineById = new Map(
      baseline.files.flatMap((f) => (f.id ? [[f.id, f] as const] : [])),
    );
    let changedFileCount = content !== baseline.content ? 1 : 0;
    const draftIds = new Set<string>();
    for (const f of files) {
      if (f.id) draftIds.add(f.id);
      const base = f.id ? baselineById.get(f.id) : undefined;
      if (!base || base.path !== f.path || base.content !== f.content) {
        changedFileCount += 1;
      }
    }
    for (const f of baseline.files) {
      if (f.id && !draftIds.has(f.id)) changedFileCount += 1;
    }
    return {
      nameChanged: name.trim() !== baseline.name,
      descChanged: description.trim() !== baseline.description,
      changedFileCount,
    };
  }, [name, description, content, files]);

  const isDirty =
    dirtySummary.nameChanged ||
    dirtySummary.descChanged ||
    dirtySummary.changedFileCount > 0;

  const handleSave = async () => {
    if (!skill || !canEdit) return;
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    setSaving(true);
    try {
      const payload: UpdateSkillRequest = {
        name: trimmedName,
        description: trimmedDesc,
        content,
        files: files.filter((f) => f.path.trim()),
      };
      const updated = await api.updateSkill(skill.id, payload);
      qc.setQueryData(skillDetailOptions(wsId, skill.id).queryKey, updated);
      adoptServerVersion(updated);
      qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.toast_saved));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.detail.toast_save_failed));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!skill) return;
    adoptServerVersion(skill);
  };

  const handleDelete = async () => {
    if (!skill) return;
    setDeleting(true);
    try {
      await api.deleteSkill(skill.id);
      navigation.replace(paths.skills());
      qc.removeQueries({
        queryKey: skillDetailOptions(wsId, skill.id).queryKey,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.toast_deleted));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.detail.toast_delete_failed),
      );
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleAddFile = (path: string) => {
    setFiles((prev) => [...prev, { path, content: "" }]);
    setSelectedPath(path);
    setAddingFile(false);
  };

  // Defaults to the open file so the editor's own delete button keeps working;
  // the tree passes the row that was acted on, which need not be the open one.
  const handleDeleteFile = (path: string = selectedPath) => {
    if (path === SKILL_MD) return;
    setFiles((prev) => prev.filter((f) => f.path !== path));
    if (path === selectedPath) setSelectedPath(SKILL_MD);
  };

  // "Edit" from a row menu is one gesture that owes three things: the file is
  // open, the pane is the editor rather than the preview, and the caret is in
  // it. Doing fewer would leave the user another click away from typing, which
  // is the whole reason the entry exists.
  const handleEditFile = useCallback(
    (path: string) => {
      if (!canEdit) return;
      setSelectedPath(path);
      setFileMode("raw");
      setFocusPath(path);
    },
    [canEdit],
  );

  const handleFocusHandled = useCallback(() => setFocusPath(null), []);

  const handleRenameFile = (from: string, to: string) => {
    if (from === SKILL_MD) return;
    setFiles((prev) =>
      prev.map((f) => (f.path === from ? { ...f, path: to } : f)),
    );
    // Follow the file: the rail is keyed by path, so leaving the selection on
    // the old one would land on a row that no longer exists.
    if (from === selectedPath) setSelectedPath(to);
  };

  const handleFileContentChange = (newContent: string) => {
    if (!canEdit) return;
    if (selectedPath === SKILL_MD) {
      setContent(newContent);
    } else {
      setFiles((prev) =>
        prev.map((f) =>
          f.path === selectedPath ? { ...f, content: newContent } : f,
        ),
      );
    }
  };

  const supportingQueryDown = !!agentsError || !!membersError || !!runtimesError;

  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-3 rounded-xs" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className={cn(PAGE_RAIL, PAGE_GUTTER, "space-y-3 py-6")}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="xs"
            render={<AppLink href={paths.skills()} />}
            nativeButton={false}
          >
            {t(($) => $.detail.all_skills)}
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <AlertCircle className="h-8 w-8 text-faint-foreground" />
          <p className="text-body font-medium">{t(($) => $.detail.not_found.title)}</p>
          <p className="max-w-xs text-caption text-muted-foreground">
            {error instanceof Error ? error.message : t(($) => $.detail.not_found.fallback)}
          </p>
          <AppLink
            href={paths.skills()}
            className={`${buttonVariants({ variant: "outline", size: "xs" })} mt-2`}
          >
            {t(($) => $.detail.not_found.back)}
          </AppLink>
        </div>
      </div>
    );
  }

  // Segments reuse the overview field labels so the pill and the fields it
  // points at never use different words for the same thing.
  const changedParts = [
    dirtySummary.nameChanged ? t(($) => $.detail.overview.name) : null,
    dirtySummary.descChanged ? t(($) => $.detail.overview.description) : null,
    dirtySummary.changedFileCount > 0
      ? t(($) => $.detail.save_bar.changed_files, {
          count: dirtySummary.changedFileCount,
        })
      : null,
  ].filter((part): part is string => part !== null);

  const canManageAgent = (agent: Agent) =>
    actionsCtx.isAdmin || agent.owner_id === currentUserId;

  return (
    // relative: positioning anchor for the floating save pill (page-centered,
    // same rule as the skills list batch toolbar).
    <div className="relative flex flex-1 min-h-0 flex-col">
      <EntityDetailHeader
        parent={{ href: paths.skills(), label: t(($) => $.page.title) }}
        media={
          <DetailIconMark>
            <SkillIcon aria-hidden="true" />
          </DetailIconMark>
        }
        title={skill.name}
        titleClassName="font-mono"
        status={<OriginPill origin={origin} originRuntime={originRuntime} />}
        description={
          <DetailSubline>
            {[
              t(($) => $.detail.header.files, { count: totalFileCount(skill) }),
              t(($) => $.detail.header.used_by, { count: skillAgents.length }),
              creator
                ? t(($) => $.detail.header.updated_by, {
                    when: timeAgo(skill.updated_at),
                    name: creator.name,
                  })
                : t(($) => $.detail.header.updated, {
                    when: timeAgo(skill.updated_at),
                  }),
            ].join(" · ")}
          </DetailSubline>
        }
        actions={
          <>
            {canEdit && origin && isRefreshableOrigin(origin) && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmRefresh(true)}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      {t(($) => $.detail.refresh.button)}
                    </Button>
                  }
                />
                <TooltipContent>
                  {t(($) => $.detail.refresh.tooltip)}
                </TooltipContent>
              </Tooltip>
            )}
            <Button size="sm" onClick={() => setShowAddToAgents(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              {t(($) => $.actions.add_to_agent)}
            </Button>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" />}
                  aria-label={t(($) => $.detail.more_actions_aria)}
                >
                  <MoreHorizontal
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(($) => $.detail.delete_tooltip)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {!canEdit && (
        <div className={cn(PAGE_RAIL, PAGE_GUTTER, "pb-3")}>
          <CapabilityBanner
            reason={skillPermissions.canEdit.reason}
            resource="skill"
            ownerName={creator?.name}
          />
        </div>
      )}

      {supportingQueryDown && (
        <div
          role="status"
          className="shrink-0 border-t bg-warning/10 py-2 text-caption text-muted-foreground"
        >
          <div className={cn(PAGE_RAIL, PAGE_GUTTER, "flex items-start gap-2")}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>{t(($) => $.detail.supporting_data_warning)}</span>
          </div>
        </div>
      )}

      {conflictPending && canEdit && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 border-t border-warning/30 bg-warning/10 py-2 text-caption"
        >
          <div className={cn(PAGE_RAIL, PAGE_GUTTER, "flex items-start gap-2")}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="flex-1">
              <div className="font-medium text-foreground">
                {t(($) => $.detail.conflict_banner.title)}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {t(($) => $.detail.conflict_banner.body)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wide windows read like an editor: tree, file and rail each scroll
          on their own. Narrower ones stack and the page scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t xl:overflow-hidden">
        <div
          className={cn(
            PAGE_RAIL,
            PAGE_GUTTER,
            "grid gap-6 py-4 sm:py-6 md:grid-cols-[200px_minmax(0,1fr)] xl:h-full xl:grid-cols-[200px_minmax(0,1fr)_320px]",
          )}
        >
          <FileTreeRail
            filePaths={filePaths}
            selectedPath={selectedPath}
            canEdit={canEdit}
            addingFile={addingFile}
            onSelectPath={setSelectedPath}
            onStartAddFile={() => setAddingFile(true)}
            onAddFile={handleAddFile}
            onCancelAddFile={() => setAddingFile(false)}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
            onEditFile={handleEditFile}
          />
          <FilePane
            selectedPath={selectedPath}
            selectedContent={selectedContent}
            mode={fileMode}
            canEdit={canEdit}
            focusEditor={focusPath === selectedPath}
            onModeChange={setFileMode}
            onDeleteFile={handleDeleteFile}
            onContentChange={handleFileContentChange}
            onFocusHandled={handleFocusHandled}
          />
          <div className="flex min-w-0 flex-col gap-4 md:col-span-2 xl:col-span-1 xl:overflow-y-auto xl:pb-24">
            <TriggerCard
              description={description}
              canEdit={canEdit}
              onDescriptionChange={setDescription}
            />
            <UsedByCard
              skillId={skill.id}
              agents={skillAgents}
              canManageAgent={canManageAgent}
              onAdd={() => setShowAddToAgents(true)}
            />
            <PropertiesCard
              skill={skill}
              name={name}
              canEdit={canEdit}
              creator={creator}
              onNameChange={setName}
            />
          </div>
        </div>
      </div>

      {/* Page-level so it covers edits to the files and the rail alike.
          Dirty-only and floating, matching the skills list batch toolbar;
          anchored to the page root (relative), NOT the viewport. */}
      {canEdit && isDirty && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 animate-in items-center gap-1 rounded-lg border bg-background px-2 py-1.5 fade-in slide-in-from-bottom-2 shadow-lg max-md:above-chat-launcher"
        >
          <div className="mr-1 flex items-center border-r pl-1 pr-2">
            <span className="whitespace-nowrap text-caption text-muted-foreground">
              {t(($) => $.detail.save_bar.changed_summary, {
                parts: changedParts.join(" · "),
              })}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleDiscard}
            disabled={saving}
          >
            {t(($) => $.detail.save_bar.discard)}
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t(($) => $.detail.save_bar.saving)}
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                {t(($) => $.detail.save_bar.save)}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog
        open={confirmDelete}
        onOpenChange={(v) => {
          if (!v) setConfirmDelete(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(($) => $.detail.delete_dialog.title)}</DialogTitle>
            <DialogDescription>
              {skillAgents.length > 0
                ? t(($) => $.detail.delete_dialog.description_with_agents, {
                    name: skill.name,
                    count: skillAgents.length,
                  })
                : t(($) => $.detail.delete_dialog.description_no_agents, {
                    name: skill.name,
                  })}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {t(($) => $.detail.delete_dialog.warning)}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              {t(($) => $.detail.delete_dialog.cancel)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t(($) => $.detail.delete_dialog.deleting)}
                </>
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  {t(($) => $.detail.delete_dialog.confirm)}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddToAgentDialog
        skills={[skill]}
        ctx={actionsCtx}
        open={showAddToAgents}
        onOpenChange={setShowAddToAgents}
      />

      <RefreshSkillDialog
        skill={skill}
        origin={origin}
        wsId={wsId}
        open={confirmRefresh}
        onOpenChange={setConfirmRefresh}
        // Adopt explicitly: the user just confirmed the overwrite, so a dirty
        // draft must be replaced instead of tripping the conflict banner.
        onRefreshed={(updated) => adoptServerVersion(updated)}
      />
    </div>
  );
}
