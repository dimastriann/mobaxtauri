# WebDriver end-to-end stress driver for MobaXterm against the VM.
#
# Launches tauri-driver + the built release binary, opens the VM session
# through the command palette (Ctrl+K), types the stress command into the
# terminal, then polls terminal buffers and session states every second.
#
# Evidence lines:
#   t=<s> lines=<buffer length> sessions=<status[,status]>   - normal poll
#   STALL t=<s>                                              - buffer frozen 6s
#   CRASH  t=<s>                                             - app process gone
#
# Secrets never appear here: the session password rides the saved vault.
param(
    [string]$DriverPort = 4444,
    [string]$AppPath,
    [string]$Command = 'tail -n 100000 /tmp/odoo-api.log',
    [string]$SessionHost = '',
    [string]$CredFile,
    [int]$Seconds = 45
)

$ErrorActionPreference = 'Continue'
$base = "http://127.0.0.1:$DriverPort"

if (-not $AppPath) {
    $AppPath = Join-Path (Get-Location) 'src-tauri\target\release\mobaxtauri.exe'
}

function Invoke-Wd {
    param([string]$Method, [string]$Path, $Body)
    try {
        if ($null -eq $Body) {
            Invoke-RestMethod -Uri "$base$Path" -Method $Method -TimeoutSec 25
        } else {
            Invoke-RestMethod -Uri "$base$Path" -Method $Method `
                -Body ($Body | ConvertTo-Json -Depth 8) `
                -ContentType 'application/json' -TimeoutSec 25
        }
    } catch {
        $null
    }
}

function Send-KeyActions($actions) {
    $payload = @{ actions = @(@{
        type = 'key'
        id = 'kb'
        actions = $actions
    }) }
    Invoke-Wd Post "/session/$sid/actions" $payload | Out-Null
}

# Type a string as plain keystrokes with a small inter-key delay.
function Send-Text([string]$Text, [int]$DelayMs = 20) {
    if ([string]::IsNullOrEmpty($Text)) { return }
    $steps = @()
    foreach ($c in $Text.ToCharArray()) {
        $steps += @{ type = 'keyDown'; value = [string]$c }
        $steps += @{ type = 'keyUp'; value = [string]$c }
        $steps += @{ type = 'pause'; duration = $DelayMs }
    }
    Send-KeyActions $steps
}

function Press-Key([string]$Value, [bool]$Down) {
    $kind = if ($Down) { 'keyDown' } else { 'keyUp' }
    Send-KeyActions @(@{ type = $kind; value = $Value }, @{ type = 'pause'; duration = 60 })
}

function Click-Terminal {
    $payload = @{ actions = @(@{
        type = 'pointer'
        id = 'mouse'
        parameters = @{ pointerType = 'mouse' }
        actions = @(
            @{ type = 'pointerMove'; duration = 100; x = 780; y = 380 }
            @{ type = 'pointerDown'; button = 0 }
            @{ type = 'pause'; duration = 40 }
            @{ type = 'pointerUp'; button = 0 }
        )
    }) }
    Invoke-Wd Post "/session/$sid/actions" $payload | Out-Null
}

function Get-States {
    $script = @'
return (function () {
  const m = window.__MOBAXTERM_TERMS || {};
  const st = window.__MOBAXTERM_STORE ? window.__MOBAXTERM_STORE.getState() : null;
  const terms = Object.entries(m).map(([id, t]) => {
    const b = t.buffer.active;
    return {
      id: id.slice(0, 10),
      lines: b.length,
      cursorY: b.cursorY,
      tail: [b.getLine(b.cursorY), b.getLine(b.cursorY - 1)]
        .map((l) => (l ? l.translateToString(true).slice(0, 70) : ''))
    };
  });
  const sessions = (st ? st.sessions : [])
    .filter((x) => x.type === 'ssh')
    .map((x) => ({ id: x.id.slice(0, 10), name: x.name, host: x.host, st: x.status, err: (x.error || '').slice(0, 100) }));
  return JSON.stringify({ terms, sessions });
})()
'@
    $resp = Invoke-Wd Post "/session/$sid/execute/sync" @{ script = $script; args = @() }
    if ($resp -and $resp.value) { return $resp.value }
    return $null
}

