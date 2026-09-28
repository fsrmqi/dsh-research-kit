#!/usr/bin/env bash
# 开发态监听：源码一变就重建浏览器产物（ui/client.js、ui/catalog-data.json、ui/promptkit.js）。
#
# 只做一件事——重建产物。DSH 侧的加载/热更新由宿主的 dev 流程决定（见 docs/DEVELOPMENT.md）。
# 重复执行会先杀掉上一次的实例（pid 记在 .tmp/watch.pid），避免多个 watcher 互相抢写产物。
#
# 用法：
#   npm run dev:watch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/.tmp/watch.pid"
mkdir -p "$ROOT/.tmp"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "停掉上一次的 watcher（pid $old_pid）"
    kill "$old_pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.1
    done
  fi
  rm -f "$PID_FILE"
fi

# 产物由 src/ + dsh/ + catalog/ + vendor/ 与构建器共同决定：
# catalog/ 变了要重算目录数据，vendor/ 变了要重嵌工件，构建器本身也要被监听。
node --watch \
  --watch-path="$ROOT/src" \
  --watch-path="$ROOT/dsh" \
  --watch-path="$ROOT/catalog" \
  --watch-path="$ROOT/vendor" \
  --watch-path="$ROOT/scripts/build-client.mjs" \
  --watch-path="$ROOT/package.json" \
  "$ROOT/scripts/build-client.mjs" &
child=$!
echo "$child" > "$PID_FILE"
echo "监听中（pid $child）——改动 src/ dsh/ catalog/ vendor/ 会自动重建 ui/ 产物"

cleanup() {
  kill "$child" 2>/dev/null || true
  if [[ "$(cat "$PID_FILE" 2>/dev/null)" == "$child" ]]; then
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

wait "$child"
