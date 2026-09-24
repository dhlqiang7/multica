"use client";

// selfhost 定制层：固定密码登录（MULTICA_AUTH_MODE=password）的登录页
// 扩展。与上游 login-page.tsx 解耦——上游文件仅保留数行装配点，便于同步
// 原始仓库。登录形态由服务端 /api/config 的 auth_mode 下发（缺省 code）。
//
// desktop 客户端额外支持本地加密保存密码（Electron safeStorage，经
// preload 的 window.desktopAPI.selfhost 桥接）：启动时取回并填充/自动登录，
// 登录成功后回写。web 端无该桥接，天然降级为手输。

import { useCallback, useEffect, useState } from "react";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { useConfigStore } from "@multica/core/config";
import { useT } from "../i18n";

interface SelfhostBridge {
  getCredentials: () => Promise<{ email: string; password: string } | null>;
  saveCredentials: (email: string, password: string) => Promise<void>;
}

/** 桌面桥接探测：仅 desktop preload 注入了 desktopAPI.selfhost 时存在。 */
function desktopSelfhostBridge(): SelfhostBridge | null {
  const api = (window as unknown as { desktopAPI?: { selfhost?: SelfhostBridge } })
    .desktopAPI?.selfhost;
  return typeof api?.getCredentials === "function" &&
    typeof api?.saveCredentials === "function"
    ? api
    : null;
}

/** 订阅服务端登录形态，托管密码框状态。
 *  非 password 模式下 password 恒为空串、组件不渲染，行为与上游一致。
 *  desktop 上 `saved` 为启动时从本地加密存储取回的凭据（无则 null）。 */
export function useSelfhostPasswordField() {
  const authMode = useConfigStore((s) => s.authMode);
  const isPasswordMode = authMode === "password";
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!isPasswordMode) return;
    const bridge = desktopSelfhostBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge
      .getCredentials()
      .then((cred) => {
        if (cancelled || !cred?.email || !cred.password) return;
        setSaved(cred);
        setPassword(cred.password);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPasswordMode]);

  /** 登录成功后回写凭据（覆盖式，连带 email）。仅 desktop 生效。 */
  const persist = useCallback(
    (email: string, value: string) => {
      const bridge = desktopSelfhostBridge();
      if (!bridge) return;
      void bridge.saveCredentials(email, value).catch(() => {});
    },
    [],
  );

  return { isPasswordMode, password, setPassword, saved, persist };
}

/** 密码模式下的密码输入框（label + input）。 */
export function SelfhostPasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useT("auth");
  return (
    <div className="space-y-2">
      <Label htmlFor="login-password">
        {t(($) => $.common.password_label)}
      </Label>
      <Input
        id="login-password"
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </div>
  );
}
