"""Tests for scripts/check_publish.py, run against throwaway git repositories.

The denylist terms here are dummies; the real list is private. Fake secrets
are assembled at runtime so no real-looking token is ever committed.
"""

import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("check_publish", ROOT / "scripts" / "check_publish.py")
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

NOREPLY = "12345+someone@users.noreply.github.com"
DENYLIST = guard.parse_denylist([
    "# dummy terms",
    "Acme Pharma",
    r"re:\bPROJ-\d+\b",
    r"re:(?-i:\bXYZ\b)",
])


class TempRepo:
    def __init__(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", NOREPLY)
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args, env=None):
        return subprocess.run(
            ["git", "-C", str(self.path), *args], check=True, capture_output=True, text=True, env=env,
        ).stdout.strip()

    def commit(self, files, message="Update site", email=NOREPLY, committer=None):
        for name, content in files.items():
            target = self.path / name
            if content is None:
                target.unlink()
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content if isinstance(content, bytes) else content.encode())
        self.git("add", "-A")
        env = {**os.environ, "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_EMAIL": committer or email}
        self.git("commit", "-q", "-m", message, env=env)
        return self.git("rev-parse", "HEAD")

    def problems(self, sha):
        return guard.check_commit(self.path, sha, DENYLIST)

    def make_remote(self):
        """A bare repository standing in for GitHub."""
        self.remote_dir = tempfile.TemporaryDirectory()
        subprocess.run(["git", "init", "-q", "--bare", self.remote_dir.name], check=True)
        return self.remote_dir.name

    def publish(self, remote, sha, branch):
        self.git("push", "-q", remote, f"{sha}:refs/heads/{branch}")


