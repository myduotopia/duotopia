#!/usr/bin/env bash
#
# nginx 設定 smoke test（Issue #940，起因 Issue #936 / PR #937）
#
# 目的：把「快取 / security header 回歸」在上線前擋下來。#936 那次 index.html
# 少了 Cache-Control，是靠人工 curl 才發現的。
#
# 作法：不需要跑 npm build——直接用官方 nginx:alpine 掛上待測設定 + 一份假的
# html root（index.html + 一個 content-hash 檔名的 asset），然後 curl 驗 header。
#
# 用法：frontend/scripts/nginx-smoke-test.sh
# 需求：docker、curl
#
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="nginx:alpine"
HOST_PORT="${NGINX_SMOKE_PORT:-18080}"
FAILURES=0

# 待測設定："<檔名>|<是否檢查 Cache-Control 規則>"
#
# nginx.conf              → Dockerfile.staging，prod / staging / develop / per-issue 全走這份
# nginx.conf.template     → Dockerfile（VM 部署，已 deprecated），含 ${BACKEND_URL} 佔位符
# nginx.staging.conf      → 目前無 Dockerfile 使用，但仍維護，一起驗以免 drift
# nginx.conf.vm.template  → Dockerfile.vm（已 deprecated），只有 server 層 header，
#                           沒有 index.html / assets 的快取規則，故不檢查 Cache-Control
CONFIGS=(
  "nginx.conf|cache"
  "nginx.conf.template|cache"
  "nginx.staging.conf|cache"
  "nginx.conf.vm.template|nocache"
)

