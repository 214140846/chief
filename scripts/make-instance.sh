#!/bin/sh
# 从 plugin/ 生成一个独立实例：插件名、命令、面板、工作目录（~/<名字>）、launchd 服务、钥匙串前缀、
# 主会话标题、会话间暗号全都换成 <名字>，和 chief 同时跑互不干扰。
# 用法：scripts/make-instance.sh superagent ~/Github/superagent
# 生成后：claude plugin marketplace add <输出目录>；claude plugin install <名字>@<名字> --scope user。
# shortcut: 用文字替换 chief→<名字> 生成，代码改了要重新生成一次；以后实例多了、要分别升级时，再改成运行时读实例名。
set -eu
NAME=${1:-}
OUT=${2:-}
case "$NAME" in '' | *[!a-z]*) echo "用法：$0 <名字，只用小写字母> <输出目录>"; exit 2 ;; esac
[ "$NAME" = chief ] && { echo "chief 就是原版，不用生成"; exit 2; }
[ -n "$OUT" ] || { echo "用法：$0 <名字> <输出目录>"; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
UPPER=$(printf %s "$NAME" | tr a-z A-Z)
TITLE=$(printf %s "$NAME" | cut -c1 | tr a-z A-Z)$(printf %s "$NAME" | cut -c2-)

mkdir -p "$OUT/.claude-plugin"
rm -rf "$OUT/plugin"
rsync -a --exclude node_modules --exclude .DS_Store "$ROOT/plugin/" "$OUT/plugin/"
cp "$ROOT/.claude-plugin/marketplace.json" "$OUT/.claude-plugin/marketplace.json"

# 文件内容：chief / Chief / CHIEF 三种写法都换（LC_ALL=C：中文按字节原样过）。
find "$OUT/.claude-plugin" "$OUT/plugin" -type f | while IFS= read -r f; do
  LC_ALL=C sed -i '' -e "s/chief/$NAME/g" -e "s/Chief/$TITLE/g" -e "s/CHIEF/$UPPER/g" "$f"
done
# 文件名（比如 test/chief.spec.ts），从最深的开始改。
find "$OUT/plugin" -depth -name '*chief*' | while IFS= read -r f; do
  mv "$f" "$(dirname "$f")/$(basename "$f" | sed "s/chief/$NAME/g")"
done

# 验收：一个 chief 都不能剩（内容和文件名）。
if grep -rli chief "$OUT/.claude-plugin" "$OUT/plugin" || find "$OUT/plugin" -iname '*chief*' | grep .; then
  echo "上面这些还有 chief 没换掉"
  exit 1
fi
echo "生成好了：$OUT（插件 $NAME@$NAME，工作目录 ~/$NAME，launchd dev.$NAME.engine）"
