"use client";

// selfhost 定制层：固定密码登录（MULTICA_AUTH_MODE=password）的登录页
// 扩展。与上游 login-page.tsx 解耦——上游文件仅保留数行装配点，便于同步
// 原始仓库。登录形态由服务端 /api/config 的 auth_mode 下发（缺省 code）。

import { useState } from "react";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { useConfigStore } from "@multica/core/config";
import { useT } from "../i18n";

/** 订阅服务端登录形态，托管密码框状态。
 *  非 password 模式下 password 恒为空串、组件不渲染，行为与上游一致。 */
export function useSelfhostPasswordField() {
  const authMode = useConfigStore((s) => s.authMode);
  const isPasswordMode = authMode === "password";
  const [password, setPassword] = useState("");
  return { isPasswordMode, password, setPassword };
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