# ── Harness startup ────────────────────────────────────────────────────
if (-not (Get-Process tauri-driver -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'tauri-driver' -ArgumentList "--port $DriverPort" -WindowStyle Hidden
    Start-Sleep -Seconds 4
}

$appBody = @{
    capabilities = @{
        alwaysMatch = @{
            'tauri:options' = @{
                application = (Resolve-Path $AppPath).Path
            }
        }
    }
}
$resp = Invoke-RestMethod -Uri "$base/session" -Method Post `
    -Body ($appBody | ConvertTo-Json -Depth 6) -ContentType 'application/json' -TimeoutSec 60
if (-not $resp.value.sessionId) { Write-Host 'DRIVER: session create failed'; exit 1 }
$sid = $resp.value.sessionId
Write-Host "DRIVER: session $sid"
Start-Sleep -Seconds 5

# Summon OS focus into the app window first: keyboard actions are dropped
# while the window sits in the background.
Click-Terminal
Start-Sleep -Milliseconds 500

# Resolve the target session from the in-app store.
$states = Get-States
if (-not $states) { $states = Get-States }
if (-not $states) { Write-Host 'DRIVER: terminal hook not reachable'; exit 1 }
Write-Host "STATES: $states"
$parsed = $states | ConvertFrom-Json
$target = $parsed.sessions | Where-Object { $_.host -eq $SessionHost } | Select-Object -First 1
if (-not $target) { Write-Host "DRIVER: no session for $SessionHost"; exit 1 }

# Open the session by clicking its sidebar row via DOM. Keyboard-first
# flows (palette) proved unreliable behind WebDriver focus handoff, but
# React handles untrusted DOM clicks dispatched by el.click().
$openScript = "return (function(){const name=$($target.name | ConvertTo-Json);const rows=[...document.querySelectorAll('div,span')].filter(el=>el.textContent.trim()===name);if(!rows.length){return JSON.stringify({clicked:false,rows:0});}rows[rows.length-1].click();return JSON.stringify({clicked:true,rows:rows.length});})()"
$resp = Invoke-Wd Post "/session/$sid/execute/sync" @{ script = $openScript; args = @() }
Write-Host "DRIVER: dom-open result: $($resp.value)"
Start-Sleep -Seconds 4

# Password entry: the session shows the in-terminal prompt when no vault
# credential exists. The password arrives from the local cred file only.
$connected = $false
for ($try = 0; $try -lt 2 -and -not $connected; $try++) {
    $states = Get-States
    $parsed = $states | ConvertFrom-Json
    $sess = $parsed.sessions | Where-Object { $_.name -eq $target.name }
    if ($sess -and $sess.st -eq 'connected') { $connected = $true; break }
    if (-not $CredFile) { break }
    $passwordLine = (Get-Content $CredFile | Select-Object -Index 2)
    Click-Terminal
    Start-Sleep -Milliseconds 500
    Send-Text $passwordLine 5
    Press-Key "`r" $true; Press-Key "`r" $false
    # Wait for the connect attempt to settle.
    for ($w = 0; $w -lt 25 -and -not $connected; $w++) {
        Start-Sleep -Seconds 1
        $states = Get-States
        $parsed = $states | ConvertFrom-Json
        $sess = $parsed.sessions | Where-Object { $_.name -eq $target.name }
        if ($sess -and ($sess.st -eq 'connected' -or $sess.st -eq 'error')) {
            if ($sess.st -eq 'connected') { $connected = $true }
            break
        }
    }
}
Write-Host "DRIVER: connect phase, connected=$connected"
if (-not $connected) {
    $states = Get-States
    Write-Host "DRIVER: unable to reach connected state. STATES: $states"
    Invoke-Wd Delete "/session/$sid" | Out-Null
    exit 2
}

# Focus the terminal, type the stress command, press Enter (\r).
Click-Terminal
Start-Sleep -Milliseconds 400
Send-Text $Command 10
Send-KeyActions @(
    @{ type = 'keyDown'; value = "`r" }
    @{ type = 'keyUp'; value = "`r" }
)
Write-Host "DRIVER: command dispatched; polling $Seconds s"

# ── Poll loop: growth vs stall vs crash ────────────────────────────────
$lastLines = -1
$staleFor = 0
for ($i = 0; $i -lt $Seconds; $i++) {
    Start-Sleep -Seconds 1
    $app = Get-Process mobaxtauri -ErrorAction SilentlyContinue
    if (-not $app) {
        Write-Host "CRASH t=$i`: app process gone"
        break
    }
    $states = Get-States
    if (-not $states) {
        Write-Host "DEAD-RPC t=$i`: driver endpoint dead, process alive"
        break
    }
    $parsed = $states | ConvertFrom-Json
    $lines = ($parsed.terms | Measure-Object lines -Maximum).Maximum
    $sessTxt = ($parsed.sessions | ForEach-Object { "$($_.name)=$($_.st)" }) -join ','
    $errTxt = ($parsed.sessions | Where-Object { $_.err } | ForEach-Object { $_.err }) -join ' | '
    if ($lines -eq $lastLines) { $staleFor++ } else { $staleFor = 0; $lastLines = $lines }
    if ($errTxt) { Write-Host "t=$i lines=$lines [$sessTxt] ERR: $errTxt" }
    else { Write-Host "t=$i lines=$lines [$sessTxt]" }
    if ($staleFor -ge 6) {
        Write-Host "STALL t=$i`: buffer static for ${staleFor}s while output should flow"
    }
}

# Leave the driver running for follow-up probes; delete the session.
Invoke-Wd Delete "/session/$sid" | Out-Null
Write-Host 'DRIVER: done'
