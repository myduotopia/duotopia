#!/usr/bin/env bash
#
# sync-staging-to-develop.sh — 把 staging Supabase DB 的 public schema + 資料
# 整包複製覆蓋到 develop，讓 develop 成為「上線前測試 DB」。
#
# 設計重點（見 ../SKILL.md）：
#   - 方向固定 staging → develop，prod 硬性排除。
#   - 本地無 pg_dump/psql → 全程在 Docker `postgres` 容器內跑；dump 檔只存在
#     容器 /tmp（--rm 即焚），不落地、不掛載 host、不印任何連線字串。
#   - 只動 public schema（含 alembic_version / RLS policies），不碰 auth/storage。
#   - 預設 --dry-run（只檢查）；要真的覆蓋 develop 必須加 --execute。
#
# 用法：
#   bash sync-staging-to-develop.sh              # dry-run，只做安全檢查
#   bash sync-staging-to-develop.sh --execute    # 實際覆蓋 develop（破壞性）
#   bash sync-staging-to-develop.sh --verify     # 只比對 staging/develop 現況
#
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17}"
MODE="dry-run"
for arg in "$@"; do
  case "$arg" in
    --execute) MODE="execute" ;;
    --dry-run) MODE="dry-run" ;;
    --verify)  MODE="verify" ;;
    *) echo "未知參數: $arg"; exit 2 ;;
  esac
done

# --- 定位 backend/.env -------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 找不到 $ENV_FILE"; exit 1
fi

# 只取需要的 3 個變數值（不 source 整個 .env，避免污染/誤用 prod）。
# 去掉 CR（Windows CRLF）與外層引號。
read_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- \
    | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}
STAGING_URL="$(read_env DATABASE_URL_STAGING || true)"
DEVELOP_URL="$(read_env DATABASE_URL_DEVELOP || true)"
PROD_URL="$(read_env PROD_DATABASE_POOLER_URL || true)"

# --- 安全檢查（永不印出 URL 本身） ------------------------------------------
fail() { echo "❌ $1"; exit 1; }
[[ -n "$STAGING_URL" ]] || fail "DATABASE_URL_STAGING 為空"
[[ -n "$DEVELOP_URL" ]] || fail "DATABASE_URL_DEVELOP 為空（本地需要 develop 連線字串）"
[[ "$DEVELOP_URL" != "$STAGING_URL" ]] || fail "develop 與 staging 連線字串相同，拒絕執行"
if [[ -n "$PROD_URL" ]]; then
  [[ "$DEVELOP_URL" != "$PROD_URL" ]] || fail "目標等於 PROD，絕對拒絕"
  [[ "$STAGING_URL" != "$PROD_URL" ]] || fail "來源等於 PROD，絕對拒絕"
fi

# 解析 port（postgresql://user:pass@host:port/db）— 只印 port，不印 host/pass
url_port() {
  local p
  p="$(printf '%s' "$1" | sed -nE 's#^[a-z]+://[^@]+@[^:/]+:([0-9]+)/.*#\1#p')"
  [[ -n "$p" ]] && echo "$p" || echo "5432"
}
SRC_PORT="$(url_port "$STAGING_URL")"
DST_PORT="$(url_port "$DEVELOP_URL")"

echo "──────────────────────────────────────────────"
echo " 來源 : staging  (port $SRC_PORT)"
echo " 目標 : develop  (port $DST_PORT)"
echo " 範圍 : public schema（含 alembic_version / RLS policies）"
echo " 工具 : Docker $PG_IMAGE（dump 只存容器 /tmp，--rm 即焚）"
echo "──────────────────────────────────────────────"

for label in "$SRC_PORT:來源" "$DST_PORT:目標"; do
  port="${label%%:*}"; who="${label##*:}"
  if [[ "$port" == "6543" ]]; then
    fail "$who 用的是 transaction pooler(6543)，pg_dump/restore 不支援。請改用 session pooler(5432) 或 direct 連線字串。"
  fi
done

# --- dry-run：設定驗證到此為止（不需要 Docker） -----------------------------
if [[ "$MODE" == "dry-run" ]]; then
  echo "✅ 安全檢查通過（dry-run）：來源/目標/port/prod 排除皆 OK。"
  echo "   比對現況請用 --verify；實際覆蓋 develop 請用 --execute（需 Docker 在跑）。"
  exit 0
fi

# verify / execute 需要 Docker
command -v docker >/dev/null || fail "找不到 docker"
docker info >/dev/null 2>&1 || fail "Docker 沒在跑，請先啟動 Docker Desktop"

# --- verify 模式：只比對現況，不改任何東西 ---------------------------------
if [[ "$MODE" == "verify" ]]; then
  echo "🔎 比對 staging / develop 現況…"
  docker run --rm -e SRC="$STAGING_URL" -e DST="$DEVELOP_URL" "$PG_IMAGE" bash -c '
    set -e
    echo "alembic_version:"
    echo "  staging  = $(psql "$SRC" -tAc "select version_num from alembic_version" 2>/dev/null | tr -d "[:space:]")"
    echo "  develop  = $(psql "$DST" -tAc "select version_num from alembic_version" 2>/dev/null | tr -d "[:space:]")"
    for t in teachers classrooms assignments students; do
      s=$(psql "$SRC" -tAc "select count(*) from $t" 2>/dev/null | tr -d "[:space:]" || echo "?")
      d=$(psql "$DST" -tAc "select count(*) from $t" 2>/dev/null | tr -d "[:space:]" || echo "?")
      printf "  %-12s staging=%-6s develop=%-6s\n" "$t" "$s" "$d"
    done
  '
  exit 0
fi

# --- execute：破壞性覆蓋 develop --------------------------------------------
echo "⚠️  即將用 staging 的 public schema + 資料【覆蓋】develop（不可復原）。"
echo "🚚 dump staging → restore develop（單一容器內進行）…"
docker run --rm -e SRC="$STAGING_URL" -e DST="$DEVELOP_URL" "$PG_IMAGE" bash -c '
  set -e
  echo "  → pg_dump staging (public, custom format)…"
  pg_dump "$SRC" --schema=public --no-owner --no-privileges -Fc -f /tmp/staging.dump
  echo "  → pg_restore 覆蓋 develop（--clean --if-exists）…"
  pg_restore --clean --if-exists --no-owner --no-privileges -n public -d "$DST" /tmp/staging.dump
'
echo "✅ 同步完成。比對結果："
docker run --rm -e SRC="$STAGING_URL" -e DST="$DEVELOP_URL" "$PG_IMAGE" bash -c '
  set -e
  s=$(psql "$SRC" -tAc "select version_num from alembic_version" 2>/dev/null | tr -d "[:space:]")
  d=$(psql "$DST" -tAc "select version_num from alembic_version" 2>/dev/null | tr -d "[:space:]")
  echo "  alembic_version: staging=$s develop=$d $([[ "$s" == "$d" ]] && echo "✓" || echo "✗ 不一致")"
  for t in teachers classrooms assignments; do
    sc=$(psql "$SRC" -tAc "select count(*) from $t" 2>/dev/null | tr -d "[:space:]" || echo "?")
    dc=$(psql "$DST" -tAc "select count(*) from $t" 2>/dev/null | tr -d "[:space:]" || echo "?")
    printf "  %-12s staging=%-6s develop=%-6s\n" "$t" "$sc" "$dc"
  done
'
echo "🎉 develop 已對齊 staging。接著可對 develop 跑 alembic upgrade head 套新 migration。"
