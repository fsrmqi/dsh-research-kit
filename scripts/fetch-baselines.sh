#!/usr/bin/env bash
# 把「受支持 DSH 基线」的 tag 浅拉取到 .tmp/dsh-repo，供兼容性矩阵离线/CI 使用。
#
# 基线清单不在本文件里重复：scripts/lib/dsh-baselines.mjs 是唯一事实源，
# 这里只是把它读出来拼成 git fetch 的 refspec。新增一个基线 = 改那一处 + 重跑本脚本。
#
# 用法：
#   bash scripts/fetch-baselines.sh              # 拉进 .tmp/dsh-repo（默认）
#   DSH_REPO=/somewhere bash scripts/fetch-baselines.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DSH_REPO="${DSH_REPO:-$ROOT/.tmp/dsh-repo}"
REMOTE="${DSH_REMOTE:-https://github.com/deepseek-ai/deepseek-harness.git}"
DEPTH="${DSH_FETCH_DEPTH:-1}"

TAGS="$(node -e "
import('./scripts/lib/dsh-baselines.mjs').then(m => {
  process.stdout.write(m.BASELINES.map(b => b.tag).join(' '))
})")"

if [[ -z "$TAGS" ]]; then
  echo "基线清单为空：检查 scripts/lib/dsh-baselines.mjs" >&2
  exit 1
fi

mkdir -p "$DSH_REPO"
if [[ ! -d "$DSH_REPO/.git" ]]; then
  git -C "$DSH_REPO" init -q
  git -C "$DSH_REPO" remote add origin "$REMOTE" 2>/dev/null || git -C "$DSH_REPO" remote set-url origin "$REMOTE"
fi

# 只按 tag 拉取，clone 始终是浅的；已存在的 tag 直接跳过，重复执行是幂等的。
refspecs=()
for tag in $TAGS; do
  if git -C "$DSH_REPO" rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    echo "已存在：$tag"
    continue
  fi
  refspecs+=("refs/tags/$tag:refs/tags/$tag")
done

if [[ ${#refspecs[@]} -eq 0 ]]; then
  echo "基线 tag 齐全（${DSH_REPO}）：${TAGS}"
  exit 0
fi

# 变量名一律写成 ${VAR}：bash 3.2（macOS 自带）会把紧跟其后的多字节字符（例如全角「：」）
# 当作变量名的一部分，`set -u` 下直接报 unbound variable——本脚本曾在拉取前就死在这里。
echo "拉取基线 tag 到 ${DSH_REPO}：${refspecs[*]}"
git -C "$DSH_REPO" -c http.version=HTTP/1.1 fetch --depth "$DEPTH" origin "${refspecs[@]}"
echo "完成。导出 DSH_REPO=\"$DSH_REPO\" 后运行 npm run check:dsh-app 或 npm test。"
