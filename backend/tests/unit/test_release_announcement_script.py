"""scripts/release_announcement.py 的測試（issue #804 PR3）。

這支腳本同時給 /announce skill 與 release-announcement-draft workflow 使用：
- 公告區塊的產生 / 解析（issue 留言、staging → main PR 描述）
- 標籤判斷：同時有「📣 announce」與「✅ tested-in-staging」才發布
- CI 決定要不要建草稿、帶哪些內容給後端
GitHub 呼叫一律透過注入的 client，測試不需要網路。
"""

import json
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
        missing=(),
    ):
        self.labels = labels or {}
        self.comments = comments or {}
        self.commit_prs = commit_prs or {}
        self.pr_commits = pr_commits or {}
        self.missing = set(missing)

    def find_issue(self, number):
        if number in self.missing:
            return None
        return {
            "title": f"issue {number}",
            "labels": [{"name": n} for n in self.labels.get(number, [])],
        }

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


class TestBlockStatus:
    """CI 自動化用：已經有完整區塊（例如本機 /announce 寫過）就不再自動產生"""

    def test_complete_block(self):
        status = ra.block_status(ra.render_block(CONTENT, issues=[1046]))
        assert status == {"has_block": True, "complete": True, "issues": [1046]}

    def test_incomplete_block(self):
        body = ra.render_block({**CONTENT, "line_message_zh": ""})
        assert ra.block_status(body)["complete"] is False

    def test_no_block(self):
        assert ra.block_status("## 本次發版內容") == {
            "has_block": False,
            "complete": False,
            "issues": [],
        }


class TestPrBlockCommand:
    def test_reads_pr_body_through_public_method(self, monkeypatch, capsys):
        body = ra.render_block(CONTENT, issues=[1046])
        monkeypatch.setattr(ra.GhCli, "_detect_repo", lambda self: "o/r")
        monkeypatch.setattr(
            ra.GhCli, "get_pr", lambda self, number: {"number": number, "body": body}
        )
        ra.main(["pr-block", "1072"])
        out = __import__("json").loads(capsys.readouterr().out)
        assert out == {"has_block": True, "complete": True, "issues": [1046]}


HERO = "https://storage.googleapis.com/duotopia-audio/announcements/issue-1046/hero.png"


class TestHeroImageField:
    """#1100：公告區塊可帶主圖網址（選填），內文可放 markdown 圖片"""

    def test_round_trip_with_hero(self):
        content = {**CONTENT, "image_url": HERO}
        assert ra.parse_block(ra.render_block(content))["content"] == content

    def test_empty_hero_is_omitted(self):
        """沒有主圖時欄位仍顯示（方便在 GitHub 補貼），但解析結果不含 image_url"""
        block = ra.render_block(CONTENT)
        assert "#### 主圖網址（選填）" in block
        assert "image_url" not in ra.parse_block(block)["content"]

    @pytest.mark.parametrize(
        "pasted",
        [
            f"![主圖]({HERO})",
            f'<img width="1200" alt="hero" src="{HERO}" />',
            f"  {HERO}  ",
        ],
    )
    def test_hero_pasted_as_markdown_or_html_becomes_url(self, pasted):
        block = ra.render_block({**CONTENT, "image_url": "PLACEHOLDER"}).replace(
            "PLACEHOLDER", pasted
        )
        assert ra.parse_block(block)["content"]["image_url"] == HERO

    def test_body_images_are_kept(self):
        body = f"說明\n\n![步驟一]({HERO})\n\n下一段"
        content = {**CONTENT, "article_body_zh": body}
        parsed = ra.parse_block(ra.render_block(content))["content"]
        assert parsed["article_body_zh"] == body

    def test_load_content_accepts_https_hero_only(self, tmp_path):
        good = tmp_path / "good.json"
        good.write_text(json.dumps({**CONTENT, "image_url": HERO}), encoding="utf-8")
        assert ra._load_content(str(good))["image_url"] == HERO

        bad = tmp_path / "bad.json"
        bad.write_text(
            json.dumps({**CONTENT, "image_url": "http://x/a.png"}), encoding="utf-8"
        )
        with pytest.raises(SystemExit, match="https"):
            ra._load_content(str(bad))


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPEG = b"\xff\xd8\xff" + b"0" * 64


class FakeRunner:
    def __init__(self, returncode=0, stderr="", account="dev@example.com"):
        self.calls = []
        self.returncode = returncode
        self.stderr = stderr
        self.account = account

    def __call__(self, args):
        self.calls.append(args)
        if args[:3] == ["gcloud", "config", "get-value"]:
            return subprocess.CompletedProcess(args, 0, self.account + "\n", "")
        return subprocess.CompletedProcess(args, self.returncode, "", self.stderr)


