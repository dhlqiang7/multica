"use client";

import { Info } from "lucide-react";
import type { RecipientNotices as RecipientNoticesState } from "../hooks/use-recipient-actions";
import { useLocale, useT } from "../../i18n";

/** Why Send now does something different from what the draft started with. */
export function RecipientNotices({ notices }: { notices: RecipientNoticesState }) {
  const { t } = useT("issues");
  const locale = useLocale();
  const lines: string[] = [];
  if (notices.endedAgentNames.length > 0) {
    const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(notices.endedAgentNames);
    lines.push(t(($) => $.comment.steer_ended_notice, { name: names }));
  }
  if (notices.attachmentsBlockSteer) lines.push(t(($) => $.comment.steer_attachment_notice));
  if (lines.length === 0) return null;
  return (
    <div role="status" className="mb-2 flex flex-col gap-1">
      {lines.map((line) => (
        <p key={line} className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-caption text-muted-foreground">
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{line}</span>
        </p>
      ))}
    </div>
  );
}
