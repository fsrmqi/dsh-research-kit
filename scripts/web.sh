#!/usr/bin/env bash
# 起一个本地 DSH Web 服务用于开发验收。
#
# 与「按进程名 kill 掉所有 dsh web」的做法不同，这里**只管理本脚本自己启动的那一个实例**
# （pid 记在 .tmp/web.pid）：开发者机器上常有别的 DSH 会话正在跑（比如当前正在用的 GUI），
# 按模式匹配杀进程会把它们一起带走。端口被占用时 dsh 自己会报错，如实转述即可。
#
# 用法：
#   npm run dev:web                      # 默认 `dsh web`
#   DSH_WEB_ARGS="--port 3080" npm run dev:web
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/.tmp/web.pid"
mkdir -p "$ROOT/.tmp"
ARGS="${DSH_WEB_ARGS:---no-open}"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "停掉上一次由本脚本启动的 dsh web（pid $old_pid）"
    kill "$old_pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.1
    done
  fi
  rm -f "$PID_FILE"
fi

if ! command -v dsh >/dev/null 2>&1; then
  echo "未找到 dsh 命令；见 https://github.com/deepseek-ai/deepseek-harness" >&2
  exit 2
fi

echo "启动 dsh web $ARGS"
# shellcheck disable=SC2086 # ARGS 需要按词拆分，好让 DSH_WEB_ARGS 能传多个参数
dsh web $ARGS &
child=$!
echo "$child" > "$PID_FILE"
trap 'kill "$child" 2>/dev/null || true; rm -f "$PID_FILE"' EXIT INT TERM
wait "$child"
