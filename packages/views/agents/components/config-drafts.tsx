"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * Where an editor's draft lives on the configuration page. Editors that are
 * handed a slot stop rendering their own Save footer and report into the
 * page-level save bar instead; without a slot (tests, other surfaces) they
 * keep their standalone footer.
 */
export interface ConfigDraftSlot {
  id: string;
  /** Anchor the save bar scrolls to when this draft's label is clicked. */
  anchor: string;
  label: string;
}

interface ConfigDraftState {
  dirty: boolean;
  /** False while the draft cannot be committed as-is (e.g. a required field
   *  is empty). Saving-in-progress is tracked by the save bar, not here. */
  valid: boolean;
  save: () => Promise<void>;
  discard: () => void;
}

interface DraftMeta {
  anchor: string;
  label: string;
  dirty: boolean;
  valid: boolean;
}

interface DraftHandlers {
  save: () => Promise<void>;
  discard: () => void;
}

interface DraftRegistry {
  setMeta: (id: string, meta: DraftMeta) => void;
  setHandlers: (id: string, handlers: DraftHandlers) => void;
  remove: (id: string) => void;
}

// Two contexts so an editor re-rendering its own draft does not re-render
// every other editor: editors only read the stable registry, the save bar
// reads the entries.
const RegistryContext = createContext<DraftRegistry | null>(null);
const EntriesContext = createContext<{
  entries: Record<string, DraftMeta>;
  handlers: React.RefObject<Map<string, DraftHandlers>>;
} | null>(null);

function sameMeta(a: DraftMeta | undefined, b: DraftMeta) {
  return (
    a !== undefined &&
    a.anchor === b.anchor &&
    a.label === b.label &&
    a.dirty === b.dirty &&
    a.valid === b.valid
  );
}

export function ConfigDraftProvider({
  children,
  onDirtyChange,
}: {
  children: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const handlers = useRef(new Map<string, DraftHandlers>());
  const [entries, setEntries] = useState<Record<string, DraftMeta>>({});

  const registry = useMemo<DraftRegistry>(
    () => ({
      setMeta: (id, meta) =>
        setEntries((prev) =>
          sameMeta(prev[id], meta) ? prev : { ...prev, [id]: meta },
        ),
      setHandlers: (id, next) => {
        handlers.current.set(id, next);
      },
      remove: (id) => {
        handlers.current.delete(id);
        setEntries((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      },
    }),
    [],
  );

  const hasDirty = Object.values(entries).some((entry) => entry.dirty);
  useEffect(() => {
    onDirtyChange?.(hasDirty);
  }, [hasDirty, onDirtyChange]);

  const entriesValue = useMemo(() => ({ entries, handlers }), [entries]);

  return (
    <RegistryContext.Provider value={registry}>
      <EntriesContext.Provider value={entriesValue}>
        {children}
      </EntriesContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Registers an editor's draft with the enclosing configuration page. Returns
 * true when the page owns saving, in which case the editor hides its own
 * Save footer.
 */
export function useConfigDraft(
  slot: ConfigDraftSlot | undefined,
  state: ConfigDraftState,
): boolean {
  const registry = useContext(RegistryContext);
  const id = registry && slot ? slot.id : null;
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!registry || id === null) return;
    registry.setHandlers(id, {
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
    return () => registry.remove(id);
  }, [registry, id]);

  const anchor = slot?.anchor ?? "";
  const label = slot?.label ?? "";
  useEffect(() => {
    if (!registry || id === null) return;
    registry.setMeta(id, {
      anchor,
      label,
      dirty: state.dirty,
      valid: state.valid,
    });
  }, [registry, id, anchor, label, state.dirty, state.valid]);

  return id !== null;
}

/**
 * One save bar for every explicit-save editor on the page. It names what is
 * unsaved, so leaving it untouched is never a silent loss, and sits in the
 * content column rather than the corner the chat launcher owns.
 */
export function ConfigSaveBar({
  onJump,
  className,
}: {
  onJump: (anchor: string) => void;
  className?: string;
}) {
  const { t } = useT("agents");
  const context = useContext(EntriesContext);
  const [saving, setSaving] = useState(false);
  if (!context) return null;

  const dirty = Object.entries(context.entries).filter(
    ([, entry]) => entry.dirty,
  );
  if (dirty.length === 0) return null;

  const blocked = dirty.filter(([, entry]) => !entry.valid);
  const separator = t(($) => $.config.list_separator);
  const canSave = !saving && blocked.length === 0;

  const saveAll = async () => {
    setSaving(true);
    try {
      // Sequential on purpose: several editors write the same agent row, and
      // the page's optimistic patch rolls back per field on failure. A failed
      // section has already surfaced its own error and stays dirty, so the
      // rest still save.
      for (const [id] of dirty) {
        try {
          await context.handlers.current?.get(id)?.save();
        } catch {
          // Reported by the editor / page; keep going.
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const discardAll = () => {
    for (const [id] of dirty) context.handlers.current?.get(id)?.discard();
  };

  return (
    <div
      role="region"
      aria-label={t(($) => $.config.save_bar_aria)}
      className={cn(
        "pointer-events-auto flex min-w-0 max-w-full items-center gap-3 rounded-xl bg-popover py-1.5 pl-3.5 pr-1.5 text-label shadow-[var(--floating-shadow)] ring-1 ring-surface-border",
        className,
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      <span className="shrink-0 font-medium" aria-live="polite">
        {t(($) => $.config.unsaved_count, { count: dirty.length })}
      </span>
      <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
        {blocked.length > 0 && !saving ? (
          <span className="truncate text-destructive">
            {t(($) => $.config.fix_before_saving, {
              sections: blocked.map(([, entry]) => entry.label).join(separator),
            })}
          </span>
        ) : (
          dirty.map(([id, entry], index) => (
            <span key={id} className="inline-flex items-center">
              {index > 0 ? (
                <span aria-hidden="true" className="whitespace-pre">
                  {separator}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onJump(entry.anchor)}
                className="rounded-xs underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {entry.label}
              </button>
            </span>
          ))
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={discardAll}
        >
          {t(($) => $.config.discard)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canSave}
          onClick={() => void saveAll()}
        >
          {saving ? (
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {t(($) => $.tab_body.common.save)}
        </Button>
      </span>
    </div>
  );
}
