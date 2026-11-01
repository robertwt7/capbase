"""Unit tests for scripts/prepare-company-repair-snapshot.py (stdlib unittest).

Run: python3 -m unittest discover -s scripts/tests
Synthetic fixtures only — no licensed data is checked in.
"""
import gzip
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("prep", os.path.join(HERE, "..", "prepare-company-repair-snapshot.py"))
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)  # type: ignore[union-attr]

COMPANY_COLS = "company_id, name, country, city, website, industry, verticals, about, status"
DEAL_COLS = "deal_id, company_id, deal_date, stage, status, currency, size_local, size_usd"
FIRM_COLS = (
    "firm_id, name, role, manager_firm_type, lp_firm_type, country, city, website, "
    "year_established, about, aum_usd, vc_fund_share, deal_count"
)


def stage_sql(companies=None, deals=None, extra_blocks="", deal_investors=None, firms=None):
    companies = companies if companies is not None else [
        "155553\tIndigo Ag, Inc.\tUS\tBoston\thttps://www.indigoag.com\tAgribusiness\t\\N\tSustainable agriculture.\tActive",
        "723159\tIndigo\tUS\tNew York\tuseindigo.com\tReal Estate\tPropTech;AI\tLine one\\nline two\\twith a tab \\\\ and caf\\303\\251\tActive",
        "787691\tIndigo\tUS\tMiami\tgetindigo.com\tInsurance\t\\N\t\\N\tActive",
    ]
    deals = deals if deals is not None else [
        "V407056\t723159\t2025-01-23\tSeed\tCompleted\tUSD\t8000000\t8000000",
        "V444915\t787691\t2026-01-29\tSeries B\tCompleted\tUSD\t50000000.00\t50000000.00",
        "V1\t155553\t\\N\tSeries A\tCompleted\tUSD\t\\N\t\\N",
    ]
    deal_investors = deal_investors if deal_investors is not None else ["V407056\t501", "V444915\t502"]
    firms = firms if firms is not None else [
        "501\tGranite Peak\tmanager\tVenture Capital\t\\N\tNO\tOslo\tx.no\t2001\tProse here\t1000000\t0.9\t3",
    ]
    def block(name, cols, rows):
        return f"COPY partner_stage.{name} ({cols}) FROM stdin;\n" + "".join(r + "\n" for r in rows) + "\\.\n\n"
    return (
        "--\n-- dump\n--\nSET client_encoding = 'UTF8';\n\n"
        + block("person", "contact_id, firm_id, name, job_title, email, phone, linkedin", ["c1\t501\tJane Doe\tCEO\tjane@example.com\t+1\t\\N"])
        + block("company", COMPANY_COLS, companies)
        + block("deal", DEAL_COLS, deals)
        + block("deal_investor", "deal_id, firm_id", deal_investors)
        + block("firm", FIRM_COLS, firms)
        + extra_blocks
    )


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text, name="stage.sql.gz"):
        path = os.path.join(self.dir, name)
        data = text.encode("utf-8")
        if name.endswith(".gz"):
            with gzip.GzipFile(path, "wb", mtime=0) as f:
                f.write(data)
        else:
            with open(path, "wb") as f:
                f.write(data)
        return path

    def run_prep(self, src, out_name="out", *extra):
        out = os.path.join(self.dir, out_name)
        code = prep.main(["--input", src, "--out", out, *extra])
        return code, out

    def lines(self, out, table):
        with open(os.path.join(out, f"{table}.ndjson"), encoding="utf-8") as f:
            return [json.loads(l) for l in f]

    def test_extracts_the_three_indigo_identities_with_copy_escapes(self):
        code, out = self.run_prep(self.write(stage_sql()))
        self.assertEqual(code, 0)
        companies = {c["company_id"]: c for c in self.lines(out, "company")}
        self.assertEqual(sorted(companies), ["155553", "723159", "787691"])
        self.assertEqual(companies["723159"]["about"], "Line one\nline two\twith a tab \\ and café")
        self.assertIsNone(companies["155553"]["verticals"])
        deals = {d["deal_id"]: d for d in self.lines(out, "deal")}
        self.assertEqual(deals["V444915"]["size_usd"], 50000000)
        self.assertIsNone(deals["V1"]["deal_date"])

    def test_never_writes_people_or_firm_prose(self):
        _, out = self.run_prep(self.write(stage_sql()))
        everything = "".join(open(os.path.join(out, f)).read() for f in os.listdir(out))
        self.assertNotIn("jane@example.com", everything)
        self.assertNotIn("Jane Doe", everything)
        self.assertNotIn("Prose here", everything)
        self.assertEqual(sorted(self.lines(out, "firm")[0]), ["firm_id", "lp_firm_type", "manager_firm_type", "name", "role"])

    def test_is_deterministic_and_order_independent(self):
        _, a = self.run_prep(self.write(stage_sql(), "a.sql.gz"), "a")
        shuffled = stage_sql(deals=[
            "V1\t155553\t\\N\tSeries A\tCompleted\tUSD\t\\N\t\\N",
            "V444915\t787691\t2026-01-29\tSeries B\tCompleted\tUSD\t50000000.00\t50000000.00",
            "V407056\t723159\t2025-01-23\tSeed\tCompleted\tUSD\t8000000\t8000000",
        ])
        _, b = self.run_prep(self.write(shuffled, "b.sql"), "b")
        ma, mb = (json.load(open(os.path.join(d, "manifest.json"))) for d in (a, b))
        self.assertEqual(ma["bundleSha256"], mb["bundleSha256"])
        self.assertEqual(open(os.path.join(a, "deal.ndjson")).read(), open(os.path.join(b, "deal.ndjson")).read())
        # And a second run over the same file is byte-identical, manifest included.
        _, c = self.run_prep(self.write(stage_sql(), "c.sql.gz"), "c")
        ma.pop("createdFrom"); mc = json.load(open(os.path.join(c, "manifest.json"))); mc.pop("createdFrom")
        self.assertEqual(ma, mc)

    def test_counts_and_hashes_match_the_files(self):
        _, out = self.run_prep(self.write(stage_sql()))
        m = json.load(open(os.path.join(out, "manifest.json")))
        self.assertEqual(m["tables"]["company"]["rows"], 3)
        import hashlib
        self.assertEqual(
            m["tables"]["deal"]["sha256"],
            hashlib.sha256(open(os.path.join(out, "deal.ndjson"), "rb").read()).hexdigest(),
        )

    def test_rejects_a_wrong_field_count(self):
        bad = stage_sql(deals=["V1\t155553\t2025-01-01\tSeed"])
        code, out = self.run_prep(self.write(bad))
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(out))
        self.assertEqual([f for f in os.listdir(self.dir) if f.startswith(".bundle-partial")], [])

    def test_rejects_a_truncated_block(self):
        text = stage_sql()
        cut = text[: text.index("COPY partner_stage.deal_investor")]
        cut = cut[: cut.rindex("\\.")]  # drop the deal terminator
        code, _ = self.run_prep(self.write(cut, "t.sql"))
        self.assertEqual(code, 1)

    def test_rejects_a_corrupt_gzip(self):
        path = self.write(stage_sql())
        data = bytearray(open(path, "rb").read())
        data[len(data) // 2] ^= 0xFF
        open(path, "wb").write(bytes(data))
        code, _ = self.run_prep(path)
        self.assertEqual(code, 1)

    def test_rejects_conflicting_duplicates_but_tolerates_identical_ones(self):
        dup = "787691\tIndigo\tUS\tMiami\tgetindigo.com\tInsurance\t\\N\t\\N\tActive"
        rows = [
            "155553\tIndigo Ag, Inc.\tUS\tBoston\tindigoag.com\tAgribusiness\t\\N\t\\N\tActive",
            dup,
            dup,
        ]
        code, out = self.run_prep(self.write(stage_sql(companies=rows)))
        self.assertEqual(code, 0)
        self.assertEqual(json.load(open(os.path.join(out, "manifest.json")))["tables"]["company"]["identicalDuplicates"], 1)
        rows[2] = dup.replace("Miami", "Tampa")
        code, _ = self.run_prep(self.write(stage_sql(companies=rows), "x.sql.gz"), "x")
        self.assertEqual(code, 1)

    def test_rejects_an_unknown_layout(self):
        text = stage_sql().replace(f"({DEAL_COLS})", "(deal_id, company_id, deal_date)")
        code, _ = self.run_prep(self.write(text))
        self.assertEqual(code, 1)

    def test_rejects_a_missing_table(self):
        text = stage_sql()
        text = text[: text.index("COPY partner_stage.firm")]
        code, _ = self.run_prep(self.write(text))
        self.assertEqual(code, 1)

    def test_rejects_an_unexpected_input_hash(self):
        code, _ = self.run_prep(self.write(stage_sql()), "out", "--expect-sha256", "0" * 64)
        self.assertEqual(code, 1)

    def test_refuses_to_overwrite_a_directory_that_is_not_a_bundle(self):
        out = os.path.join(self.dir, "precious")
        os.makedirs(out)
        open(os.path.join(out, "notes.txt"), "w").write("keep me")
        code = prep.main(["--input", self.write(stage_sql()), "--out", out])
        self.assertEqual(code, 1)
        self.assertTrue(os.path.exists(os.path.join(out, "notes.txt")))

    def test_decode_field_edge_cases(self):
        self.assertIsNone(prep.decode_field(b"\\N"))
        self.assertEqual(prep.decode_field(b"a\\\\N"), "a\\N")
        self.assertEqual(prep.decode_field(b"\\x41\\101\\b"), "AA\b")
        self.assertEqual(prep.decode_field("Zürich ✓".encode()), "Zürich ✓")
        with self.assertRaises(prep.SnapshotError):
            prep.decode_field(b"trailing\\")


if __name__ == "__main__":
    unittest.main()
