# Multica 全自编译指南（Linux 服务端 + Windows 客户端）

> 基线：v0.5.2-3-g0516dd57（2026-09-24 实测通过）。
> 目标：**不使用任何官方 GHCR 镜像与官方预编译客户端**，全部从开源自编译。
> 适用于 Ubuntu/Debian x86_64 宿主机；国内网络环境已适配。

## 0. 产物清单

| 产物 | 位置 | 说明 |
|---|---|---|
| Go 六件套 | `server/bin/` | server / multica / migrate / maintenance / backfill_task_usage_hourly / backfill_codex_usage_cache，全部 CGO_ENABLED=0 静态 |
| Linux 镜像 | `multica-backend:selfhost`、`multica-web:selfhost` | runtime-only 镜像，构建期零网络零编译 |
| Windows 安装包 | `apps/desktop/dist/*-windows-x64.exe` | NSIS，捆绑自编译 windows-amd64 CLI |
| CLI/daemon | `/usr/local/bin/multica` | 主机静态二进制 |

## 1. 前置环境

```bash
# Go：go.mod 要求 1.26.x。宿主机低版本也能编——GOTOOLCHAIN=auto 会经 GOPROXY 自动下载匹配工具链
go version          # 1.24.4 实测可用
go env GOPROXY      # 应为 https://mirrors.aliyun.com/goproxy/,direct（关键，见 §9-3）

# Node + pnpm
node -v             # v20+
corepack enable && pnpm -v   # 10.28+

# Docker（跑 postgres + 打包镜像）
docker compose version

# Windows 交叉打包才需要（§6）；只编 Linux 可跳过
dpkg --add-architecture i386
apt-get update && apt-get install -y wine wine64 wine32:i386
```

## 2. 源码

```bash
git clone git@github.com:multica-ai/multica.git && cd multica
# 本机部署位于 /03.code/23.multica
```

## 3. 编译 Linux 服务端（宿主机，勿在容器内）

> 为什么 CGO_ENABLED=0：镜像 runtime 是 alpine(musl)，glibc 动态二进制会报误导性错误
> `./migrate: not found`（exit 127 = ELF 解释器缺失，非文件不存在）。上游容器内构建
> Dockerfile 显式设了它，但宿主机 `make build` **没有**，必须手动加。

```bash
cd server
VERSION=$(git describe --tags --match 'v[0-9]*' --always --dirty)
COMMIT=$(git rev-parse --short HEAD)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS="-X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${DATE}"

for c in server multica migrate maintenance backfill_task_usage_hourly backfill_codex_usage_cache; do
  CGO_ENABLED=0 go build -ldflags "$LDFLAGS" -o bin/$c ./cmd/$c
done
file bin/server   # 应显示 "statically linked"
```

## 4. 编译 Web（Next standalone）

```bash
cd <仓库根>
pnpm install
STANDALONE=true pnpm --filter @multica/web build
# 产物：apps/web/.next/{standalone,static}
```

## 5. 打包镜像并启动

> 仓库根 .dockerignore 排除了 server/bin 与 .next，无法直接以根目录为 context；
> 且容器内编译受网络黑洞拖累（§9-3）。因此用"宿主机产物 → 轻量镜像"两步法。
> 相关文件均为本仓库新增，未改上游任何文件：
> `docker/assemble-prebuilt-context.sh`、`docker/Dockerfile.selfhost-{backend,web}`、
> `docker-compose.selfhost.prebuilt.yml`。

```bash
bash docker/assemble-prebuilt-context.sh   # 装配 docker/prebuilt-context/

docker compose -f docker-compose.selfhost.yml \
               -f docker-compose.selfhost.prebuilt.yml up -d --build

# .env 三项镜像变量须指向本地（防单 -f 误回官方，见 §9-5）：
#   MULTICA_IMAGE_TAG=selfhost
#   MULTICA_BACKEND_IMAGE=multica-backend
#   MULTICA_WEB_IMAGE=multica-web
```

postgres 用 `pgvector/pgvector:pg17`（官方开源镜像，非 multica 发行物），数据卷跨升级保留。

## 6. 编译 Windows 客户端

