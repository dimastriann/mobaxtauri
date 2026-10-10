#!/usr/bin/env bash
# Generates an Odoo backend/API-style log file for terminal stress testing.
#
# Usage on the remote host:
#   bash generate-odoo-api-log.sh                    # 100k lines to /tmp/odoo-api.log
#   bash generate-odoo-api-log.sh 200000 /tmp/big.log
#
# Stress drills inside a MobaXTauri SSH terminal:
#   tail -n 100000 /tmp/odoo-api.log     # one huge burst
#   tail -f /tmp/odoo-api.log            # sustained drip (Ctrl+C to stop)
#   cat /tmp/odoo-api.log > /dev/null    # raw throughput, no render
#   less /tmp/odoo-api.log               # pager paint/clear cycles
set -euo pipefail

count="${1:-100000}"
out="${2:-/tmp/odoo-api.log}"

# Portable awk (no strftime/srand): seconds are derived arithmetically and
# formatted with printf so this runs under gawk, mawk, and busybox alike.
# Rough size: ~150 bytes/line => 100k lines is ~13MB.
awk -v n="$count" -v out="$out" 'BEGIN {
    split("odoo.http|odoo.api|odoo.sql_db|odoo.addons.base|odoo.addons.sale|odoo.addons.stock|werkzeug", modules, "|")
    split("POST /api/v1/sale.order|GET /api/v1/res.partner|POST /api/v1/stock.move|GET /api/v1/account.move|POST /web/dataset/call_kw", endpoints, "|")
    split("PT Sinar Teknik|CV Maju Bersama|Café Del Sol|株式会社テンソル", customers, "|")
    split("INFO|INFO|INFO|INFO|INFO|DEBUG|DEBUG|WARNING|ERROR", levels, "|")

    start_s = 5 * 3600 + 41 * 60
    for (i = 0; i < n; i++) {
        s = start_s + int(i / 100)
        ms = (i % 100) * 10
        ts = sprintf("2026-10-10 %02d:%02d:%02d,%03d", int(s / 3600) % 24, int(s / 60) % 60, s % 60, ms)
        base = ts " " (1000 + i % 2900) " " levels[i % 9 + 1] " moba-test " modules[i % 7 + 1] ": "
        kind = i % 20
        if (kind == 0) {
            print base "HTTP request from 10.0." i % 30 "." i % 250 ": " endpoints[i % 5 + 1] " 200 OK " i % 900 " ms 3 rows" > out
        } else if (kind == 1) {
            print base "record[" i % 99999 "] partner name=\"" customers[i % 4 + 1] "\" country=id smart=False" > out
        } else if (kind == 2) {
            print base "slow query SELECT \"sale_order\".id FROM \"sale_order\" LEFT JOIN \"res_partner\"...) " i % 500 " ms, plan: seq scan on res_partner" > out
        } else if (kind == 3) {
            print ts " " (1000 + i % 2900) " ERROR moba-test psycopg2 deadlock detected UPDATE res_partner SET write_date=now() WHERE id=" i % 9000 > out
        } else {
            print base "dispatch request " i " state=done elapsed=" i % 120 " ms worker=0 workbook=none" > out
        }
    }
    close(out)
}'

size=$(wc -c < "$out")
lines=$(wc -l < "$out")
echo "Wrote $lines lines ($((size / 1024 / 1024)) MB) to $out"
