// @vitest-environment node
// selfhost 定制层测试（selfhost-credentials.ts）：凭据加密存取的 IPC 行为，
// 重点验证安全边界——加密不可用/密文损坏时绝不落明文、绝不返回明文兜底。
// 仿 updater.test.ts 的 electron mock 模式。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type IpcHandler = (...args: unknown[]) => unknown;

const ctx = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  ipcHandle: vi.fn((_channel: string, handler: IpcHandler) => {
    // updater.test.ts 用 ctx.ipcHandle 直捕；这里直接登记便于 invokeIpc
  }),
  encryptionAvailable: true,
  encryptFn: (plain: string) => Buffer.from(`enc:${plain}`),
  decryptFn: (buf: Buffer) => buf.toString().replace(/^enc:/, ""),
  userDataPath: "",
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => ctx.userDataPath),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ctx.ipcHandlers.set(channel, handler);
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => ctx.encryptionAvailable),
    encryptString: vi.fn((plain: string) => ctx.encryptFn(plain)),
    decryptString: vi.fn((buf: Buffer) => ctx.decryptFn(buf)),
  },
}));

import { registerSelfhostCredentialsHandlers } from "./selfhost-credentials";

function credentialsFile(): string {
  return join(ctx.userDataPath, "selfhost-credentials.json");
}

async function invokeIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = ctx.ipcHandlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler({}, ...args);
}

describe("selfhost credentials IPC", () => {
  beforeEach(() => {
    ctx.ipcHandlers.clear();
    ctx.encryptionAvailable = true;
    ctx.userDataPath = mkdtempSync(join(tmpdir(), "selfhost-cred-"));
    registerSelfhostCredentialsHandlers();
  });

  afterEach(() => {
    rmSync(ctx.userDataPath, { recursive: true, force: true });
  });

  it("registers exactly the get and set channels", () => {
    expect([...ctx.ipcHandlers.keys()].sort()).toEqual([
      "selfhost:credentials:get",
      "selfhost:credentials:set",
    ]);
  });

  it("returns null when no credentials file exists", async () => {
    await expect(invokeIpc("selfhost:credentials:get")).resolves.toBeNull();
  });

  it("persists encrypted credentials and reads them back", async () => {
    await invokeIpc("selfhost:credentials:set", "root@localhost", "s3cret");

    // 落盘的是密文 + schema，不是明文
    const stored = JSON.parse(readFileSync(credentialsFile(), "utf-8"));
    expect(stored).toEqual({
      schemaVersion: 1,
      email: "root@localhost",
      passwordBase64: Buffer.from("enc:s3cret").toString("base64"),
    });
    expect(readFileSync(credentialsFile(), "utf-8")).not.toContain("s3cret");

    await expect(invokeIpc("selfhost:credentials:get")).resolves.toEqual({
      email: "root@localhost",
      password: "s3cret",
    });
  });

  it("overwrites previous credentials on re-save", async () => {
    await invokeIpc("selfhost:credentials:set", "a@x.com", "one");
    await invokeIpc("selfhost:credentials:set", "b@x.com", "two");

    await expect(invokeIpc("selfhost:credentials:get")).resolves.toEqual({
      email: "b@x.com",
      password: "two",
    });
  });

  it("set rejects empty email or password", async () => {
    await expect(
      invokeIpc("selfhost:credentials:set", "", "pw"),
    ).rejects.toThrow(/invalid credentials/);
    await expect(
      invokeIpc("selfhost:credentials:set", "a@x.com", ""),
    ).rejects.toThrow(/invalid credentials/);
    expect(existsSync(credentialsFile())).toBe(false);
  });

  it("never writes plaintext when encryption is unavailable", async () => {
    ctx.encryptionAvailable = false;

    await expect(
      invokeIpc("selfhost:credentials:set", "a@x.com", "s3cret"),
    ).rejects.toThrow(/unavailable/);
    expect(existsSync(credentialsFile())).toBe(false);
  });

  it("get returns null instead of falling back when encryption is unavailable", async () => {
    ctx.encryptionAvailable = false;

    await expect(invokeIpc("selfhost:credentials:get")).resolves.toBeNull();
  });

  it("get treats corrupted ciphertext as absent (no plaintext fallback)", async () => {
    await invokeIpc("selfhost:credentials:set", "a@x.com", "s3cret");
    // 破坏密文：换成无法解密的内容
    ctx.decryptFn = () => {
      throw new Error("decrypt failed (key rotated?)");
    };

    await expect(invokeIpc("selfhost:credentials:get")).resolves.toBeNull();
  });

  it("get rejects legacy/unknown file schema", async () => {
    writeFileSync(
      credentialsFile(),
      JSON.stringify({ email: "a@x.com", password: "plaintext-legacy" }),
      "utf-8",
    );

    await expect(invokeIpc("selfhost:credentials:get")).resolves.toBeNull();
  });
});
