"""scripts/company-repair-prod.sh builds a safe container command line.

A stub stands in for `docker compose` and records its argv, so the test proves
what would run: fixed container paths, read-only mounts, spaces intact, and no
secret value on the command line.
"""
import json
import os
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "company-repair-prod.sh")


class ProdWrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "with spaces")
        os.makedirs(os.path.join(self.root, "bundle dir"))
        open(os.path.join(self.root, "bundle dir", "manifest.json"), "w").write("{}")
        os.makedirs(os.path.join(self.root, "plan dir"))
        open(os.path.join(self.root, "plan dir", "plan.json"), "w").write("{}")
        self.record = os.path.join(self.tmp.name, "argv.json")
        self.stub = os.path.join(self.tmp.name, "fake-compose")
        with open(self.stub, "w") as f:
            f.write(
                "#!/usr/bin/env python3\nimport json, os, sys\n"
                f"json.dump({{'argv': sys.argv[1:], 'target': os.environ.get('REPAIR_TARGET_ID')}}, open({self.record!r}, 'w'))\n"
            )
        os.chmod(self.stub, os.stat(self.stub).st_mode | stat.S_IEXEC)

    def tearDown(self):
        self.tmp.cleanup()

    def run_wrapper(self, **env):
        base = {"PATH": os.environ["PATH"], "COMPOSE_STACK": f"{self.stub} -f compose.yml"}
        base.update(env)
        proc = subprocess.run(["bash", SCRIPT], env=base, capture_output=True, text=True)
        return proc, (json.load(open(self.record)) if os.path.exists(self.record) else None)

    def test_mounts_read_only_at_fixed_paths_with_spaces_intact(self):
        out = os.path.join(self.root, "out dir")
        proc, rec = self.run_wrapper(
            MODE="apply",
            SNAPSHOT=os.path.join(self.root, "bundle dir"),
            PLAN=os.path.join(self.root, "plan dir", "plan.json"),
            OUT=out,
            EXPECT_DB="fp",
            CONFIRM="yes",
            REPAIR_TARGET_ID="secret-target-id-123",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        argv = rec["argv"]
        self.assertEqual(argv[:3], ["-f", "compose.yml", "run"])
        self.assertIn("--no-deps", argv)
        self.assertIn(f"{os.path.realpath(os.path.join(self.root, 'bundle dir'))}:/repair/source:ro", argv)
        self.assertIn(f"{os.path.realpath(os.path.join(self.root, 'plan dir'))}:/repair/plan:ro", argv)
        self.assertIn(f"{os.path.realpath(out)}:/repair/out", argv)
        tail = argv[argv.index("apps/jobs/dist/company-match-repair.js") + 1 :]
        self.assertEqual(
            tail,
            ["apply", "--snapshot", "/repair/source", "--plan", "/repair/plan/plan.json", "--out", "/repair/out", "--expect-db", "fp", "--confirm", "yes"],
        )
        # The secret travels by name only.
        self.assertIn("REPAIR_TARGET_ID", argv)
        self.assertNotIn("secret-target-id-123", " ".join(argv))
        self.assertEqual(rec["target"], "secret-target-id-123")
        self.assertEqual(stat.S_IMODE(os.stat(out).st_mode), 0o700)

    def test_fix_prod_is_audit_only_and_rejects_unknown_modes(self):
        proc, _ = self.run_wrapper(MODE="delete-everything")
        self.assertEqual(proc.returncode, 2)
        proc, rec = self.run_wrapper(MODE="audit", SNAPSHOT=os.path.join(self.root, "bundle dir"), OUT=os.path.join(self.root, "o"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(rec["argv"][rec["argv"].index("apps/jobs/dist/company-match-repair.js") + 1], "audit")

    def test_refuses_a_directory_that_is_not_a_bundle(self):
        proc, rec = self.run_wrapper(MODE="audit", SNAPSHOT=self.root, OUT=os.path.join(self.root, "o"))
        self.assertEqual(proc.returncode, 2)
        self.assertIsNone(rec)


if __name__ == "__main__":
    unittest.main()