class PublishGuardTest(unittest.TestCase):
    def setUp(self):
        self.repo = TempRepo()
        self.addCleanup(self.repo.dir.cleanup)

    def assertBlocked(self, problems, fragment):
        self.assertTrue(any(fragment in p for p in problems), f"expected '{fragment}' in {problems}")

    def test_clean_commit_passes(self):
        sha = self.repo.commit({"index.html": "<p>Radiology and radiotherapy AI.</p>\n"})
        self.assertEqual(self.repo.problems(sha), [])

    def test_denylisted_term_in_content_is_blocked(self):
        sha = self.repo.commit({"index.html": "<p>Work with ACME pharma.</p>\n"})
        self.assertBlocked(self.repo.problems(sha), "denylisted term 'Acme Pharma'")

    def test_term_removed_later_is_still_blocked_in_history(self):
        first = self.repo.commit({"index.html": "<p>PROJ-42 results</p>\n"})
        second = self.repo.commit({"index.html": "<p>Results</p>\n"}, message="Tidy wording")
        self.assertBlocked(self.repo.problems(first), "denylisted term")
        self.assertEqual(self.repo.problems(second), [])

    def test_term_in_commit_message_is_blocked(self):
        sha = self.repo.commit({"index.html": "<p>Hello</p>\n"}, message="Remove Acme Pharma mention")
        self.assertBlocked(self.repo.problems(sha), "commit message")

    def test_term_in_file_name_is_blocked(self):
        sha = self.repo.commit({"PROJ-7-notes.md": "notes\n"})
        self.assertBlocked(self.repo.problems(sha), "file name")

    def test_case_sensitive_regex_is_respected(self):
        ok = self.repo.commit({"index.html": "<p>xyz is lowercase</p>\n"})
        self.assertEqual(self.repo.problems(ok), [])
        bad = self.repo.commit({"index.html": "<p>XYZ is uppercase</p>\n"})
        self.assertBlocked(self.repo.problems(bad), "denylisted term")

    def test_personal_email_is_blocked(self):
        sha = self.repo.commit({"index.html": "<p>Hi</p>\n"}, email="someone@example.com")
        self.assertBlocked(self.repo.problems(sha), "not a GitHub no-reply address")

    def test_unneeded_file_type_is_blocked(self):
        sha = self.repo.commit({"cv.pdf": b"%PDF-1.7 fake"})
        self.assertBlocked(self.repo.problems(sha), "not a file type this site needs")

    def test_crawler_files_are_allowed(self):
        sha = self.repo.commit({
            "robots.txt": "User-agent: *\nAllow: /\n",
            "sitemap.xml": "<?xml version=\"1.0\"?><urlset></urlset>\n",
            "llms.txt": "# Name\n",
        })
        self.assertEqual(self.repo.problems(sha), [])

    def test_secret_is_blocked_without_echoing_it(self):
        token = "ghp" + "_" + "a1B2" * 9
        sha = self.repo.commit({"assets/site.js": f"const key = '{token}';\n"})
        problems = self.repo.problems(sha)
        self.assertBlocked(problems, "looks like a GitHub token")
        self.assertFalse(any(token in p for p in problems), "the secret must not be printed")

    @unittest.skipUnless(shutil.which("exiftool"), "exiftool not installed")
    def test_image_with_location_is_blocked_and_clean_image_passes(self):
        clean = (ROOT / "assets" / "og.jpg").read_bytes()
        ok = self.repo.commit({"assets/card.jpg": clean})
        self.assertEqual(self.repo.problems(ok), [])

        located = self.repo.path / "assets" / "located.jpg"
        located.write_bytes(clean)
        subprocess.run(
            ["exiftool", "-q", "-overwrite_original", "-GPSLatitude=52.2", "-GPSLatitudeRef=N", str(located)],
            check=True,
        )
        bad = self.repo.commit({})
        self.assertBlocked(self.repo.problems(bad), "image metadata can identify location")

    def test_github_web_merge_committer_is_allowed(self):
        sha = self.repo.commit({"index.html": "<p>Hi</p>\n"}, committer="noreply@github.com")
        self.assertEqual(self.repo.problems(sha), [])

    def test_commits_already_on_any_remote_branch_are_skipped(self):
        remote = self.repo.make_remote()
        self.addCleanup(self.repo.remote_dir.cleanup)
        base = self.repo.commit({"index.html": "<p>v1</p>\n"})
        self.repo.publish(remote, base, "feature")
        published = self.repo.commit({"index.html": "<p>v2 on main</p>\n"})
        self.repo.publish(remote, published, "main")
        self.repo.git("checkout", "-q", "-b", "feature", base)
        new = self.repo.commit({"notes.md": "feature work\n"})
        self.repo.git("merge", "-q", "--no-edit", "main")
        merge = self.repo.git("rev-parse", "HEAD")
        lines = [f"refs/heads/feature {merge} refs/heads/feature {base}"]
        found = guard.commits_from_pre_push(self.repo.path, remote, lines)
        self.assertEqual(set(found), {new, merge})

    def test_stale_local_tracking_ref_is_not_trusted(self):
        remote = self.repo.make_remote()
        self.addCleanup(self.repo.remote_dir.cleanup)
        base = self.repo.commit({"index.html": "<p>v1</p>\n"})
        self.repo.publish(remote, base, "main")
        unpublished = self.repo.commit({"index.html": "<p>draft</p>\n"})
        # A local ref claims the remote has this commit, but it does not.
        self.repo.git("update-ref", "refs/remotes/origin/wip", unpublished)
        lines = [f"refs/heads/main {unpublished} refs/heads/main {base}"]
        self.assertEqual(guard.commits_from_pre_push(self.repo.path, remote, lines), [unpublished])

    def test_unreachable_destination_checks_more_not_less(self):
        first = self.repo.commit({"index.html": "<p>v1</p>\n"})
        second = self.repo.commit({"index.html": "<p>v2</p>\n"})
        lines = [f"refs/heads/main {second} refs/heads/main {guard.ZERO_SHA}"]
        found = guard.commits_from_pre_push(self.repo.path, "/nonexistent/remote.git", lines)
        self.assertEqual(set(found), {first, second})

    def test_pre_push_input_selects_only_unpublished_commits(self):
        remote = self.repo.make_remote()
        self.addCleanup(self.repo.remote_dir.cleanup)
        published = self.repo.commit({"index.html": "<p>v1</p>\n"})
        self.repo.publish(remote, published, "main")
        new = self.repo.commit({"index.html": "<p>v2</p>\n"})
        lines = [f"refs/heads/main {new} refs/heads/main {published}"]
        self.assertEqual(guard.commits_from_pre_push(self.repo.path, remote, lines), [new])

    def test_pre_push_branch_deletion_checks_nothing(self):
        sha = self.repo.commit({"index.html": "<p>v1</p>\n"})
        lines = [f"(delete) {guard.ZERO_SHA} refs/heads/old {sha}"]
        self.assertEqual(guard.commits_from_pre_push(self.repo.path, None, lines), [])


if __name__ == "__main__":
    unittest.main()
