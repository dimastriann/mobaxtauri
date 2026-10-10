# Generates an Odoo backend/API-style log file for terminal stress testing.
#
# Usage (Windows host, then upload via SFTP, or copy to the remote host):
#   .\scripts\generate-odoo-api-log.ps1                       # 100k lines to .\tmp\odoo-api.log
#   .\scripts\generate-odoo-api-log.ps1 -LineCount 200000 -Path D:\tmp\odoo-api.log
#
# Suggested stress drills against the generated file inside a MobaXTauri
# SSH terminal (each exercises a different stall class):
#   tail -n 100000 /tmp/odoo-api.log            # one huge burst
#   tail -f /tmp/odoo-api.log                   # sustained drip (Ctrl+C to stop)
#   cat /tmp/odoo-api.log > /dev/null && echo ok # raw throughput, no render
#   less /tmp/odoo-api.log                      # pager paint/clear cycles
param(
    [int]$LineCount = 100000,
    [string]$Path = (Join-Path (Get-Location) 'tmp\odoo-api.log')
)

$outDir = Split-Path $Path -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

$moduleNames = 'odoo.http', 'odoo.api', 'odoo.sql_db', 'odoo.addons.base', 'odoo.addons.sale', 'odoo.addons.stock', 'werkzeug'
$apiTargets = 'POST /api/v1/sale.order', 'GET /api/v1/res.partner', 'POST /api/v1/stock.move', 'GET /api/v1/account.move', 'POST /web/dataset/call_kw'
$customers = 'PT Sinar Teknik', 'CV Maju Bersama', 'Café Del Sol', '株式会社テンソル'

$lines = [System.Collections.Generic.List[string]]::new($LineCount)
$base = (Get-Date).AddHours(-2)
$utf8 = [System.Text.UTF8Encoding]::new($false)

for ($i = 0; $i -lt $LineCount; $i++) {
    $ts = $base.AddMilliseconds($i).ToString('yyyy-MM-dd HH:mm:ss,fff')
    $procId = 1000 + ($i % 2900)
    $roll = $i % 1000
    if ($i % 9 -eq 8) { $level = 'ERROR' }
    elseif ($roll -ge 940) { $level = 'WARNING' }
    elseif ($roll -ge 800) { $level = 'DEBUG' }
    else { $level = 'INFO' }
    $module = $moduleNames[$i % $moduleNames.Count]
    $kind = $i % 20

    switch ($kind) {
        0 {
            $target = $apiTargets[$i % $apiTargets.Count]
            $lines.Add("$ts $procId $level moba-test $module`: HTTP request from 10.0.$($i % 30).$($i % 250): $target 200 OK $($i % 900) ms 3 rows")
        }
        1 {
            $name = $customers[$i % $customers.Count]
            $lines.Add("$ts $procId $level moba-test $module`: record[$($i % 99999)] partner name=`"$name`" country=id smart=False")
        }
        2 {
            $lines.Add("$ts $procId $level moba-test odoo.sql_db: slow query SELECT `"sale_order`".id FROM `"sale_order`" LEFT JOIN `"res_partner`" ON ...) $($i % 500) ms, plan: seq scan on res_partner")
        }
        3 {
            $lines.Add("$ts $procId ERROR moba-test psycopg2: deadlock detected UPDATE res_partner SET write_date=now() WHERE id=$($i % 9000)")
        }
        Default {
            $lines.Add("$ts $procId $level moba-test $module`: dispatch request $i state=done elapsed=$($i % 120) ms worker=0 workbook=none")
        }
    }
}

# A single WriteAllLines keeps the produced segment contiguous for tail bursts.
[System.IO.File]::WriteAllLines($Path, $lines, $utf8)

$size = (Get-Item $Path).Length
Write-Host "Wrote $LineCount lines ($([math]::Round($size / 1MB, 1)) MB) to $Path"
