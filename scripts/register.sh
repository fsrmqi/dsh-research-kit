#!/usr/bin/env bash
# 把本仓库以目录形式注册进 DSH 的本地 profile，便于开发态热更新。
#
# 与手动 `dsh plugin add .` 的区别：先 remove 再 add，避免 profile 里留着上一次的
# 旧版本行；remove 失败（本来就没装）不算错误。
#
# 用法：
#   npm run dev:register                 # 默认 profile: web
#   DSH_PROFILE=desktop npm run dev:register
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${DSH_PROFILE:-web}"
PLUGIN_NAME="$(node -p "require('./package.json').name")"

if ! command -v dsh >/dev/null 2>&1; then
  cat >&2 <<'EOF'
未找到 dsh 命令。
本仓库的开发回路需要一个可运行的 DSH CLI（DSH 是独立开源项目）：
  https://github.com/deepseek-ai/deepseek-harness
装好后重试；若你用的是 bun，可先 `bun add -g @deepseek-ai/dsh`。
EOF
  exit 2
fi

echo "注册 $PLUGIN_NAME（profile: $PROFILE，来源: 当前目录）"
# 未安装时 remove 会失败——这正是我们要的幂等：忽略它的退出码。
dsh plugin --profile "$PROFILE" remove "$PLUGIN_NAME" || true
dsh plugin --profile "$PROFILE" add .
echo "完成。接着可运行 npm run dev:watch 与 npm run dev:web。"
