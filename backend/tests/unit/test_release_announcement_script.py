"""scripts/release_announcement.py 的測試（issue #804 PR3）。

這支腳本同時給 /announce skill 與 release-announcement-draft workflow 使用：
- 公告區塊的產生 / 解析（issue 留言、staging → main PR 描述）
- 標籤判斷：同時有「📣 announce」與「✅ tested-in-staging」才發布
- CI 決定要不要建草稿、帶哪些內容給後端
GitHub 呼叫一律透過注入的 client，測試不需要網路。
"""

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import release_announcement as ra  # noqa: E402

CONTENT = {
    "line_message_zh": "班級分組上線囉！",
    "line_message_en": "Class groups are live!",
    "article_title_zh": "新功能：班級分組",
    "article_body_zh": "老師可以把學生分組。\n\n### 怎麼用\n1. 進入班級",
    "article_title_en": "New: class groups",
    "article_body_en": "Teachers can now group students.",
}

BOTH = [ra.LABEL_ANNOUNCE, ra.LABEL_TESTED]


class FakeGitHub:
    def __init__(
        self,
        labels=None,
        comments=None,
        commit_prs=None,
        pr_commits=None,
    ):
        self.labels = labels or {}
        self.comments = comments or {}
        self.commit_prs = commit_prs or {}
        self.pr_commits = pr_commits or {}

    def issue_labels(self, number):
        return self.labels.get(number, [])

    def issue_comments(self, number):
        # 純字串視為團隊成員的留言；要測外部留言時直接給 dict
        return [
            c if isinstance(c, dict) else {"body": c, "author_association": "MEMBER"}
            for c in self.comments.get(number, [])
        ]

    def commit_pulls(self, sha):
        return self.commit_prs.get(sha, [])

    def pr_commit_messages(self, number):
        return self.pr_commits.get(number, [])


class TestBlock:
    def test_render_then_parse_round_trip(self):
        block = ra.render_block(CONTENT)
        parsed = ra.parse_block(f"前言\n\n{block}\n\n後記")
        assert parsed["content"] == CONTENT
        assert parsed["issues"] == []

    def test_round_trip_keeps_issue_list(self):
        block = ra.render_block(CONTENT, issues=[1046, 1045])
        assert ra.parse_block(block)["issues"] == [1046, 1045]

    def test_human_edits_on_github_are_read_back(self):
        """區塊是人可直接編輯的 markdown，不是藏起來的 JSON"""
        edited = ra.render_block(CONTENT).replace("班級分組上線囉！", "手動改過的文案")
        assert ra.parse_block(edited)["content"]["line_message_zh"] == "手動改過的文案"

    def test_fields_are_separated_by_rules(self):
        """欄位之間用分隔線隔開，內文自己的 ### 小標才不會被誤看成下一個欄位"""
        block = ra.render_block(CONTENT)
        assert block.count("\n---\n") == len(ra.FIELDS)

    def test_trailing_rule_in_body_is_dropped(self):
        """已知限制：內文「最後」的分隔線會被當成欄位分隔線去掉（中間的會保留）"""
        content = {**CONTENT, "article_body_en": "Body\n\n---"}
        parsed = ra.parse_block(ra.render_block(content))
        assert parsed["content"]["article_body_en"] == "Body"

    def test_rule_inside_body_is_kept(self):
        content = {**CONTENT, "article_body_en": "Line one\n\n---\n\nLine two"}
        parsed = ra.parse_block(ra.render_block(content))
        assert parsed["content"]["article_body_en"] == "Line one\n\n---\n\nLine two"

    def test_github_crlf_line_endings(self):
        block = ra.render_block(CONTENT).replace("\n", "\r\n")
        assert ra.parse_block(block)["content"] == CONTENT

    def test_unterminated_block_reads_to_end(self):
        block = ra.render_block(CONTENT).replace(ra.BLOCK_END, "")
        assert ra.parse_block(block)["content"] == CONTENT

    def test_no_block_returns_none(self):
        assert ra.parse_block("一般留言，沒有公告") is None
        assert ra.parse_block(None) is None

    def test_is_complete_requires_zh_line_and_article(self):
        assert ra.is_complete(CONTENT)
        assert not ra.is_complete({**CONTENT, "line_message_zh": " "})
        assert not ra.is_complete({**CONTENT, "article_title_zh": ""})
        # 英文留空仍可發（後端 / LINE 卡片會略過英文段）
        assert ra.is_complete({**CONTENT, "line_message_en": ""})

    def test_replace_block_updates_existing(self):
        body = "## 變更\n- a\n\n" + ra.render_block(CONTENT)
        new = ra.replace_block(
            body, ra.render_block({**CONTENT, "line_message_zh": "新"})
        )
        assert new.count(ra.BLOCK_START) == 1
        assert new.startswith("## 變更\n- a")
        assert ra.parse_block(new)["content"]["line_message_zh"] == "新"

    def test_replace_block_appends_when_missing(self):
        new = ra.replace_block("## 變更", ra.render_block(CONTENT))
        assert new.startswith("## 變更")
        assert ra.parse_block(new)["content"] == CONTENT


