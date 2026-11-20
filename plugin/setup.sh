#!/bin/sh
# chief 设置页的「装引擎 / 更新引擎」：把插件里的引擎代码放到 ~/.chief/app，装依赖，装进 launchd。
# 放到插件外面，是因为插件每升一版目录就换一个，launchd 要一个不变的位置。
set -eu
PLUGIN=$(cd "$(dirname "$0")" && pwd)
DATA=${CHIEF_HOME:-$HOME/.chief}
APP=$DATA/app

# App 起的进程 PATH 不全：先问登录 shell，再看 Homebrew 的常见位置。
NODE=$(/bin/zsh -lc 'command -v node' 2>/dev/null || true)
[ -x "${NODE:-}" ] || for c in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$c" ]; then NODE=$c; break; fi
done
if [ ! -x "${NODE:-}" ]; then echo "没找到 node：先装 Node 24 以上（https://nodejs.org）"; exit 2; fi
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 24 ]; then echo "node 是 $("$NODE" -v)，要 24 以上"; exit 2; fi
BIN=$(dirname "$NODE")

echo "复制引擎到 $APP"
mkdir -p "$APP"
chmod 700 "$DATA"
rm -rf "$APP/src"
cp -R "$PLUGIN/engine/src" "$APP/src"
cp "$PLUGIN/engine/package.json" "$PLUGIN/engine/package-lock.json" "$APP/"

echo "装依赖（第一次要一两分钟）"
cd "$APP"
PATH="$BIN:$PATH" "$BIN/npm" ci --omit=dev --no-audit --no-fund --loglevel=error
sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN/.claude-plugin/plugin.json" | head -n 1 > VERSION

echo "装进 launchd"
"$NODE" --import "$APP/node_modules/tsx/dist/esm/index.mjs" "$APP/src/cli.ts" install
