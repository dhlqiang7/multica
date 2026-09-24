import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UpdaterPreferences } from "../shared/updater-types";

// selfhost：默认关闭自动更新——自编译客户端与官方 release 无签名/版本
// 对应关系，自动比对只会误判（可能下载官方安装包）。上游同步冲突点，
// 见 BUILD-SELFHOST.md §13。
export const DEFAULT_UPDATER_PREFERENCES: UpdaterPreferences = {
  automaticUpdates: false,
};

export function updaterPreferencesPath(userDataPath: string): string {
  return join(userDataPath, "updater-preferences.json");
}

function parseUpdaterPreferences(value: unknown): UpdaterPreferences {
  const candidate = value as { automaticUpdates?: unknown } | null;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof candidate?.automaticUpdates === "boolean"
  ) {
    return { automaticUpdates: candidate.automaticUpdates };
  }

  return { ...DEFAULT_UPDATER_PREFERENCES };
}

export async function loadUpdaterPreferences(
  filePath: string,
): Promise<UpdaterPreferences> {
  try {
    return parseUpdaterPreferences(JSON.parse(await readFile(filePath, "utf-8")));
  } catch {
    return { ...DEFAULT_UPDATER_PREFERENCES };
  }
}

export async function saveUpdaterPreferences(
  filePath: string,
  preferences: UpdaterPreferences,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(preferences, null, 2), "utf-8");
  await rename(temporaryPath, filePath);
}
