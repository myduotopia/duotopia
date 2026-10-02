#!/usr/bin/env bash
# 推一則 LINE 文字訊息（CI 通知用，issue #804）。
#
# 用法：LINE_TOKEN=... LINE_TO=... scripts/ci/line_push.sh "訊息內容"
#
# 通知失敗不讓 job 失敗，但會留下 ::warning::，避免 token 失效時無聲無息。
set -uo pipefail

TEXT="${1:?usage: line_push.sh <text>}"

if [ -z "${LINE_TOKEN:-}" ] || [ -z "${LINE_TO:-}" ]; then
  echo "::warning::LINE_TOKEN / LINE_TO 未設定，略過 LINE 通知"
  exit 0
fi

BODY=$(jq -n --arg to "$LINE_TO" --arg text "$TEXT" \
  '{to: $to, messages: [{type: "text", text: $text}]}')

HTTP_CODE=$(curl -s -o /tmp/line_push_response.json -w "%{http_code}" \
  -X POST "https://api.line.me/v2/bot/message/push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINE_TOKEN" \
  -d "$BODY") || HTTP_CODE="000"

if [ "$HTTP_CODE" != "200" ]; then
  echo "::warning::LINE 通知失敗（HTTP $HTTP_CODE）：$(cat /tmp/line_push_response.json 2>/dev/null)"
else
  echo "✅ LINE 通知已送出"
fi
exit 0
