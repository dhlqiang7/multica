"use client";

import { use } from "react";
import { RuntimeDetailPage } from "@multica/views/runtimes";

// Runtimes have no page of their own: this older URL opens the machine page
// with the runtime focused.
export default function RuntimeOnMachineRoute({
  params,
}: {
  params: Promise<{ id: string; runtimeId: string }>;
}) {
  const { id, runtimeId } = use(params);
  return <RuntimeDetailPage runtimeId={id} focusRuntimeId={runtimeId} />;
}
