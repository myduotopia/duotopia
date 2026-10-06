#!/bin/bash
# Issue #1094: 模擬「全班同時作答」，量測學生端 API latency 與 event loop lag。
#
# Usage（在 backend/ 目錄執行，先照 README 起好 docker + seed）:
#   tests/load_testing/quiz_burst/bench.sh <label> <db_latency_ms> [duration_s] [users]
#
# 可用環境變數覆寫：PYTHON（預設 python）、LOCUST（預設 locust）、CONCURRENCY（預設 10）
set -euo pipefail
LABEL=$1; LAT=$2; DUR=${3:-60}; USERS=${4:-42}
L=$(cd "$(dirname "$0")" && pwd)
PY=${PYTHON:-python}
LOCUST=${LOCUST:-locust}
COMPOSE="docker compose -f $L/docker-compose.yml"
OUT=$L/results/$LABEL; mkdir -p "$OUT"

# DB latency：加在 toxiproxy 回程，每次 DB round-trip 約多 LAT ms
curl -s -X DELETE localhost:8474/proxies/pg/toxics/lat >/dev/null
if [ "$LAT" -gt 0 ]; then
  curl -s -X POST localhost:8474/proxies/pg/toxics \
    -d "{\"name\":\"lat\",\"type\":\"latency\",\"stream\":\"downstream\",\"attributes\":{\"latency\":$LAT}}" >/dev/null
fi

# 每次都從全新的小考開始
$COMPOSE exec -T pg psql -q -U lt -d lt -c \
  "TRUNCATE practice_answers, practice_sessions, student_item_progress CASCADE; UPDATE student_assignments SET status='NOT_STARTED', started_at=NULL, submitted_at=NULL;" >/dev/null

export DATABASE_URL=postgresql://lt:lt@127.0.0.1:55433/lt JWT_SECRET=loadtest-secret \
       ENVIRONMENT=development PORT=8099 LAG_FILE=$OUT/lag.txt
# token 只有 1 天效期，每次重簽（必須與 server 用同一個 JWT_SECRET）
$PY "$L/seed_quiz_class.py" --tokens-only >"$OUT/tokens.log" 2>&1 \
  || { echo "token refresh failed, see $OUT/tokens.log" >&2; exit 1; }
$PY "$L/run_server.py" >"$OUT/server.log" 2>&1 &
SRV=$!
for _ in $(seq 1 60); do curl -s -o /dev/null localhost:8099/health && break; sleep 1; done
curl -sf -o /dev/null localhost:8099/health || { echo "server did not start, see $OUT/server.log" >&2; kill $SRV; exit 1; }

$LOCUST -f "$L/locustfile.py" --headless -u "$USERS" -r "$USERS" -t "${DUR}s" \
  -H http://127.0.0.1:8099 --csv "$OUT/locust" --only-summary >"$OUT/locust.log" 2>&1 \
  || true  # locust 有任何失敗 request 時 exit 1；失敗數會列在下面的摘要裡

kill $SRV; wait $SRV 2>/dev/null || true
$PY - "$OUT" "$LABEL" "$LAT" <<'EOF'
import csv, sys
out, label, lat = sys.argv[1:]
lag = sorted(float(x) for x in open(f"{out}/lag.txt") if x.strip())
q = lambda v, p: v[min(len(v) - 1, int(len(v) * p))]
print(f"== {label}  (DB latency {lat}ms)")
print(f"  event-loop lag ms: p50={q(lag,.5):.0f} p90={q(lag,.9):.0f} p99={q(lag,.99):.0f} max={lag[-1]:.0f}")
for r in csv.DictReader(open(f"{out}/locust_stats.csv")):
    if r["Name"] == "Aggregated" or r["Request Count"] == "0":
        continue
    print(f"  {r['Name']:<22} n={r['Request Count']:>5} fail={r['Failure Count']:>3} "
          f"rps={float(r['Requests/s']):5.1f} p50={r['50%']:>5} p90={r['90%']:>5} p99={r['99%']:>5} ms")
pool = sum("QueuePool limit" in line for line in open(f"{out}/server.log"))
print(f"  pool timeouts: {pool}")
EOF
