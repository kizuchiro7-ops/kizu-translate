#!/bin/bash
# クリップボードにコピーした Resend の APIキーを Worker のシークレットに登録する。
#
# 手で貼り付けると、次のような形で失敗しやすい:
#   - コマンドの末尾にキーが連結される（Enter を押す前に貼ってしまう）
#   - 表の行ごと選択して「名前」と「キー」の2行がコピーされる
#   - Enter a secret value: が出る前に貼ってしまう
#
# そこでクリップボードから `re_` で始まる行だけを取り出して渡す。
# キーは一度も画面に出ない。
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=$(pbpaste | grep -m1 '^re_' || true)

if [ -z "$KEY" ]; then
  echo "❌ クリップボードに Resend のAPIキー（re_ で始まる行）が見つかりません。"
  echo "   Resend でキーを作成し、コピーしてから、もう一度実行してください。"
  exit 1
fi

echo "✅ クリップボードからキーを検出しました（${#KEY}文字）。登録します…"
printf '%s' "$KEY" | npx --yes wrangler secret put RESEND_API_KEY

echo
echo "登録が終わりました。送信テストは次のコマンドで行えます:"
echo '  curl -s -X POST https://kizu-translate.kizuchiro7.workers.dev/auth/request-code \'
echo '    -H "Content-Type: application/json" -d "{\"email\":\"kizuchiro7@gmail.com\"}"'
