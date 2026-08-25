"""院内スタッフのメール名簿を Cloudflare KV に同期する。

名簿は個人情報なので、リポジトリの外に置く（既定: ~/kizu-translate-staff.txt）。
~/kizu-translate 自体が git リポジトリなので、その中には置かない。
.gitignore に頼るのではなく最初から git の管理外に置くことで、うっかりコミット
される経路自体をなくしている。場所は STAFF_LIST_PATH で変更できる。

名簿の書式 — 1行に1アドレス、カンマ以降は自由なメモ:

    # KIZUカイロプラクティック スタッフ
    kizuchiro7@gmail.com,院長
    staff@example.com,受付

使い方:
    python sync_staff.py              # 確認のみ（何が変わるか表示）
    python sync_staff.py --apply      # 実際にKVへ反映
    python sync_staff.py --report     # 誰がいつログインしたか
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parent

DEFAULT_LIST = Path.home() / "kizu-translate-staff.txt"
STAFF_LIST_PATH = Path(os.getenv("STAFF_LIST_PATH", DEFAULT_LIST))

KV_BINDING = "AUTH"
STAFF_PREFIX = "staff:"
SEEN_PREFIX = "seen:"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def run_wrangler(args, capture=True):
    result = subprocess.run(
        ["npx", "wrangler", *args],
        cwd=WORKER_DIR,
        capture_output=capture,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout or "", file=sys.stderr)
        print(result.stderr or "", file=sys.stderr)
        raise RuntimeError(f"wrangler {' '.join(args)} failed")
    return result.stdout


def kv_list(prefix):
    """Returns the list of KV keys under a prefix."""
    out = run_wrangler(
        ["kv", "key", "list", "--binding", KV_BINDING, "--prefix", prefix, "--remote"]
    )
    start = out.find("[")
    if start == -1:
        return []
    return [item["name"] for item in json.loads(out[start:])]


def kv_get(key):
    out = run_wrangler(["kv", "key", "get", key, "--binding", KV_BINDING, "--remote"])
    return out.strip()


def read_roster():
    if not STAFF_LIST_PATH.exists():
        sys.exit(
            f"名簿ファイルが見つかりません: {STAFF_LIST_PATH}\n"
            "1行に1つメールアドレスを書いたファイルを作成するか、"
            "STAFF_LIST_PATH で場所を指定してください。"
        )

    entries = {}
    problems = []
    for lineno, raw in enumerate(STAFF_LIST_PATH.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        email, _, note = line.partition(",")
        email = email.strip().lower()
        if not EMAIL_RE.match(email):
            problems.append(f"  {lineno}行目: {raw!r}")
            continue
        entries[email] = note.strip()

    if problems:
        print("⚠️  メールアドレスとして読めない行がありました（スキップします）:")
        print("\n".join(problems))
        print()

    return entries


def sync(apply_changes):
    roster = read_roster()
    existing = {k[len(STAFF_PREFIX):] for k in kv_list(STAFF_PREFIX)}

    to_add = sorted(set(roster) - existing)
    to_remove = sorted(existing - set(roster))
    unchanged = len(set(roster) & existing)

    print(f"名簿ファイル : {STAFF_LIST_PATH}  ({len(roster)}件)")
    print(f"KV上の登録   : {len(existing)}件")
    print(f"変更なし     : {unchanged}件")
    print()
    for email in to_add:
        print(f"  + 追加: {email}")
    for email in to_remove:
        print(f"  - 削除: {email}")
    if not to_add and not to_remove:
        print("  変更はありません。")
        return

    if not apply_changes:
        print()
        print("※ これは確認表示です。実際に反映するには --apply を付けて実行してください。")
        return

    # The temp file contains every address, so keep it out of the repo and
    # always remove it.
    if to_add:
        payload = [
            {
                "key": f"{STAFF_PREFIX}{email}",
                "value": json.dumps(
                    {"addedAt": __import__("datetime").date.today().isoformat(),
                     "note": roster[email]},
                    ensure_ascii=False,
                ),
            }
            for email in to_add
        ]
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        try:
            json.dump(payload, tmp, ensure_ascii=False)
            tmp.close()
            run_wrangler(["kv", "bulk", "put", tmp.name, "--binding", KV_BINDING, "--remote"])
            print(f"✅ {len(to_add)}件を追加しました。")
        finally:
            os.unlink(tmp.name)

    if to_remove:
        keys = [f"{STAFF_PREFIX}{email}" for email in to_remove]
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        try:
            json.dump(keys, tmp, ensure_ascii=False)
            tmp.close()
            run_wrangler(
                ["kv", "bulk", "delete", tmp.name, "--binding", KV_BINDING, "--remote", "--force"]
            )
            print(f"✅ {len(to_remove)}件を削除しました。")
        finally:
            os.unlink(tmp.name)

    print()
    print("※ 削除した方は新たにログインできなくなりますが、すでにログイン済みの端末は")
    print("   最大30日間そのまま使えます。即時に全員を締め出す必要がある場合は、")
    print("   wrangler.toml の SESSION_VERSION を +1 して再デプロイしてください。")


def report():
    keys = kv_list(SEEN_PREFIX)
    if not keys:
        print("まだ誰もログインしていません。")
        return

    rows = []
    for key in keys:
        email = key[len(SEEN_PREFIX):]
        try:
            data = json.loads(kv_get(key))
        except Exception:
            data = {}
        rows.append((data.get("last", ""), email, data.get("count", 0)))

    rows.sort(reverse=True)
    print(f"{'最終ログイン':<26}{'メールアドレス':<40}回数")
    print("-" * 76)
    for last, email, count in rows:
        print(f"{last:<26}{email:<40}{count}")
    print()
    print(f"合計 {len(rows)}名が利用しています。")


def main():
    parser = argparse.ArgumentParser(description="院内スタッフの名簿をCloudflare KVに同期します")
    parser.add_argument("--apply", action="store_true", help="実際に反映する（省略時は確認のみ）")
    parser.add_argument("--report", action="store_true", help="利用状況を表示する")
    args = parser.parse_args()

    if args.report:
        report()
    else:
        sync(args.apply)


if __name__ == "__main__":
    main()