```bash
# CLI 交叉编译进 desktop 资源目录（脚本内部 GOOS=windows CGO_ENABLED=0）
node apps/desktop/scripts/bundle-cli.mjs

cd apps/desktop
pnpm install
export CSC_IDENTITY_AUTO_DISCOVERY=false        # 跳过代码签名
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
pnpm package -- --win --x64 --publish never
# 产物：apps/desktop/dist/multica-desktop-<version>-windows-x64.exe（NSIS）
```

wine 陷阱（§9-2）：装完 wine32 后必须重建 wineprefix，否则 rcedit 报
`could not load kernel32.dll status c0000135`：

```bash
rm -rf ~/.wine && WINEDEBUG=-all wineboot --init
```

## 7. 安装 CLI/daemon + systemd 自启

```bash
# 替换主机 CLI。daemon 正在跑时 cp 会 "Text file busy"，用 mv 原子替换（两步）
install -m 0755 server/bin/multica /usr/local/bin/multica.new
mv /usr/local/bin/multica.new /usr/local/bin/multica
```

systemd unit：`/etc/systemd/system/multica-daemon.service`

```ini
[Unit]
Description=Multica Daemon (local agent runtime)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/multica daemon start --foreground
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now multica-daemon.service
# mv 替换 CLI 后运行中的 daemon 仍是旧 inode，须 restart 才加载新二进制：
systemctl restart multica-daemon.service
```

## 8. 验证清单

```bash
curl -s localhost:8080/readyz          # {"status":"ok","db":"ok","migrations":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000   # 200
systemctl is-active multica-daemon.service                # active
tail -f /root/.multica/daemon.log        # 应见 "task wakeup websocket connected" + 心跳
docker images                           # 仅 multica-*:selfhost + pgvector，无 ghcr.io/multica-ai
```

镜像基线（升级后 `docker images --digests` 比对，不一致 = 需重新审计）：
backend `sha256:b0743417…cb5b8a3`，web `sha256:55eddf15…3312b63`（v0.5.2-3 基线）。

## 9. 踩坑录（升级/换机必读）

1. **CGO_ENABLED=0 必须显式设**（§3 已述）。
2. **wine 两连坑**：rcedit-ia32.exe 是 32 位 → 需 wine32:i386（multiarch）；
   wine32 装入后旧 wineprefix 缺 syswow64 DLL → 必须 `rm -rf ~/.wine && wineboot --init`。
3. **容器内构建网络黑洞**：Dockerfile 内 `go mod download` 走 proxy.golang.org，
   本机不可达且黑洞式挂起（不报错）。结论：**编译一律宿主机（GOPROXY=aliyun）+ 镜像只做 COPY**。
   上游 `make selfhost-build` 走容器内构建，本环境不可用。
4. **assemble 脚本 rm -rf 会清掉同目录文件**：Dockerfile 模板放 `docker/` 下由脚本拷入
   `prebuilt-context/`，不要直接放 prebuilt-context 里。
5. **compose 回退风险**：selfhost.yml 的 image 写法 `${MULTICA_BACKEND_IMAGE:-ghcr.io/...}`
   内嵌官方默认值。.env 变量必须显式指向本地镜像（§5），否则单跑 `-f selfhost.yml`
   会静默拉回官方镜像。
6. **daemon 替换用 mv 不用 cp**：运行中二进制 cp 报 "Text file busy"。
7. **Windows 安装包版本号带 -dirty**：本地仓库有未提交文件时 git describe 会加后缀，属正常。

## 10. 升级流程

```bash
cd /03.code/23.multica && git pull --ff-only
# 然后重复 §3 → §4 → §5（--build 重建镜像）→ §7（mv 替换 CLI）
# postgres 不动；迁移由 entrypoint 自动执行，起后查 readyz 确认
```

## 11. 无码直登（MULTICA_AUTH_PASSWORDLESS）

本地 SSH 隧道场景的免验证码登录：**输邮箱点继续即进入系统**，跳过输码页。
desktop/CLI 登录走系统浏览器 → web 登录页 → deep link/本地回调自动回传 token，零额外改动。