log()  { printf '%s\n' "$*"; }
pass() { printf '  ✅ %s\n' "$*"; }
fail() { printf '  ❌ %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

command -v docker >/dev/null 2>&1 || { echo "ERROR: 需要 docker 才能跑這個 smoke test"; exit 1; }
command -v curl   >/dev/null 2>&1 || { echo "ERROR: 需要 curl 才能跑這個 smoke test"; exit 1; }

WORK_DIR="$(mktemp -d)"
CONTAINER=""
cleanup() {
  if [ -n "$CONTAINER" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# --- 假的 html root（模擬 vite build 產物）-------------------------------------
ASSET_NAME="index-abc123.js"
mkdir -p "$WORK_DIR/html/assets"
printf '<!doctype html><html><body>smoke</body></html>\n' > "$WORK_DIR/html/index.html"
printf 'console.log("smoke");\n' > "$WORK_DIR/html/assets/$ASSET_NAME"
chmod -R a+rX "$WORK_DIR"

# 抓某個 header 的所有值（header 名稱大小寫不敏感）
header_values() {
  local file="$1" name="$2"
  tr -d '\r' < "$file" | grep -i "^${name}:" | sed 's/^[^:]*: *//' || true
}

# assert：某個 header 的值裡要包含指定字串
assert_header_contains() {
  local file="$1" name="$2" expected="$3" label="$4"
  if header_values "$file" "$name" | grep -qiF -- "$expected"; then
    pass "$label：$name 含 '$expected'"
  else
    local got
    got="$(header_values "$file" "$name" | paste -sd';' - || true)"
    fail "$label：$name 應含 '$expected'，實際為 '${got:-<缺少此 header>}'"
  fi
}

assert_security_headers() {
  local file="$1" label="$2"
  assert_header_contains "$file" "X-Content-Type-Options" "nosniff"       "$label"
  assert_header_contains "$file" "X-Frame-Options"        "SAMEORIGIN"    "$label"
  assert_header_contains "$file" "X-XSS-Protection"       "1; mode=block" "$label"
}

fetch() {
  local path="$1" out="$2"
  curl -sS -o /dev/null -D "$out" "http://127.0.0.1:${HOST_PORT}${path}"
}

test_config() {
  local config_name="$1" cache_mode="$2"
  local src="$FRONTEND_DIR/$config_name"
  log ""
  log "── $config_name ──────────────────────────────────────────"

  if [ ! -f "$src" ]; then
    fail "$config_name：找不到檔案"
    return
  fi

  local rendered="$WORK_DIR/rendered.conf"
  # 1) 比照 start.sh 代入 ${BACKEND_URL}
  # 2) 把所有 proxy_pass 指向本機 dummy：nginx 啟動時會解析 proxy_pass 的網域，
  #    這個 smoke test 只驗 header，不該依賴外網 DNS
  sed -e 's|${BACKEND_URL}|http://127.0.0.1:9999|g' \
      -e 's|proxy_pass  *https\{0,1\}://[^;]*;|proxy_pass http://127.0.0.1:9999/;|g' \
      "$src" > "$rendered"
  chmod a+r "$rendered"

  # 設定裡 listen 幾號 port 就對應到容器內哪個 port（vm template 是 3000）
  local container_port
  container_port="$(grep -m1 -E '^[[:space:]]*listen[[:space:]]+' "$rendered" | grep -oE '[0-9]+' | head -1)"
  container_port="${container_port:-80}"

  CONTAINER="nginx-smoke-$$"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

  local docker_args=(
    run -d --name "$CONTAINER"
    -p "127.0.0.1:${HOST_PORT}:${container_port}"
    -v "$rendered:/etc/nginx/conf.d/default.conf:ro"
    -v "$WORK_DIR/html:/usr/share/nginx/html:ro"
  )
  # 共用 header 片段（Issue #940）。Dockerfile 會把它 COPY 進 image；
  # 若忘了 COPY，nginx 會因 include 找不到檔案而啟動失敗 → 這裡就會紅。
  if [ -f "$FRONTEND_DIR/security-headers.conf" ]; then
    docker_args+=(-v "$FRONTEND_DIR/security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro")
  fi
  docker_args+=("$IMAGE")

  if ! docker "${docker_args[@]}" >/dev/null; then
    fail "$config_name：nginx 容器啟動失敗（設定語法錯誤？）"
    CONTAINER=""
    return
  fi

  # 等 nginx 起來；容器若已退出（設定錯誤）就不必等滿逾時
  local ready=0 exited=0 i
  for i in $(seq 1 40); do
    if curl -sS -o /dev/null "http://127.0.0.1:${HOST_PORT}/" 2>/dev/null; then ready=1; break; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
      exited=1; break
    fi
    sleep 0.5
  done
  if [ "$ready" -ne 1 ]; then
    if [ "$exited" -eq 1 ]; then
      fail "$config_name：nginx 啟動後隨即退出（設定錯誤，例如 include 找不到檔案）"
    else
      fail "$config_name：nginx 沒有在時間內回應"
    fi
    log "  ── nginx 輸出 ──"
    docker logs "$CONTAINER" 2>&1 | tail -20 | sed 's/^/  /' || true
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    CONTAINER=""
    return
  fi

  # nginx -t 語法檢查
  if docker exec "$CONTAINER" nginx -t >/dev/null 2>&1; then
    pass "nginx -t 語法檢查通過"
  else
    fail "nginx -t 語法檢查失敗"
    docker exec "$CONTAINER" nginx -t 2>&1 | tail -10 || true
  fi

  # --- SPA 路由入口 "/"（try_files 內部轉址到 index.html）---
  fetch "/" "$WORK_DIR/h_root"
  assert_security_headers "$WORK_DIR/h_root" "GET /"

  # --- /index.html ---
  fetch "/index.html" "$WORK_DIR/h_index"
  assert_security_headers "$WORK_DIR/h_index" "GET /index.html"

  # --- content-hash 過的靜態資源 ---
  fetch "/assets/$ASSET_NAME" "$WORK_DIR/h_asset"
  assert_security_headers "$WORK_DIR/h_asset" "GET /assets/$ASSET_NAME"

  if [ "$cache_mode" = "cache" ]; then
    # index.html 絕不能被快取（Issue #936）：它指向 hash 過的 chunk，
    # 快取住會讓使用者部署後仍載到舊 bundle
    assert_header_contains "$WORK_DIR/h_root"  "Cache-Control" "no-cache" "GET /"
    assert_header_contains "$WORK_DIR/h_index" "Cache-Control" "no-cache, must-revalidate" "GET /index.html"
    # 靜態資源檔名帶 content hash → 可以永久快取
    assert_header_contains "$WORK_DIR/h_asset" "Cache-Control" "public, immutable" "GET /assets/$ASSET_NAME"
  fi

  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  CONTAINER=""
}

# --- 靜態檢查：每個 COPY nginx 設定的 Dockerfile 都必須一併 COPY 共用片段 ---------
#
# 下面的容器測試是把設定掛進原版 nginx image，驗不到 Dockerfile 本身。漏掉這行
# COPY 會讓 nginx 在該環境因 include 找不到檔案而「啟動失敗」（fail-fast，不會
# 靜默少 header），但要等部署才會發現——所以在這裡先用靜態檢查擋掉。
SNIPPET_COPY="COPY security-headers.conf /etc/nginx/snippets/security-headers.conf"

check_dockerfiles() {
  log ""
  log "── Dockerfile 靜態檢查 ──────────────────────────────────────"
  local df
  for df in "$FRONTEND_DIR"/Dockerfile*; do
    [ -f "$df" ] || continue
    local name
    name="$(basename "$df")"
    # 只檢查真的有把 nginx 設定放進 image 的 Dockerfile
    if ! grep -qE '^COPY[[:space:]]+nginx\.' "$df"; then
      continue
    fi
    if grep -qF "$SNIPPET_COPY" "$df"; then
      pass "$name：有 COPY security-headers.conf"
    else
      fail "$name：COPY 了 nginx 設定卻沒有 COPY security-headers.conf（nginx 會啟動失敗）"
    fi
  done
}

log "🧪 nginx 設定 smoke test（Cache-Control + security headers）"
log "   image: $IMAGE / host port: $HOST_PORT"

docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null

check_dockerfiles

for entry in "${CONFIGS[@]}"; do
  test_config "${entry%%|*}" "${entry##*|}"
done

log ""
if [ "$FAILURES" -eq 0 ]; then
  log "✅ 全部通過"
  exit 0
fi
log "❌ 有 $FAILURES 項檢查失敗"
exit 1