class TestIssueNumbers:
    @pytest.mark.parametrize(
        "title, expected",
        [
            ("Release: [Bug]: 名單沒有y軸 (Fixes #1070) (#1071)", [1070]),
            ("feat(#1046): 班級學生分組設定 (#1067)", [1046]),
            ("hotfix(#1047): Azure Speech SDK", [1047]),
            ("fix: closes #12 and resolves #13", [12, 13]),
            ("chore: bump deps (#1080)", []),
            ("Merge pull request #1072 from myduotopia/staging", []),
        ],
    )
    def test_extract(self, title, expected):
        assert ra.extract_issue_numbers(title) == expected


class TestEligibility:
    def test_requires_both_labels(self):
        assert ra.eligibility(BOTH) == (True, None)
        assert ra.eligibility([ra.LABEL_TESTED]) == (False, ra.REASON_NO_ANNOUNCE)
        assert ra.eligibility([ra.LABEL_ANNOUNCE]) == (False, ra.REASON_NOT_TESTED)
        assert ra.eligibility([]) == (False, ra.REASON_NO_ANNOUNCE)

    def test_latest_marked_comment_wins(self):
        gh = FakeGitHub(
            comments={
                5: [
                    ra.render_block({**CONTENT, "line_message_zh": "舊版"}),
                    "無關留言",
                    ra.render_block({**CONTENT, "line_message_zh": "新版"}),
                ]
            }
        )
        assert ra.issue_content(gh, 5)["line_message_zh"] == "新版"

    def test_ignores_blocks_from_outside_contributors(self):
        """公開 repo：任何人都能留言，只採用 OWNER / MEMBER / COLLABORATOR 寫的區塊"""
        planted = {
            "body": ra.render_block({**CONTENT, "line_message_zh": "外人塞的內容"}),
            "author_association": "NONE",
        }
        gh = FakeGitHub(comments={5: [ra.render_block(CONTENT), planted]})
        assert ra.issue_content(gh, 5)["line_message_zh"] == CONTENT["line_message_zh"]

        gh = FakeGitHub(comments={5: [planted]})
        assert ra.issue_content(gh, 5) is None


class TestGhCli:
    def _cli(self, monkeypatch, error):
        cli = ra.GhCli(repo="o/r")

        def boom(args, stdin=None):
            raise subprocess.CalledProcessError(1, ["gh", *args], stderr=error)

        monkeypatch.setattr(cli, "_run", boom)
        return cli

    def test_missing_issue_has_no_labels(self, monkeypatch):
        """feat(#N) 的 N 不是 issue（例如打錯）→ 視為不符合，不要讓整個 job 失敗"""
        cli = self._cli(monkeypatch, "gh: Not Found (HTTP 404)")
        assert cli.issue_labels(99999) == []

    def test_other_api_errors_still_raise(self, monkeypatch):
        cli = self._cli(monkeypatch, "gh: Server Error (HTTP 502)")
        with pytest.raises(subprocess.CalledProcessError):
            cli.issue_labels(1)


class TestStagingPayload:
    def _payload(self, gh, message):
        return ra.build_ci_payload(
            gh,
            environment="staging",
            sha="sha1",
            branch="staging",
            commit_message=message,
        )

    def test_no_issue_number_skips(self):
        result = self._payload(FakeGitHub(), "chore: bump deps (#1080)")
        assert result["skip"] == ra.REASON_NO_ISSUE

    def test_issue_without_both_labels_skips(self):
        gh = FakeGitHub(labels={1070: [ra.LABEL_ANNOUNCE]})
        result = self._payload(gh, "Release: [Bug]: x (Fixes #1070) (#1071)")
        assert result["skip"] == ra.REASON_NO_ELIGIBLE_ISSUE

    def test_uses_issue_comment_content(self):
        gh = FakeGitHub(
            labels={1070: BOTH}, comments={1070: [ra.render_block(CONTENT)]}
        )
        result = self._payload(gh, "Release: [Bug]: x (Fixes #1070) (#1071)")
        assert "skip" not in result
        assert result["content"] == CONTENT
        assert result["issue_numbers"] == "1070"
        assert result["environment"] == "staging"
        assert result["source_ref"] == "sha1"
        assert result["pr_number"] == 1071

    def test_multiple_issues_in_one_commit_fall_back_to_vertex(self):
        """單一 commit 含多個 issue 時沒有統整內容，不拿其中一則留言代表全部"""
        gh = FakeGitHub(
            labels={12: BOTH, 13: BOTH},
            comments={12: [ra.render_block(CONTENT)], 13: [ra.render_block(CONTENT)]},
        )
        result = self._payload(gh, "fix: closes #12 and resolves #13")
        assert "content" not in result
        assert result["issue_numbers"] == "12,13"

    def test_eligible_without_comment_falls_back_to_vertex(self):
        gh = FakeGitHub(labels={1070: BOTH})
        result = self._payload(gh, "Release: [Bug]: x (Fixes #1070) (#1071)")
        assert "content" not in result
        assert result["release_title"] == "Release: [Bug]: x (Fixes #1070) (#1071)"


