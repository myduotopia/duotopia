#!/usr/bin/env python3
"""更新公告內容工具（issue #804）。

給兩個地方共用，規則只寫一次：
- /announce skill（開發者的 Claude Code）：檢查標籤、把公告寫進 issue 留言或
  staging → main PR 描述
- .github/workflows/release-announcement-draft.yml：push staging / main 時決定
  要不要建草稿、要不要帶現成內容給後端（帶了就不必再呼叫 Vertex AI）

規則：
- issue 同時有「📣 announce」與「✅ tested-in-staging」才發布
- 公告內容放在標記區塊內，是人可以直接在 GitHub 上修改的 markdown
- 找不到內容時不帶 content，後端退回「解析 release 標題 → Vertex AI」

只用標準函式庫；GitHub 呼叫透過 gh CLI（CI 內用 GH_TOKEN）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any, Dict, Iterable, List, Optional, Protocol, Tuple

LABEL_ANNOUNCE = "📣 announce"
LABEL_TESTED = "✅ tested-in-staging"

BLOCK_START = "<!-- release-announcement:start -->"
BLOCK_END = "<!-- release-announcement:end -->"
_ISSUES_RE = re.compile(r"<!-- release-announcement:issues ([\d,\s]*) -->")

# 欄位 ↔ 區塊內的小標題（順序即區塊內的顯示順序）
FIELDS: List[Tuple[str, str]] = [
    ("line_message_zh", "LINE 文案（中文）"),
    ("line_message_en", "LINE 文案（英文）"),
    ("article_title_zh", "官網標題（中文）"),
    ("article_body_zh", "官網內文（中文）"),
    ("article_title_en", "官網標題（英文）"),
    ("article_body_en", "官網內文（英文）"),
]
# 與後端 AI 草稿的驗證一致：中文 LINE 文案與中文標題是必要欄位
REQUIRED_FIELDS = ("line_message_zh", "article_title_zh")

# 公開 repo 任何人都能留言：只採用團隊成員寫的公告區塊
TRUSTED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})

REASON_NO_ANNOUNCE = "no_announce_label"
REASON_NOT_TESTED = "not_tested_in_staging"
REASON_NO_ISSUE = "no_issue_number"
REASON_NO_ELIGIBLE_ISSUE = "no_eligible_issue"

REASON_TEXT = {
    REASON_NO_ANNOUNCE: "此 issue 不需發布公告（沒有「📣 announce」標籤）",
    REASON_NOT_TESTED: "此 issue 還沒測試通過（沒有「✅ tested-in-staging」標籤）",
    REASON_NO_ISSUE: "commit 沒有對應的 issue 編號，視為不需發布",
    REASON_NO_ELIGIBLE_ISSUE: "沒有同時具備「📣 announce」與「✅ tested-in-staging」的 issue",
}


# ============ 公告區塊 ============


def render_block(
    content: Dict[str, str], issues: Optional[Iterable[int]] = None
) -> str:
    """產生可放進 issue 留言 / PR 描述的公告區塊（人可直接編輯）。"""
    lines = [
        BLOCK_START,
        "### 📣 更新公告內容",
        "",
        "> 由 `/announce` 產生，可直接編輯；CI 會讀取這個區塊建立後台草稿。請保留 `####` 小標題與前後的標記註解。",
        "",
    ]
    issue_list = [int(n) for n in issues or []]
    if issue_list:
        lines.append(
            f"<!-- release-announcement:issues {','.join(map(str, issue_list))} -->"
        )
        lines.append("")
    for field, heading in FIELDS:
        # 分隔線讓欄位界線清楚（內文自己的 ### 小標在 GitHub 上會比 #### 大）
        lines.append("---")
        lines.append("")
        lines.append(f"#### {heading}")
        lines.append("")
        lines.append((content.get(field) or "").strip())
        lines.append("")
    lines.append(BLOCK_END)
    return "\n".join(lines)


def parse_block(text: Optional[str]) -> Optional[Dict[str, Any]]:
    """從留言 / PR 描述取出公告區塊；沒有區塊回傳 None。"""
    if not text:
        return None
    text = text.replace("\r\n", "\n")
    start = text.find(BLOCK_START)
    if start == -1:
        return None
    end = text.find(BLOCK_END, start)
    inner = text[start + len(BLOCK_START) : end if end != -1 else len(text)]

    issues_match = _ISSUES_RE.search(inner)
    issues = (
        [int(n) for n in re.findall(r"\d+", issues_match.group(1))]
        if issues_match
        else []
    )

    heading_to_field = {heading: field for field, heading in FIELDS}
    content = {field: "" for field, _ in FIELDS}
    current: Optional[str] = None
    buffer: List[str] = []

    def flush() -> None:
        if current:
            value = "\n".join(buffer).strip()
            # 去掉 render_block 放在下一個欄位前的分隔線
            if value == "---":
                value = ""
            elif value.endswith("\n---"):
                value = value[: -len("\n---")].rstrip()
            content[current] = value

    for line in inner.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#### ") and stripped[5:].strip() in heading_to_field:
            flush()
            current = heading_to_field[stripped[5:].strip()]
            buffer = []
        elif current:
            buffer.append(line)
    flush()
    return {"content": content, "issues": issues}


def is_complete(content: Optional[Dict[str, str]]) -> bool:
    if not content:
        return False
    return all((content.get(field) or "").strip() for field in REQUIRED_FIELDS)


def replace_block(body: Optional[str], block: str) -> str:
    """把 body 內既有的公告區塊換成新的；沒有就接在最後。"""
    body = (body or "").replace("\r\n", "\n")
    start = body.find(BLOCK_START)
    if start != -1:
        end = body.find(BLOCK_END, start)
        end = end + len(BLOCK_END) if end != -1 else len(body)
        return body[:start] + block + body[end:]
    return f"{body.rstrip()}\n\n{block}\n" if body.strip() else f"{block}\n"


# ============ issue / 標籤 ============


def extract_issue_numbers(text: Optional[str]) -> List[int]:
    """取 Fixes/Closes/Resolves #N 與 feat(#N) / fix(#N) 這類 scope。

    標題結尾的 (#N) 是 PR 編號，不算 issue。
    """
    text = text or ""
    found = re.findall(r"(?:fixes|closes|resolves)\s*#(\d+)", text, flags=re.I)
    found += re.findall(r"^\s*\w+\(#(\d+)\)", text, flags=re.M)
    return list(dict.fromkeys(int(n) for n in found))


def eligibility(labels: Iterable[str]) -> Tuple[bool, Optional[str]]:
    labels = set(labels)
    if LABEL_ANNOUNCE not in labels:
        return False, REASON_NO_ANNOUNCE
    if LABEL_TESTED not in labels:
        return False, REASON_NOT_TESTED
    return True, None


class GitHubClient(Protocol):
    def issue_labels(self, number: int) -> List[str]:
        ...

    def issue_comments(self, number: int) -> List[Dict[str, Any]]:
        """[{"body": ..., "author_association": ...}]，由舊到新"""
        ...

    def commit_pulls(self, sha: str) -> List[Dict[str, Any]]:
        ...

    def pr_commit_messages(self, number: int) -> List[str]:
        ...


def issue_content(gh: GitHubClient, number: int) -> Optional[Dict[str, str]]:
    """issue 最新一則「團隊成員寫的」含公告區塊的留言內容。"""
    for comment in reversed(gh.issue_comments(number)):
        if comment.get("author_association") not in TRUSTED_ASSOCIATIONS:
            continue
        parsed = parse_block(comment.get("body"))
        if parsed:
            return parsed["content"]
    return None


def _eligible_issues(gh: GitHubClient, issues: Iterable[int]) -> List[int]:
    return [n for n in issues if eligibility(gh.issue_labels(n))[0]]


# ============ CI：決定要不要建草稿 ============


def _pr_number_from_title(title: str) -> Optional[int]:
    match = re.search(r"\(#(\d+)\)\s*$", title)
    return int(match.group(1)) if match else None


def _payload_for_issues(
    gh: GitHubClient,
    issues: List[int],
    base: Dict[str, Any],
) -> Dict[str, Any]:
    if not issues:
        return {"skip": REASON_NO_ISSUE}
    eligible = _eligible_issues(gh, issues)
    if not eligible:
        return {"skip": REASON_NO_ELIGIBLE_ISSUE}
    payload = {**base, "issue_numbers": ",".join(map(str, eligible))}
    # 只有一個 issue 時可直接沿用它的留言；多個 issue 要靠統整區塊
    if len(eligible) == 1:
        content = issue_content(gh, eligible[0])
        if is_complete(content):
            payload["content"] = content
    return payload


def build_ci_payload(
    gh: GitHubClient,
    *,
    environment: str,
    sha: str,
    branch: str,
    commit_message: str,
) -> Dict[str, Any]:
    """回傳送給後端 webhook 的 payload，或 {"skip": 原因}。"""
    title = (commit_message or "").strip().split("\n", 1)[0]
    base: Dict[str, Any] = {
        "environment": environment,
        "source_ref": sha,
        "source_branch": branch,
        "release_title": title,
    }

    if environment == "production":
        release_pr = next(
            (pr for pr in gh.commit_pulls(sha) if pr.get("base") == "main"), None
        )
        if release_pr:
            base["release_title"] = release_pr["title"]
            base["pr_number"] = release_pr["number"]
            parsed = parse_block(release_pr.get("body"))
            if parsed and is_complete(parsed["content"]):
                # 區塊寫好後標籤仍可能被拿掉：重新確認，一個都不符合就不發
                issues = parsed["issues"] or extract_issue_numbers(release_pr["title"])
                eligible = _eligible_issues(gh, issues)
                if not eligible:
                    return {"skip": REASON_NO_ELIGIBLE_ISSUE}
                return {
                    **base,
                    "issue_numbers": ",".join(map(str, eligible)),
                    "content": parsed["content"],
                }
            messages = [
                release_pr["title"],
                *gh.pr_commit_messages(release_pr["number"]),
            ]
            issues = list(
                dict.fromkeys(n for msg in messages for n in extract_issue_numbers(msg))
            )
            return _payload_for_issues(gh, issues, base)

    pr_number = _pr_number_from_title(title)
    if pr_number:
        base["pr_number"] = pr_number
    return _payload_for_issues(gh, extract_issue_numbers(commit_message), base)


# ============ gh CLI client ============


class GhCli:
    """用 gh CLI 呼叫 GitHub API（本機用登入身分，CI 用 GH_TOKEN）。"""

    def __init__(self, repo: Optional[str] = None):
        self.repo = repo or os.environ.get("GITHUB_REPOSITORY") or self._detect_repo()

    @staticmethod
    def _run(args: List[str], stdin: Optional[str] = None) -> str:
        result = subprocess.run(
            ["gh", *args], input=stdin, capture_output=True, text=True, check=True
        )
        return result.stdout

    def _detect_repo(self) -> str:
        return self._run(
            ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]
        ).strip()

    def _api(self, path: str, *extra: str) -> Any:
        out = self._run(["api", f"repos/{self.repo}/{path}", *extra])
        return json.loads(out) if out.strip() else None

    def _api_pages(self, path: str) -> List[Any]:
        out = self._run(["api", "--paginate", "--slurp", f"repos/{self.repo}/{path}"])
        return [item for page in json.loads(out or "[]") for item in page]

    def issue(self, number: int) -> Dict[str, Any]:
        return self._api(f"issues/{number}")

    def issue_labels(self, number: int) -> List[str]:
        return [label["name"] for label in self.issue(number).get("labels", [])]

    def _issue_comment_objects(self, number: int) -> List[Dict[str, Any]]:
        return self._api_pages(f"issues/{number}/comments?per_page=100")

    def issue_comments(self, number: int) -> List[Dict[str, Any]]:
        return [
            {
                "body": c.get("body") or "",
                "author_association": c.get("author_association"),
            }
            for c in self._issue_comment_objects(number)
        ]

    def commit_pulls(self, sha: str) -> List[Dict[str, Any]]:
        return [
            {
                "number": pr["number"],
                "title": pr["title"],
                "body": pr.get("body") or "",
                "base": pr["base"]["ref"],
            }
            for pr in self._api(f"commits/{sha}/pulls") or []
        ]

    def pr_commit_messages(self, number: int) -> List[str]:
        return [
            c["commit"]["message"]
            for c in self._api_pages(f"pulls/{number}/commits?per_page=100")
        ]

    def upsert_issue_comment(self, number: int, body: str) -> str:
        """更新最新一則團隊成員的公告留言；沒有就新增。回傳留言網址。"""
        existing = [
            c
            for c in self._issue_comment_objects(number)
            if BLOCK_START in (c.get("body") or "")
            and c.get("author_association") in TRUSTED_ASSOCIATIONS
        ]
        payload = json.dumps({"body": body})
        if existing:
            out = self._run(
                [
                    "api",
                    "-X",
                    "PATCH",
                    f"repos/{self.repo}/issues/comments/{existing[-1]['id']}",
                    "--input",
                    "-",
                ],
                stdin=payload,
            )
        else:
            out = self._run(
                [
                    "api",
                    "-X",
                    "POST",
                    f"repos/{self.repo}/issues/{number}/comments",
                    "--input",
                    "-",
                ],
                stdin=payload,
            )
        return json.loads(out)["html_url"]

    def update_pr_body(self, number: int, block: str) -> str:
        pr = self._api(f"pulls/{number}")
        out = self._run(
            ["api", "-X", "PATCH", f"repos/{self.repo}/pulls/{number}", "--input", "-"],
            stdin=json.dumps({"body": replace_block(pr.get("body"), block)}),
        )
        return json.loads(out)["html_url"]


# ============ CLI ============


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def _load_content(path: str) -> Dict[str, str]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    unknown = set(data) - {field for field, _ in FIELDS}
    if unknown:
        raise SystemExit(f"content 有未知欄位：{sorted(unknown)}")
    if not is_complete(data):
        raise SystemExit(f"content 缺少必要欄位：{REQUIRED_FIELDS}")
    return data


def _print(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_check(args: argparse.Namespace) -> None:
    gh = GhCli()
    issue = gh.issue(args.issue)
    labels = [label["name"] for label in issue.get("labels", [])]
    ok, reason = eligibility(labels)
    content = issue_content(gh, args.issue)
    _print(
        {
            "issue": args.issue,
            "title": issue.get("title"),
            "state": issue.get("state"),
            "labels": labels,
            "eligible": ok,
            "reason": reason,
            "message": REASON_TEXT.get(reason) if reason else None,
            "content": content,
        }
    )


def cmd_release_scan(args: argparse.Namespace) -> None:
    """列出 base..head 之間所有 issue 的標籤判斷與既有公告內容。"""
    gh = GhCli()
    messages = _git("log", "--format=%B%x00", f"{args.base}..{args.head}").split("\0")
    issues = list(
        dict.fromkeys(n for msg in messages for n in extract_issue_numbers(msg))
    )
    rows = []
    for number in issues:
        issue = gh.issue(number)
        labels = [label["name"] for label in issue.get("labels", [])]
        ok, reason = eligibility(labels)
        rows.append(
            {
                "issue": number,
                "title": issue.get("title"),
                "eligible": ok,
                "reason": reason,
                "message": REASON_TEXT.get(reason) if reason else None,
                "content": issue_content(gh, number) if ok else None,
            }
        )
    _print(rows)


def cmd_render(args: argparse.Namespace) -> None:
    issues = [int(n) for n in args.issues.split(",")] if args.issues else None
    print(render_block(_load_content(args.content), issues))


def cmd_upsert_issue(args: argparse.Namespace) -> None:
    gh = GhCli()
    ok, reason = eligibility(gh.issue_labels(args.issue))
    if not ok:
        raise SystemExit(REASON_TEXT[reason])
    url = gh.upsert_issue_comment(args.issue, render_block(_load_content(args.content)))
    print(url)


def cmd_upsert_pr(args: argparse.Namespace) -> None:
    gh = GhCli()
    issues = [int(n) for n in args.issues.split(",")] if args.issues else None
    url = gh.update_pr_body(args.pr, render_block(_load_content(args.content), issues))
    print(url)


def cmd_ci_payload(args: argparse.Namespace) -> None:
    payload = build_ci_payload(
        GhCli(),
        environment=args.environment,
        sha=args.sha,
        branch=args.branch,
        commit_message=args.commit_message,
    )
    if "skip" in payload:
        payload["message"] = REASON_TEXT[payload["skip"]]
    print(json.dumps(payload, ensure_ascii=False))


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("check", help="檢查單一 issue 是否可整理公告")
    p.add_argument("issue", type=int)
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("release-scan", help="列出 base..head 內各 issue 的狀態")
    p.add_argument("--base", default="origin/main")
    p.add_argument("--head", default="origin/staging")
    p.set_defaults(func=cmd_release_scan)

    p = sub.add_parser("render", help="預覽公告區塊（不寫入 GitHub）")
    p.add_argument("--content", required=True, help="六個欄位的 JSON 檔")
    p.add_argument("--issues", help="統整版涵蓋的 issue，逗號分隔")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("upsert-issue", help="寫入 / 更新 issue 的公告留言")
    p.add_argument("issue", type=int)
    p.add_argument("--content", required=True)
    p.set_defaults(func=cmd_upsert_issue)

    p = sub.add_parser("upsert-pr", help="寫入 / 更新 PR 描述內的統整公告")
    p.add_argument("pr", type=int)
    p.add_argument("--content", required=True)
    p.add_argument("--issues", required=True)
    p.set_defaults(func=cmd_upsert_pr)

    p = sub.add_parser("ci-payload", help="CI：產生 webhook payload 或 skip")
    p.add_argument("--environment", required=True, choices=["staging", "production"])
    p.add_argument("--sha", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--commit-message", required=True)
    p.set_defaults(func=cmd_ci_payload)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(exc.stderr or str(exc))
        sys.exit(exc.returncode or 1)
