#!/usr/bin/env python3
"""Pre-push guard for this public repository.

Everything pushed here is public, history included, so this checks every
commit about to be pushed (not just the final files) and refuses the push if
it finds:

  - a term from the private denylist (confidential names, unreleased plans,
    personal contact details) in added lines, file names or commit messages
  - something that looks like a secret (API keys, tokens, private keys)
  - a commit author or committer email that is not a GitHub no-reply address
  - a file type a static website does not need (PDFs, documents, env files)
  - an image carrying location or camera-identifying metadata

The denylist lives outside this repo so the list itself is never published.
Point to it once per clone:

    git config siteguard.denylist /path/to/denylist.txt

It runs automatically from .githooks/pre-push. To check by hand:

    python3 scripts/check_publish.py --range origin/main..HEAD
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ZERO_SHA = "0" * 40
DEFAULT_DENYLIST = Path.home() / ".config" / "site-guard" / "denylist.txt"

# Personal no-reply addresses, plus the address GitHub commits web merges with.
NOREPLY_EMAIL = re.compile(r"^((\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com|noreply@github\.com)$")

ALLOWED_SUFFIXES = {
    ".html", ".css", ".js", ".json", ".svg", ".jpg", ".jpeg", ".png", ".webp",
    ".ico", ".woff2", ".txt", ".md", ".py", ".yml", ".xml",
}
ALLOWED_NAMES = {"LICENSE", ".gitignore", ".nojekyll", "pre-push", "CNAME"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic"}

# Image tags that can locate a photo or identify the camera or its owner.
IDENTIFYING_TAGS = re.compile(
    r"^(GPS.*|Make|Model|SerialNumber|BodySerialNumber|LensSerialNumber|"
    r"InternalSerialNumber|CameraSerialNumber|OwnerName|CameraOwnerName)$"
)

SECRETS = [
    ("GitHub token", re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}")),
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("hard-coded credential", re.compile(
        r"(?i)\b(api[_-]?key|secret|password|access[_-]?token)\b\s*[:=]\s*['\"][^'\"\s]{16,}['\"]")),
]


def git(repo, *args, binary=False):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True)
    return result.stdout if binary else result.stdout.decode("utf-8", "replace")


def parse_denylist(lines):
    """Plain lines match case-insensitively; lines starting with "re:" are regexes."""
    terms = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("re:"):
            terms.append((line[3:], re.compile(line[3:], re.IGNORECASE)))
        else:
            terms.append((line, re.compile(re.escape(line), re.IGNORECASE)))
    return terms


def load_denylist(repo):
    configured = subprocess.run(
        ["git", "-C", str(repo), "config", "--get", "siteguard.denylist"],
        capture_output=True, text=True,
    ).stdout.strip()
    path = Path(configured).expanduser() if configured else DEFAULT_DENYLIST
    if not path.is_file():
        raise SystemExit(
            f"publish guard: no denylist at {path}.\n"
            "Refusing to push without it. Set it with:\n"
            "  git config siteguard.denylist /path/to/denylist.txt"
        )
    return parse_denylist(path.read_text(encoding="utf-8").splitlines())


def scan(where, text, denylist):
    """Denylisted terms and secrets in `text`. Secrets are never echoed back."""
    problems = []
    for term, pattern in denylist:
        if pattern.search(text):
            problems.append(f"{where}: contains denylisted term '{term}'")
    for label, pattern in SECRETS:
        if pattern.search(text):
            problems.append(f"{where}: looks like a {label}")
    return problems


def check_image(repo, sha, path):
    if not shutil.which("exiftool"):
        return [f"{sha[:7]} {path}: exiftool is not installed, so image metadata cannot be checked"]
    data = git(repo, "show", f"{sha}:{path}", binary=True)
    with tempfile.NamedTemporaryFile(suffix=Path(path).suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        out = subprocess.run(["exiftool", "-json", "-n", tmp.name], capture_output=True, text=True)
    try:
        tags = json.loads(out.stdout)[0]
    except (json.JSONDecodeError, IndexError):
        return [f"{sha[:7]} {path}: could not read image metadata"]
    found = sorted(tag for tag in tags if IDENTIFYING_TAGS.match(tag))
    if found:
        return [f"{sha[:7]} {path}: image metadata can identify location or device ({', '.join(found)})"]
    return []


def check_commit(repo, sha, denylist):
    short = sha[:7]
    problems = []

    author, committer = git(repo, "log", "-1", "--format=%ae%n%ce", sha).split("\n")[:2]
    for role, email in (("author", author), ("committer", committer)):
        if not NOREPLY_EMAIL.match(email):
            problems.append(f"{short}: {role} email {email} is not a GitHub no-reply address")

    problems += scan(f"{short} commit message", git(repo, "log", "-1", "--format=%B", sha), denylist)

    for line in git(repo, "show", "--format=", "--name-status", "--no-renames", sha).splitlines():
        status, path = line.split("\t", 1)
        problems += scan(f"{short} file name {path}", path, denylist)
        if status.startswith("D"):
            continue
        suffix = Path(path).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES and Path(path).name not in ALLOWED_NAMES:
            problems.append(f"{short} {path}: not a file type this site needs")
        if suffix in IMAGE_SUFFIXES:
            problems += check_image(repo, sha, path)

    # Added lines only; binary files show as "Binary files differ" and are skipped.
    current = None
    for line in git(repo, "show", "--format=", "--unified=0", "--no-color", "--no-ext-diff", sha).splitlines():
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else line[4:]
        elif line.startswith("+") and current:
            problems += scan(f"{short} {current}", line[1:], denylist)
    return problems


def published_commits(repo, destination):
    """Commit ids the destination already has, asked of the destination itself.

    Local remote-tracking refs are not trusted: they can be stale, or belong
    to a different repository than the one being pushed to. Returns None if
    the destination cannot be listed.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "ls-remote", destination],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        return None
    if out.returncode != 0:
        return None
    return {line.split()[0] for line in out.stdout.splitlines() if line.strip()}


