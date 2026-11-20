#!/bin/sh
# chief 设置页的「装引擎 / 更新引擎」：建工作目录 ~/chief，把插件里的引擎代码放到 ~/chief/data/app，装依赖，装进 launchd。
# 放到插件外面，是因为插件每升一版目录就换一个，launchd 要一个不变的位置。
set -eu
PLUGIN=$(cd "$(dirname "$0")" && pwd)
WS=$HOME/chief
DATA=${CHIEF_HOME:-$WS/data}
APP=$DATA/app

# 同一时间只跑一个：插件在几个会话里同时加载、都发现引擎旧了，只让第一个更新。锁超过 15 分钟算上次没收尾。
mkdir -p "$DATA"
LOCK=$DATA/.updating
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK" && mkdir "$LOCK"
  else
    echo "已经有别的会话在更新引擎了"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

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

# 工作目录：消息中心开在这里，放你的交代（CLAUDE.md）、助理记下的东西（notes/）和自己的 skill。
# 只补没有的文件，已有的一个字都不动。
echo "工作目录 ${WS}（已有的文件不动）"
(cd "$PLUGIN/workspace" && find . -type f) | while IFS= read -r f; do
  if [ ! -e "$WS/$f" ]; then mkdir -p "$WS/$(dirname "$f")"; cp "$PLUGIN/workspace/$f" "$WS/$f"; fi
done

echo "装进 launchd"
"$NODE" --import "$APP/node_modules/tsx/dist/esm/index.mjs" "$APP/src/cli.ts" install