class TestProductionPayload:
    RELEASE_PR = {
        "number": 1072,
        "title": "Release: staging → main（#1046 班級分組、#1051 例句翻譯）",
        "base": "main",
        "body": "",
    }

    def _payload(self, gh):
        return ra.build_ci_payload(
            gh,
            environment="production",
            sha="merge-sha",
            branch="main",
            commit_message="Merge pull request #1072 from myduotopia/staging",
        )

    def test_uses_aggregated_block_from_pr_body(self):
        pr = {
            **self.RELEASE_PR,
            "body": ra.render_block(CONTENT, issues=[1046]),
        }
        gh = FakeGitHub(commit_prs={"merge-sha": [pr]}, labels={1046: BOTH})
        result = self._payload(gh)
        assert result["content"] == CONTENT
        assert result["issue_numbers"] == "1046"
        assert result["pr_number"] == 1072
        assert result["release_title"] == self.RELEASE_PR["title"]

    def test_block_issues_are_rechecked_against_labels(self):
        """統整區塊寫好後 issue 若被拿掉標籤，就不再列入"""
        pr = {**self.RELEASE_PR, "body": ra.render_block(CONTENT, issues=[1046, 1045])}
        gh = FakeGitHub(
            commit_prs={"merge-sha": [pr]},
            labels={1046: BOTH, 1045: [ra.LABEL_ANNOUNCE]},
        )
        result = self._payload(gh)
        assert result["content"] == CONTENT
        assert result["issue_numbers"] == "1046"

    def test_block_whose_issues_all_lost_labels_skips(self):
        pr = {**self.RELEASE_PR, "body": ra.render_block(CONTENT, issues=[1045])}
        gh = FakeGitHub(
            commit_prs={"merge-sha": [pr]}, labels={1045: [ra.LABEL_ANNOUNCE]}
        )
        assert self._payload(gh)["skip"] == ra.REASON_NO_ELIGIBLE_ISSUE

    def test_without_block_falls_back_for_eligible_issues_only(self):
        gh = FakeGitHub(
            commit_prs={"merge-sha": [self.RELEASE_PR]},
            pr_commits={
                1072: [
                    "Release: 班級分組 (Fixes #1046) (#1053)",
                    "Release: 例句翻譯 (Fixes #1051) (#1058)",
                    "ci: something",
                ]
            },
            labels={1046: BOTH, 1051: ["bug"]},
        )
        result = self._payload(gh)
        assert "content" not in result
        assert result["issue_numbers"] == "1046"

    def test_without_block_and_no_eligible_issue_skips(self):
        gh = FakeGitHub(
            commit_prs={"merge-sha": [self.RELEASE_PR]},
            pr_commits={1072: ["Release: 例句翻譯 (Fixes #1051) (#1058)"]},
            labels={1051: [ra.LABEL_ANNOUNCE]},
        )
        assert self._payload(gh)["skip"] == ra.REASON_NO_ELIGIBLE_ISSUE

    def test_ignores_prs_not_targeting_main(self):
        feature_pr = {**self.RELEASE_PR, "base": "staging", "number": 9}
        gh = FakeGitHub(commit_prs={"merge-sha": [feature_pr]})
        assert self._payload(gh)["skip"] == ra.REASON_NO_ISSUE

    def test_direct_hotfix_pr_uses_its_issue(self):
        hotfix = {
            "number": 1048,
            "title": "hotfix(#1047): Azure Speech SDK",
            "base": "main",
            "body": "",
        }
        gh = FakeGitHub(
            commit_prs={"merge-sha": [hotfix]},
            pr_commits={1048: ["hotfix(#1047): bump sdk"]},
            labels={1047: BOTH},
            comments={1047: [ra.render_block(CONTENT)]},
        )
        result = self._payload(gh)
        # 單一 issue 的 hotfix：沒有統整區塊時可直接沿用該 issue 的留言
        assert result["content"] == CONTENT
        assert result["issue_numbers"] == "1047"