| 改动点 | 文件 | 内容 |
|---|---|---|
| 后端 | `server/internal/handler/auth.go` | `SendCode` 增加直登分支：findOrCreateUser → issueJWT → SetAuthCookies → 返回 `LoginResponse`（与 verify-code 成功响应同构） |
| API 层 | `packages/core/api/client.ts` | `sendCode` 返回 `LoginResponse \| undefined`（有 token 即直登） |
| 状态层 | `packages/core/auth/store.ts` | `sendCode` 返回 boolean，true 时按 verifyCode 同款落点写会话 |
| 视图层 | `packages/views/auth/login-page.tsx` | `handleSendCode` direct 分支：CLI 场景换 bearer 回调，普通场景直接 onSuccess |

配置（`.env`）：
```bash
APP_ENV=development                # compose 默认注入 production，会硬禁开关，必须显式覆盖
MULTICA_AUTH_PASSWORDLESS=true
```
注意：`docker-compose.selfhost.yml` 的 environment 未声明此变量，靠
`docker-compose.selfhost.prebuilt.yml` 里的透传条目进容器。

安全边界：仅当端口绑 127.0.0.1、经 SSH 隧道访问时使用（隧道即鉴权层）；
`APP_ENV=production` 时后端强制忽略开关。验证方式：
```bash
curl -s -X POST localhost:8080/auth/send-code -H 'Content-Type: application/json' \
  -d '{"email":"root@localhost"}'          # 应直接返回 {"token":"...","user":{...}}
```

## 12. 固定密码登录（MULTICA_AUTH_MODE=password）

§11 的无码直登完全信任网络层；若端口暴露面更大（如 LAN 转发），可切换为
**邮箱 + 固定密码**：密码由 CLI 生成（16 字节随机 → base64 22 字符），
bcrypt 哈希入库，明文仅在生成时输出一次。三个模式统一入口：

```bash
MULTICA_AUTH_MODE=code          # 官方默认：邮箱验证码
MULTICA_AUTH_MODE=passwordless  # §11 无码直登（等价旧 MULTICA_AUTH_PASSWORDLESS=true）
MULTICA_AUTH_MODE=password      # 固定密码（本节）；生产环境强制回落 code
```

| 改动点 | 文件 | 内容 |
|---|---|---|
| 迁移 | `server/migrations/545_user_password_hash.{up,down}.sql` | `"user"` 表新增 `password_hash TEXT` |
| SQL | `server/pkg/db/queries/user.sql` | `SetUserPasswordHash`（`sqlc.arg` 具名参数，NULLIF 空串→NULL） |
| 后端 | `server/internal/handler/auth.go` | `currentAuthMode()` 分发；password 分支 verifyUserPassword（bcrypt 比对）→ issueAndRespond 直登；错误一律 401 `invalid email or password`（防账号枚举） |
| 配置 | `server/internal/handler/config.go` | `/api/config` 增 `auth_mode` 字段（仅非 code 时下发） |
| CLI | `server/cmd/multica/cmd_user.go` | `multica user set-password <email>`：随机密码生成 + bcrypt 入库，明文仅输出一次，重复执行覆盖 |
| 前端 | `packages/core/{api/schemas.ts,api/client.ts,config/index.ts,platform/auth-initializer.tsx}`、`packages/views/auth/login-page.tsx`、5 语言 `locales/*/auth.json` | 配置 store 增 `authMode`；登录页按 `password` 模式渲染密码框，`sendCode` 携带密码参数 |

配置（`.env`）：`APP_ENV=development` + `MULTICA_AUTH_MODE=password`
（同样依赖 prebuilt override 透传，见 §11 注意）。

生成/重置密码——宿主机 5432 不通（postgres 未发布端口），在 backend 容器内执行：
```bash
docker exec -w /app multica-backend-1 ./multica user set-password root@localhost
# email:    root@localhost
# password: <22字符随机密码>   ← 明文仅此一次
```

验证：
```bash
# 正确密码 → {"token":"...","user":{...}}
curl -s -X POST localhost:8080/auth/send-code -H 'Content-Type: application/json' \
  -d '{"email":"root@localhost","password":"<密码>"}'
# 错误/缺失密码 → 401 {"error":"invalid email or password"}
curl -s localhost:8080/api/config    # 含 "auth_mode":"password"
```
