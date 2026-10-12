#!/usr/bin/env bash
# 推一則 LINE 文字訊息（CI 通知用，issue #804）。
#
# 用法：LINE_TOKEN=... LINE_TO=... scripts/ci/line_push.sh "訊息內容"
#
# 通知失敗不讓 job 失敗，但會留下 ::warning::，避免 token 失效時無聲無息。
set -uo pipefail

TEXT="${1:?usage: line_push.sh <text>}"
# LINE 文字訊息上限 5000 字：超過就截斷並註明（例如本次略過的 issue 很多時）
# 以「字元」計算（wc -m 在 C locale 會算成 bytes，中文會被過早截斷）
TEXT="$(printf '%s' "$TEXT" | python3 -c '
import sys
text, limit = sys.stdin.read(), 4900
note = "\n…（訊息過長已截斷，請到 GitHub 查看完整內容）"
print(text if len(text) <= limit else text[:limit] + note, end="")
')"

if [ -z "${LINE_TOKEN:-}" ] || [ -z "${LINE_TO:-}" ]; then
  echo "::warning::LINE_TOKEN / LINE_TO 未設定，略過 LINE 通知"
  exit 0
fi

BODY=$(jq -n --arg to "$LINE_TO" --arg text "$TEXT" \
  '{to: $to, messages: [{type: "text", text: $text}]}')

RESPONSE=$(mktemp)
trap 'rm -f "$RESPONSE"' EXIT

HTTP_CODE=$(curl -s -o "$RESPONSE" -w "%{http_code}" \
  -X POST "https://api.line.me/v2/bot/message/push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINE_TOKEN" \
  -d "$BODY") || HTTP_CODE="000"

if [ "$HTTP_CODE" != "200" ]; then
  echo "::warning::LINE 通知失敗（HTTP $HTTP_CODE）：$(cat "$RESPONSE" 2>/dev/null)"
else
  echo "✅ LINE 通知已送出"
fi
exit 0
