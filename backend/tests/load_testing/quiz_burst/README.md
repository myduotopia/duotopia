# Quiz burst load test（Issue #1094）

模擬「一個班 40 人同時做單字選擇小考」，量測學生端 API 的 latency 與 event loop lag。
全部在本機 Docker 跑，不碰任何雲端 DB。

- **Postgres 15** 前面接 **toxiproxy**，可以人為加上 DB 網路延遲（模擬 Cloud Run → Supabase 的 round-trip）。
- backend 跑法比照 prod：單一 uvicorn worker，前面加上「同時最多 10 個 request、超過排隊」的限制
  （等同 Cloud Run `containerConcurrency=10`）。不加這個限制的話，同步 DB 會讓連線池耗盡而死鎖，數字不具參考性。
- locust：40 個學生 `selection_quiz/start` → 連續作答；另有 2 個 user 持續打 `/students/me`，
  用來觀察無關端點會不會被拖慢。

## 怎麼跑

需要 Docker、`locust`（`pip install locust`）、backend 的 Python 環境。以下都在 `backend/` 目錄執行。

```bash
# 1. 起 Postgres + toxiproxy，建立 proxy
docker compose -f tests/load_testing/quiz_burst/docker-compose.yml up -d
curl -s -X POST localhost:8474/proxies \
  -d '{"name":"pg","listen":"0.0.0.0:55433","upstream":"pg:5432"}'

# 2. 建 schema + seed（直連 55432，不經過 toxiproxy）
export DATABASE_URL=postgresql://lt:lt@localhost:55432/lt JWT_SECRET=loadtest-secret
alembic upgrade head
python tests/load_testing/quiz_burst/seed_quiz_class.py

# 3. 壓測：<label> <DB 延遲 ms> [秒數=60] [user 數=42]
tests/load_testing/quiz_burst/bench.sh before-20 20
# 改完程式後用同樣參數再跑一次比較
tests/load_testing/quiz_burst/bench.sh after-20 20

# 4. 收掉
docker compose -f tests/load_testing/quiz_burst/docker-compose.yml down
```

結果放在 `results/<label>/`（`locust_stats.csv`、`lag.txt`、`server.log`），已 gitignore。

## 判讀

- **event loop lag** 高（數百 ms 以上），而且 `/students/me` 跟著變慢 → 有 handler 在 event loop 上做同步 I/O。
- loop lag 低但 latency 高 → request 在等 DB（連線池或 DB 本身），往減少 round-trip 或調整 pool 方向查。
- `pool timeouts` > 0 → 連線池耗盡（`QueuePool limit ... reached`）。

## #1094 的基準數據（2026-10-01，開發機本機，60 秒、42 users；絕對數字依機器而異，看前後比例）

| DB 延遲 | 版本 | 作答 rps | 作答 p50 | `/students/me` p50 | loop lag p50 / max |
|---|---|---|---|---|---|
| 0ms | 改前 | 18.5 | 24ms | 14ms | 1ms / 72ms |
| 0ms | 改後 | 18.1 | 18ms | 9ms | 1ms / 7ms |
| 20ms | 改前 | 2.1 | 11s | 11s | 521ms / 4.1s |
| 20ms | 改後 | 15.3 | 300ms | 120ms | 1ms / 83ms |
| 50ms | 改前 | 0.5 | 29s | 28s | 775ms / 7.9s |
| 50ms | 改後 | 11.7 | 1.0s | 610ms | 1ms / 113ms |

「改前」= 學生端 handler 為沒有 await 的 `async def`；「改後」= 改成 `def`（跑在 threadpool）。