class TestUploadImage:
    def _file(self, tmp_path, data, name="shot.png"):
        path = tmp_path / name
        path.write_bytes(data)
        return str(path)

    def test_uploads_to_issue_folder_and_returns_public_url(self, tmp_path):
        runner = FakeRunner()
        url = ra.upload_image(
            self._file(tmp_path, PNG), issue=1046, runner=runner, stamp="20261006"
        )
        assert url.startswith(
            "https://storage.googleapis.com/duotopia-audio/announcements/issue-1046/"
        )
        assert url.endswith(".png")
        cp = next(c for c in runner.calls if c[:3] == ["gcloud", "storage", "cp"])
        assert cp[-1].startswith("gs://duotopia-audio/announcements/issue-1046/")
        assert "--content-type=image/png" in cp

    def test_rejects_non_image(self, tmp_path):
        with pytest.raises(SystemExit, match="圖片"):
            ra.upload_image(
                self._file(tmp_path, b"not an image", "a.txt"),
                issue=1,
                runner=FakeRunner(),
            )

    def test_hero_must_be_jpeg_or_png(self, tmp_path):
        gif = b"GIF89a" + b"0" * 64
        with pytest.raises(SystemExit, match="JPEG"):
            ra.upload_image(
                self._file(tmp_path, gif, "a.gif"),
                issue=1,
                hero=True,
                runner=FakeRunner(),
            )
        # 內文圖片不限 JPEG / PNG
        assert ra.upload_image(
            self._file(tmp_path, gif, "b.gif"), issue=1, runner=FakeRunner()
        ).endswith(".gif")

    def test_hero_over_1mb_rejected(self, tmp_path):
        big = JPEG + b"0" * (1024 * 1024)
        with pytest.raises(SystemExit, match="1 MB"):
            ra.upload_image(
                self._file(tmp_path, big, "h.jpg"),
                issue=1,
                hero=True,
                runner=FakeRunner(),
            )

    def test_rejects_over_10mb(self, tmp_path):
        big = PNG + b"0" * (10 * 1024 * 1024)
        with pytest.raises(SystemExit, match="10 MB"):
            ra.upload_image(self._file(tmp_path, big), issue=1, runner=FakeRunner())

    def test_permission_denied_explains_how_to_get_access(self, tmp_path):
        runner = FakeRunner(
            returncode=1,
            stderr="ERROR: (gcloud.storage.cp) HTTPError 403: dev@example.com does "
            "not have storage.objects.create access to the Google Cloud Storage object.",
        )
        with pytest.raises(SystemExit) as exc:
            ra.upload_image(self._file(tmp_path, JPEG, "a.jpg"), issue=1, runner=runner)
        message = str(exc.value)
        assert "roles/storage.objectCreator" in message
        assert "dev@example.com" in message
        assert "gs://duotopia-audio" in message


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


class TestCli:
    def test_commit_message_starting_with_dash_is_a_value(self):
        """workflow_dispatch 的標題是自由文字，可能以 - 開頭"""
        args = ra.build_parser().parse_args(
            [
                "ci-payload",
                "--environment=staging",
                "--sha=abc",
                "--branch=staging",
                "--commit-message=- hotfix (Fixes #1)",
            ]
        )
        assert args.commit_message == "- hotfix (Fixes #1)"


class TestReleaseScan:
    def test_mistyped_issue_is_reported_not_fatal(self):
        """某個 commit 打錯 issue 編號，/announce release 不能整個中止"""
        gh = FakeGitHub(
            labels={1046: BOTH},
            comments={1046: [ra.render_block(CONTENT)]},
            missing={99999},
        )
        rows = ra.scan_release(
            gh,
            [
                "Release: 班級分組 (Fixes #1046) (#1053)",
                "feat(#99999): 打錯編號",
            ],
        )
        by_issue = {row["issue"]: row for row in rows}
        assert by_issue[1046]["eligible"] is True
        assert by_issue[1046]["content"] == CONTENT
        assert by_issue[99999]["eligible"] is False
        assert by_issue[99999]["reason"] == ra.REASON_NOT_FOUND
        assert "99999" in by_issue[99999]["message"]

    def test_lists_ineligible_issues_with_reason(self):
        gh = FakeGitHub(labels={1051: [ra.LABEL_ANNOUNCE]})
        (row,) = ra.scan_release(gh, ["Release: 例句 (Fixes #1051) (#1058)"])
        assert row["eligible"] is False
        assert row["reason"] == ra.REASON_NOT_TESTED
        assert row["content"] is None


class TestLoadContent:
    def _write(self, tmp_path, data):
        path = tmp_path / "content.json"
        path.write_text(__import__("json").dumps(data), encoding="utf-8")
        return str(path)

    def test_non_string_value_gives_clear_error(self, tmp_path):
        path = self._write(tmp_path, {**CONTENT, "line_message_en": ["a", "b"]})
        with pytest.raises(SystemExit, match="line_message_en"):
            ra._load_content(path)

    def test_null_value_is_allowed(self, tmp_path):
        path = self._write(tmp_path, {**CONTENT, "article_body_en": None})
        assert ra._load_content(path)["article_body_en"] is None


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
        "author_association": "COLLABORATOR",
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

    def test_block_without_issue_marker_uses_pr_commits(self):
        """有人把 issues 標記刪掉時，改從 PR 的 commit 找 issue，而不是直接略過"""
        pr = {**self.RELEASE_PR, "body": ra.render_block(CONTENT)}
        gh = FakeGitHub(
            commit_prs={"merge-sha": [pr]},
            pr_commits={1072: ["Release: 班級分組 (Fixes #1046) (#1053)"]},
            labels={1046: BOTH},
        )
        result = self._payload(gh)
        assert result["content"] == CONTENT
        assert result["issue_numbers"] == "1046"

    def test_pr_from_outside_contributor_ignores_block(self):
        """release PR 作者不是團隊成員 → 不採用描述內容，改走標籤 + Vertex"""
        pr = {
            **self.RELEASE_PR,
            "body": ra.render_block(CONTENT, issues=[1046]),
            "author_association": "CONTRIBUTOR",
        }
        gh = FakeGitHub(
            commit_prs={"merge-sha": [pr]},
            pr_commits={1072: ["Release: 班級分組 (Fixes #1046) (#1053)"]},
            labels={1046: BOTH},
        )
        result = self._payload(gh)
        assert "content" not in result
        assert result["issue_numbers"] == "1046"

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
            "author_association": "OWNER",
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
