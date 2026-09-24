import { app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// selfhost 定制层：固定密码登录（MULTICA_AUTH_MODE=password）的客户端
// 凭据保存。Electron safeStorage 加密（Windows=DPAPI / macOS=Keychain /
// Linux=libsecret），密文写入 userData/selfhost-credentials.json，原子写
// 模式仿 updater-preferences.ts。与上游解耦：注册入口由 main/index.ts
// 一行装配（见 BUILD-SELFHOST.md §13）。

export interface SelfhostCredentials {
  email: string;
  password: string;
}

interface StoredCredentials {
  schemaVersion: 1;
  email: string;
  /** safeStorage 密文的 base64。 */
  passwordBase64: string;
}

function credentialsPath(userDataPath: string): string {
  return join(userDataPath, "selfhost-credentials.json");
}

function parseStored(value: unknown): StoredCredentials | null {
  const c = value as Partial<StoredCredentials> | null;
  if (
    typeof value === "object" &&
    value !== null &&
    c?.schemaVersion === 1 &&
    typeof c.email === "string" &&
    typeof c.passwordBase64 === "string"
  ) {
    return { schemaVersion: 1, email: c.email, passwordBase64: c.passwordBase64 };
  }
  return null;
}

/** 注册 selfhost 凭据 IPC 通道。幂等，主进程初始化时调用一次。 */
export function registerSelfhostCredentialsHandlers(): void {
  const filePath = credentialsPath(app.getPath("userData"));

  ipcMain.handle("selfhost:credentials:get", async (): Promise<SelfhostCredentials | null> => {
    try {
      // 加密不可用（如 Linux 无 libsecret）或密文损坏/系统密钥变化：
      // 一律视为无保存凭据，登录页退回手输，绝不返回明文兜底。
      if (!safeStorage.isEncryptionAvailable()) return null;
      const stored = parseStored(JSON.parse(await readFile(filePath, "utf-8")));
      if (!stored) return null;
      const password = safeStorage.decryptString(
        Buffer.from(stored.passwordBase64, "base64"),
      );
      return { email: stored.email, password };
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    "selfhost:credentials:set",
    async (_event, email: string, password: string): Promise<void> => {
      if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
        throw new Error("invalid credentials payload");
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage encryption unavailable");
      }
      const payload: StoredCredentials = {
        schemaVersion: 1,
        email,
        passwordBase64: safeStorage.encryptString(password).toString("base64"),
      };
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf-8");
      await rename(temporaryPath, filePath);
    },
  );
}
