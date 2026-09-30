"""Access to the snapshots that run.sh writes into data/<unix timestamp>/.

This is the only module that knows the data lives in files. When the data
moves to the database, only this module has to change.
"""
import csv
import json
import re
from datetime import datetime, timezone

from django.conf import settings

RUN_ID_RE = re.compile(r"^\d+$")

# JSON files the dashboard is allowed to read from a run directory.
ALLOWED_FILES = frozenset({
    "analytics_stocks_products",
    "analytics_stocks_wb_warehouse",
    "common_seller_info",
    "finance_balance",
    "finance_detailed",
    "finance_list",
    "sales_funnel_products",
    "statistics_orders",
    "statistics_sales",
})


class RunNotFound(Exception):
    pass


def _run_dir(run_id):
    if not RUN_ID_RE.match(str(run_id)):
        raise RunNotFound(run_id)
    path = settings.DATA_DIR / str(run_id)
    # main.py writes report.csv last, so its presence marks a finished run.
    if not (path / "report.csv").is_file():
        raise RunNotFound(run_id)
    return path


def _started_at(run_id):
    return datetime.fromtimestamp(int(run_id), tz=timezone.utc).isoformat()


def list_runs():
    """Finished runs, newest first."""
    if not settings.DATA_DIR.is_dir():
        return []
    runs = [
        path.name
        for path in settings.DATA_DIR.iterdir()
        if path.is_dir() and RUN_ID_RE.match(path.name) and (path / "report.csv").is_file()
    ]
    runs.sort(key=int, reverse=True)
    return [{"id": run_id, "started_at": _started_at(run_id)} for run_id in runs]


def load(run_id, name):
    if name not in ALLOWED_FILES:
        raise RunNotFound(name)
    path = _run_dir(run_id) / f"{name}.json"
    if not path.is_file():
        raise RunNotFound(name)
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _read_metrics(run_id):
    with (_run_dir(run_id) / "report.csv").open(encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    if len(rows) < 2:
        return None
    # A run's own report.csv holds the header and the metrics of that run.
    header, values = rows[0], rows[-1]
    return {key: float(value) for key, value in zip(header, values)}


def history():
    """Summary metrics of every finished run, oldest first."""
    result = []
    for run in reversed(list_runs()):
        metrics = _read_metrics(run["id"])
        if metrics is not None:
            result.append({**run, "metrics": metrics})
    return result
