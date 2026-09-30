import json
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .services import runs

REPORT = (
    "total_orders_count,total_orders_sum\n"
    "{count},{sum}\n"
)


class RunsTestCase(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        self.override = override_settings(DATA_DIR=self.data_dir)
        self.override.enable()

        self.make_run("1000", count=10, total=100)
        self.make_run("2000", count=12, total=150)
        # Run still in progress: no report.csv yet.
        (self.data_dir / "3000").mkdir()
        (self.data_dir / "3000" / "common_seller_info.json").write_text("{}", encoding="utf-8")
        # Shared report and lock file next to the runs must be ignored.
        (self.data_dir / "report.csv").write_text(REPORT.format(count=1, sum=1), encoding="utf-8")
        (self.data_dir / "run-lock").write_text("", encoding="utf-8")

        self.user = get_user_model().objects.create_user("manager", password="s3cret-pass-42")
        self.client.force_login(self.user)

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def make_run(self, run_id, count, total):
        path = self.data_dir / run_id
        path.mkdir()
        (path / "report.csv").write_text(REPORT.format(count=count, sum=total), encoding="utf-8")
        (path / "common_seller_info.json").write_text(
            json.dumps({"name": "ИП Тест", "run": run_id}, ensure_ascii=False), encoding="utf-8")
        (path / "finance_detailed.json").write_text("[]", encoding="utf-8")
        (path / "log").write_text("INFO Requested url=...", encoding="utf-8")
        (path / "other.json").write_text("{}", encoding="utf-8")

    def test_list_runs_skips_unfinished_and_sorts_newest_first(self):
        self.assertEqual([r["id"] for r in runs.list_runs()], ["2000", "1000"])

    def test_list_runs_without_data_dir(self):
        with override_settings(DATA_DIR=self.data_dir / "missing"):
            self.assertEqual(runs.list_runs(), [])

    def test_load_allowed_file(self):
        self.assertEqual(runs.load("1000", "common_seller_info")["run"], "1000")

    def test_load_rejects_unfinished_run(self):
        with self.assertRaises(runs.RunNotFound):
            runs.load("3000", "common_seller_info")

    def test_load_rejects_files_outside_whitelist(self):
        for run_id, name in [
            ("1000", "other"),
            ("1000", "log"),
            ("1000", "report"),
            ("..", "common_seller_info"),
            ("1000/..", "common_seller_info"),
            ("1000", "../2000/common_seller_info"),
            ("1000", ".env"),
        ]:
            with self.subTest(run_id=run_id, name=name), self.assertRaises(runs.RunNotFound):
                runs.load(run_id, name)

    def test_history_oldest_first(self):
        history = runs.history()
        self.assertEqual([h["id"] for h in history], ["1000", "2000"])
        self.assertEqual(history[1]["metrics"], {"total_orders_count": 12.0, "total_orders_sum": 150.0})
        self.assertIn("started_at", history[0])

    def test_api_runs(self):
        resp = self.client.get("/api/runs")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r["id"] for r in resp.json()["runs"]], ["2000", "1000"])

    def test_api_run_file(self):
        resp = self.client.get("/api/runs/2000/common_seller_info")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"name": "ИП Тест", "run": "2000"})

    def test_api_run_file_not_found(self):
        for url in [
            "/api/runs/9999/common_seller_info",
            "/api/runs/3000/common_seller_info",
            "/api/runs/1000/other",
            "/api/runs/1000/log",
            "/api/runs/1000/..%2F..%2F.env",
        ]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_load_report_files(self):
        self.assertEqual(runs.load("1000", "finance_detailed"), [])

    def test_api_run_file_gzip(self):
        # Django skips compression for bodies shorter than 200 bytes.
        rows = [{"reportId": i, "forPaySum": "100.00"} for i in range(50)]
        (self.data_dir / "2000" / "finance_list.json").write_text(json.dumps(rows), encoding="utf-8")
        resp = self.client.get("/api/runs/2000/finance_list", HTTP_ACCEPT_ENCODING="gzip")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get("Content-Encoding"), "gzip")

    def test_api_history(self):
        resp = self.client.get("/api/history")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["history"]), 2)

    def test_api_is_read_only(self):
        self.assertEqual(self.client.post("/api/runs").status_code, 405)

    def test_index(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "История остатков")


class AuthTestCase(TestCase):
    password = "s3cret-pass-42"

    def setUp(self):
        self.user = get_user_model().objects.create_user("manager", password=self.password)

    def test_page_redirects_to_login(self):
        resp = self.client.get("/")
        self.assertRedirects(resp, "/login/?next=/", fetch_redirect_response=False)

    def test_api_returns_401(self):
        for url in ["/api/runs", "/api/history", "/api/runs/1000/common_seller_info"]:
            with self.subTest(url=url):
                resp = self.client.get(url)
                self.assertEqual(resp.status_code, 401)
                self.assertEqual(resp.json(), {"error": "authentication required"})

    def test_login_page_is_public(self):
        resp = self.client.get("/login/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Войти")

    def test_login_with_wrong_password(self):
        resp = self.client.post("/login/", {"username": "manager", "password": "wrong"})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "login-error")
        self.assertEqual(self.client.get("/api/runs").status_code, 401)

    def test_login_and_redirect_back(self):
        resp = self.client.post("/login/", {"username": "manager", "password": self.password, "next": "/#orders"})
        self.assertRedirects(resp, "/#orders", fetch_redirect_response=False)
        self.assertEqual(self.client.get("/api/runs").status_code, 200)

    def test_page_shows_user_and_logout(self):
        self.client.force_login(self.user)
        resp = self.client.get("/")
        self.assertContains(resp, "manager")
        self.assertContains(resp, "Выйти")
        self.assertNotContains(resp, "Админка")

    def test_logout_requires_post(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/logout/").status_code, 405)
        resp = self.client.post("/logout/")
        self.assertRedirects(resp, "/login/", fetch_redirect_response=False)
        self.assertEqual(self.client.get("/api/runs").status_code, 401)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save()
        self.client.post("/login/", {"username": "manager", "password": self.password})
        self.assertEqual(self.client.get("/api/runs").status_code, 401)

    def test_admin_for_staff_only(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/admin/").status_code, 302)
        admin = get_user_model().objects.create_superuser("owner", password=self.password)
        self.client.force_login(admin)
        self.assertEqual(self.client.get("/admin/").status_code, 200)
        self.assertContains(self.client.get("/"), "Админка")