def exists_locally(repo, sha):
    return subprocess.run(
        ["git", "-C", str(repo), "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True,
    ).returncode == 0


def commits_from_pre_push(repo, destination, lines):
    """Commits a push would publish, from the refs git passes on stdin.

    Skips commits the destination already has (they are public already). If
    the destination cannot be listed, only the target branch's current tip is
    skipped, so more is checked rather than less.
    """
    published = published_commits(repo, destination) if destination else None
    if published is None:
        print("publish guard: could not list the destination; checking more commits than usual",
              file=sys.stderr)
    shas = []
    for line in lines:
        parts = line.split()
        if len(parts) != 4:
            continue
        _, local_sha, _, remote_sha = parts
        if local_sha == ZERO_SHA:
            continue  # deleting a remote branch publishes nothing
        known = set(published or ())
        if remote_sha != ZERO_SHA:
            known.add(remote_sha)
        exclude = sorted(sha for sha in known if exists_locally(repo, sha))
        shas += git(repo, "rev-list", local_sha, "--not", *exclude).split() if exclude else \
            git(repo, "rev-list", local_sha).split()
    return list(dict.fromkeys(shas))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("remote", nargs="?", help="remote name (passed by git)")
    parser.add_argument("url", nargs="?", help="the URL being pushed to (passed by git)")
    parser.add_argument("--range", help="check the commits in A..B instead of reading pre-push input")
    args = parser.parse_args()

    repo = Path(git(".", "rev-parse", "--show-toplevel").strip())
    denylist = load_denylist(repo)
    if args.range:
        shas = git(repo, "rev-list", args.range).split()
    else:
        shas = commits_from_pre_push(repo, args.url or args.remote, sys.stdin.read().splitlines())

    problems = [p for sha in shas for p in check_commit(repo, sha, denylist)]
    if problems:
        print(f"publish guard: blocked. {len(problems)} problem(s) in {len(shas)} commit(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print("Fix them (rewriting history if a bad commit is already local), then push again.", file=sys.stderr)
        return 1
    print(f"publish guard: {len(shas)} commit(s) checked, nothing confidential found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
