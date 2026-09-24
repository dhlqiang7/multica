// selfhost 定制层测试（selfhost-login.tsx）：useSelfhostPasswordField 的
// desktop 凭据取回/回写 + web 端零桥接降级。核心验收点：无 desktopAPI 时
// 行为与上游完全一致（password 恒空、saved 恒 null）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { configStore } from "@multica/core/config";
import { useSelfhostPasswordField } from "./selfhost-login";

function installBridge(overrides?: Partial<{
  getCredentials: () => Promise<{ email: string; password: string } | null>;
  saveCredentials: (email: string, password: string) => Promise<void>;
}>) {
  const bridge = {
    getCredentials: vi.fn(async () => ({ email: "root@localhost", password: "s3cret" })),
    saveCredentials: vi.fn(async () => {}),
    ...overrides,
  };
  (window as unknown as { desktopAPI: unknown }).desktopAPI = { selfhost: bridge };
  return bridge;
}

afterEach(() => {
  delete (window as unknown as { desktopAPI?: unknown }).desktopAPI;
  configStore.setState({ authMode: "code" });
});

describe("useSelfhostPasswordField", () => {
  it("stays inert outside password mode even when a bridge exists", async () => {
    const bridge = installBridge();
    configStore.setState({ authMode: "code" });

    const { result } = renderHook(() => useSelfhostPasswordField());

    expect(result.current.isPasswordMode).toBe(false);
    expect(result.current.password).toBe("");
    expect(result.current.saved).toBeNull();
    // 不探测桥接——非 password 模式下 desktopAPI 不应被触碰
    expect(bridge.getCredentials).not.toHaveBeenCalled();
  });

  it("degrades to manual input on web (no desktopAPI bridge)", async () => {
    configStore.setState({ authMode: "password" });

    const { result } = renderHook(() => useSelfhostPasswordField());

    expect(result.current.isPasswordMode).toBe(true);
    expect(result.current.saved).toBeNull();
    expect(result.current.password).toBe("");

    // persist 在 web 端为 no-op，不抛错
    act(() => result.current.persist("a@x.com", "pw"));
  });

  it("restores saved credentials from the desktop bridge", async () => {
    installBridge();
    configStore.setState({ authMode: "password" });

    const { result } = renderHook(() => useSelfhostPasswordField());

    await waitFor(() => {
      expect(result.current.saved).toEqual({
        email: "root@localhost",
        password: "s3cret",
      });
      expect(result.current.password).toBe("s3cret");
    });
  });

  it("ignores bridge failures and incomplete credentials", async () => {
    installBridge({
      getCredentials: vi.fn(async () => {
        throw new Error("ipc broken");
      }),
    });
    configStore.setState({ authMode: "password" });

    const { result, rerender } = renderHook(() => useSelfhostPasswordField());
    rerender();

    expect(result.current.saved).toBeNull();
    expect(result.current.password).toBe("");

    // 空字段凭据同样忽略
    installBridge({
      getCredentials: vi.fn(async () => ({ email: "", password: "" })),
    });
    configStore.setState({ authMode: "password" });
    const second = renderHook(() => useSelfhostPasswordField());
    await waitFor(() => {
      expect(second.result.current.saved).toBeNull();
    });
  });

  it("persist writes through to the desktop bridge", async () => {
    const bridge = installBridge();
    configStore.setState({ authMode: "password" });

    const { result } = renderHook(() => useSelfhostPasswordField());

    act(() => result.current.persist("root@localhost", "s3cret"));
    expect(bridge.saveCredentials).toHaveBeenCalledWith("root@localhost", "s3cret");
  });
});
