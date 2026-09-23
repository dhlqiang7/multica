"use client";

import type { ReactNode } from "react";

/** DOM id for a configuration anchor, shared by the sections, the table of
 *  contents and deep links (`?view=<anchor>`). */
export function configAnchorDomId(anchor: string) {
  return `agent-config-${anchor}`;
}

export function ConfigSection({
  anchor,
  title,
  action,
  children,
}: {
  anchor: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={configAnchorDomId(anchor)}
      data-config-section={anchor}
      aria-labelledby={`${configAnchorDomId(anchor)}-title`}
      className="scroll-mt-6"
    >
      <div className="mb-3 flex min-w-0 items-end justify-between gap-4">
        <h2
          id={`${configAnchorDomId(anchor)}-title`}
          className="text-title-sm font-semibold text-balance"
        >
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A titled block inside a section, individually addressable so deep links
 *  such as `?view=skills` land on the block rather than its group. */
export function ConfigSubsection({
  anchor,
  title,
  children,
}: {
  anchor: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      id={configAnchorDomId(anchor)}
      data-config-anchor={anchor}
      className="scroll-mt-6"
    >
      <h3 className="mb-3 text-body font-semibold">{title}</h3>
      {children}
    </div>
  );
}
