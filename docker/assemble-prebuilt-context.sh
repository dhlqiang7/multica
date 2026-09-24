#!/usr/bin/env bash
# 装配"主机构建产物 → 轻量镜像打包"的独立 build context。
# 背景：仓库根的 .dockerignore 排除了 server/bin 与 .next，
# 且容器内 go mod download / pnpm install 受网络黑洞拖累，
# 因此全部编译在宿主机完成后，仅把运行时产物 COPY 进镜像。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
ctx="$root/docker/prebuilt-context"

rm -rf "$ctx"
mkdir -p "$ctx/backend-bin" "$ctx/web"

# --- backend：Go 二进制 + 迁移 + entrypoint（结构对齐 Dockerfile 的 runtime stage）---
cp "$root/server/bin/server" \
   "$root/server/bin/multica" \
   "$root/server/bin/migrate" \
   "$root/server/bin/maintenance" \
   "$root/server/bin/backfill_task_usage_hourly" \
   "$root/server/bin/backfill_codex_usage_cache" \
   "$ctx/backend-bin/"
cp -r "$root/server/migrations" "$ctx/migrations"
cp "$root/docker/entrypoint.sh" "$ctx/entrypoint.sh"
cp "$root/LICENSE" "$root/NOTICE" "$ctx/"

# Dockerfile 模板与产物同放 context（模板本体在 docker/ 下，避免被本脚本 rm -rf 清掉）
cp "$root/docker/Dockerfile.selfhost-backend" "$ctx/Dockerfile.backend"
cp "$root/docker/Dockerfile.selfhost-web" "$ctx/Dockerfile.web"

# --- web：Next standalone 输出（结构对齐 Dockerfile.web 的 runtime stage）---
cp -r "$root/apps/web/.next/standalone" "$ctx/web/standalone"
cp -r "$root/apps/web/.next/static" "$ctx/web/static"
cp -r "$root/apps/web/public" "$ctx/web/public"

echo "✓ context 装配完成：$ctx"
du -sh "$ctx"
