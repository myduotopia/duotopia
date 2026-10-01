"""Issue #1094: 學生端 route handler 不可以是「沒有 await 的 async def」。

FastAPI 會把 ``async def`` endpoint 直接跑在 event loop 上；裡面若用同步
SQLAlchemy Session 查 DB，每次 round-trip 都會擋住同一個 instance 的所有
request。全班同時作答時，這會讓連無關的 ``/students/me`` 也跟著變慢，甚至因
連線池耗盡而死鎖（get_db 的 teardown 需要 event loop 才能歸還連線）。

沒有 await 的 handler 一律宣告成 ``def``，讓 FastAPI 丟到 threadpool 執行。
真的需要 await 的 handler（例如產音檔、上傳錄音）才保留 ``async def``。
"""

import ast
from pathlib import Path

import pytest

STUDENT_ROUTERS = Path(__file__).resolve().parents[2] / "routers" / "students"


def _route_handlers(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if any("router." in ast.unparse(d) for d in node.decorator_list):
            yield node


def _uses_await(node: ast.AsyncFunctionDef) -> bool:
    return any(
        isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith)) for n in ast.walk(node)
    )


@pytest.mark.parametrize(
    "path", sorted(STUDENT_ROUTERS.glob("*.py")), ids=lambda p: p.name
)
def test_async_student_handlers_actually_await(path):
    offenders = [
        f"{path.name}:{node.lineno} {node.name}"
        for node in _route_handlers(path)
        if isinstance(node, ast.AsyncFunctionDef) and not _uses_await(node)
    ]
    assert not offenders, (
        "這些 async def handler 沒有 await，會在 event loop 上做同步 DB I/O，"
        "請改成 def（Issue #1094）：\n" + "\n".join(offenders)
    )
