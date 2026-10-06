"""Run backend like prod (single uvicorn worker) + log event-loop lag.

Run from backend/. Lag samples (ms) go to $LAG_FILE, one per 100ms tick.
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.getcwd())
import uvicorn  # noqa: E402

from main import app  # noqa: E402

LAG_FILE = os.environ.get("LAG_FILE", "lag.txt")


async def _probe():
    f = open(LAG_FILE, "w", buffering=1)
    while True:
        t = time.perf_counter()
        await asyncio.sleep(0.1)
        f.write(f"{(time.perf_counter() - t - 0.1) * 1000:.1f}\n")


@app.on_event("startup")
async def _start_probe():
    asyncio.get_running_loop().create_task(_probe())


class CloudRunConcurrency:
    """Queue requests beyond N in flight, like Cloud Run containerConcurrency."""

    def __init__(self, inner, n):
        self.inner, self.n, self.sem = inner, n, None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or self.n <= 0:
            return await self.inner(scope, receive, send)
        if self.sem is None:
            self.sem = asyncio.Semaphore(self.n)
        async with self.sem:
            await self.inner(scope, receive, send)


if __name__ == "__main__":
    wrapped = CloudRunConcurrency(app, int(os.getenv("CONCURRENCY", "10")))
    uvicorn.run(
        wrapped,
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8099")),
        log_level="warning",
    )
