import csv
import json
import logging
import os
import random
import sys
import time
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode

import requests

WB_TOKEN = os.environ.get("WB_TOKEN")
OUT = Path(os.environ.get("OUTPUT_DIR"))

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)sZ %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)


def save_json(name, value):
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def load_json(name):
    with (OUT / f"{name}.json").open(encoding="utf-8") as f:
        return json.load(f)


def request_or_die(method: str, url: str, headers=None, json_body=None,
                   max_attempts: int = 5, base_delay=60, timeout=60) -> requests.Response:
    # See https://dev.wildberries.ru/en/knowledge-base/articles/019e3a7a-8d31-7648-a277-cd5eefd96941/how-to-retry-a-request-correctly-on-429
    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.request(method, url, headers=headers, json=json_body, timeout=timeout)
            logger.info("Requested url=%s status_code=%s", url, resp.status_code)
            if 200 <= resp.status_code <= 299:
                # Ok!
                return resp
            if 300 <= resp.status_code <= 499 and resp.status_code != 429:
                # Let's not retry 4xx.
                raise Exception("Request failed")
        except requests.exceptions.RequestException as exc:
            logger.info("Requested url=%s exc=%s", url, exc)
            resp = None
        retry_after = (resp.headers.get("X-Ratelimit-Retry") or resp.headers.get(
            "Retry-After")) if resp and resp.status_code == 429 else None
        delay = float(retry_after) if retry_after else base_delay * (2 ** (attempt - 1))
        delay *= random.uniform(0.75, 1.25)
        if attempt != max_attempts:
            logger.info("Backing off for %s seconds", delay)
            time.sleep(delay)
    raise Exception("Request failed")


def wb_get(url, base_delay=1.0):
    resp = request_or_die("GET",
                          url,
                          headers={"Authorization": WB_TOKEN,
                                   "Accept": "application/json"})
    return resp.json()


def wb_post(url, json_body):
    resp = request_or_die("POST",
                          url,
                          headers={"Authorization": WB_TOKEN,
                                   "Accept": "application/json",
                                   "Content-Type": "application/json"},
                          json_body=json_body)
    return resp.json()


def as_rows(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("data", "items", "orders", "stocks", "reports"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def get_data():
    # Let's simplify the task and consider only the current month.
    now = datetime.now()
    today = now.date().isoformat()
    month_start = now.date().replace(day=1).isoformat()
    save_json("common_seller_info", wb_get("https://common-api.wildberries.ru/api/v1/seller-info"))
    save_json("finance_balance", wb_get("https://finance-api.wildberries.ru/api/v1/account/balance"))
    statistics_orders = wb_get(
        f"https://statistics-api.wildberries.ru/api/v1/supplier/orders?{urlencode({'dateFrom': month_start, 'flag': 0})}")
    save_json("statistics_orders", statistics_orders)
    save_json("finance_list", wb_post("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list",
                                      json_body={"dateFrom": month_start, "dateTo": today,
                                                 "limit": 100, "offset": 0, "period": "daily"}))
    save_json("finance_detailed", wb_post("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",
                                          json_body={"dateFrom": month_start, "dateTo": today}))
    save_json("statistics_sales", wb_get(
        f"https://statistics-api.wildberries.ru/api/v1/supplier/sales?{urlencode({'dateFrom': month_start, 'flag': 0})}"))

    save_json("analytics_stocks_products",
              wb_post("https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/products",
                      json_body={
                          "currentPeriod": {"start": month_start, "end": today},
                          "stockType": "",
                          "skipDeletedNm": True,
                          "orderBy": {
                              "field": "avgOrders",
                              "mode": "desc"
                          },
                          "availabilityFilters": [
                              "deficient",
                              "actual",
                              "balanced",
                              "nonActual",
                              "nonLiquid",
                              "invalidData"
                          ],
                          "offset": 0
                      }))
    save_json("sales_funnel_products",
              wb_post("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
                      json_body={
                          "selectedPeriod": {"start": month_start, "end": today},
                          "nmIds": [], "brandNames": [], "subjectIds": [], "tagIds": [],
                          "skipDeletedNm": False,
                          "limit": 1000, "offset": 0,
                      }))
    nm_ids = sorted(
        {int(row["nmId"]) for row in as_rows(statistics_orders) if isinstance(row, dict) and row.get("nmId")})
    save_json("analytics_stocks_wb_warehouse",
              wb_post("https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
                      json_body={"nmIds": nm_ids}) if nm_ids else {})


def decimal_value(value):
    return Decimal(str(value or 0))


def sum_funnel(products, field):
    return sum(
        (
            decimal_value(
                product.get("statistic", {})
                .get("selected", {})
                .get(field)
            )
            for product in products
        ),
        Decimal("0"),
    )


def sum_finance(rows, field):
    return sum(
        (decimal_value(row.get(field)) for row in rows),
        Decimal("0"),
    )


def format_money(value):
    return format(value.quantize(Decimal("0.01")), "f")


def compute_metrics():
    # (Blame ChatGPT.)
    sales_funnel = load_json("sales_funnel_products")
    finance_details = load_json("finance_detailed")
    products = sales_funnel["data"]["products"]
    metrics = [
        ("total_orders_count", int(sum_funnel(products, "orderCount"))),
        ("total_orders_sum", format_money(sum_funnel(products, "orderSum"))),
        ("total_buyout_count", int(sum_funnel(products, "buyoutCount"))),
        ("total_buyout_sum", format_money(sum_funnel(products, "buyoutSum"))),
        (
            "total_commission_spending",
            format_money(sum_finance(finance_details, "ppvzSalesCommission")),
        ),
        (
            "total_logistics_spending",
            format_money(sum_finance(finance_details, "deliveryService")),
        ),
        (
            "total_warehouse_storage_spending",
            format_money(sum_finance(finance_details, "paidStorage")),
        ),
    ]
    return metrics


def save_report(report_path: Path, metrics):
    # Assuming the list of metrics never changes.
    if report_path.exists():
        with report_path.open("r", encoding="utf-8", newline="") as f:
            existing_rows = list(csv.reader(f))
    else:
        existing_rows = []
    temp_path = Path(str(report_path.parent) + '/.new-' + str(report_path.name))
    with temp_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        if existing_rows:
            writer.writerows(existing_rows)
        else:
            writer.writerow(m[0] for m in metrics)
        writer.writerow(m[1] for m in metrics)
    os.replace(temp_path, report_path)


if __name__ == '__main__':
    get_data()
    # FIXME Add timestamp to metrics.
    metrics = compute_metrics()
    save_report(Path(OUT / 'report.csv'), metrics)
    save_report(Path('data/report.csv'), metrics)
