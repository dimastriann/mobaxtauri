# Full-app SSH stress runner: drives the built MobaXTauri binary against
# the VM through tauri-driver + diagnostic hooks, no human input.
#
# Sequence: create session -> open the VM session row -> type the vault-less
# password via synthetic KeyboardEvents into the active terminal -> wait for
# 'connected' -> type the stress command -> poll buffer growth/status for
# $Seconds, flagging STALL (no buffer growth) and CRASH (process gone).
#
# Secrets: the password is read from the local cred file; never printed.
param(
    [string]$DriverPort = 4444,
    [string]$AppPath,
    [string]$Command = 'tail -n 100000 /tmp/odoo-api.log',
    [string]$SessionHost = '',
    [string]$SessionName = '',
    [string]$CredFile,
    [int]$Seconds = 60,
    [string]$OutPrefix = 'stress'
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

# Types into the terminal by calling the exposed onData handler through
# the diagnostic hook. This is byte-for-byte the same input path real
# keystrokes take (password mode, passphrase mode, shell data).
function Send-ThroughHook {
    param([string]$SessionId, [string]$TerminalId, [string]$TextJson)
    $payload = @{
        script = @"
return (function () {
  const send = (window.__MOBAXTERM_SEND || {})['$TerminalId'];
  if (!send) return JSON.stringify({ok: false, reason: 'no hook'});
  const text = $TextJson;
  for (const ch of text) {
    if (ch ==='\n') { send('\r'); } else { send(ch); }
  }
  return JSON.stringify({ok: true, chars: text.length});
})()
"@
        args   = @()
    }
    $resp = Invoke-Wd Post "/session/$SessionId/execute/sync" $payload
    return $resp.value
}

function Get-States {
    param([string]$SessionId)
    $script = @'
return (function () {
  const m = window.__MOBAXTERM_TERMS || {};
  const st = window.__MOBAXTERM_STORE ? window.__MOBAXTERM_STORE.getState() : null;
  const terms = {};
  const sessions = (st ? st.sessions : []).filter((x) => x.type === 'ssh');
  for (const s of sessions) {
    const t = m[s.id];
    if (t && b_is(t)) {
      const b = t.buffer.active;
      terms[s.id.slice(0, 10)] = {
        lineCount: b.length,
        cursorRow: b.cursorY + b.baseY,
        last: (b.getLine(b.cursorY + b.baseY) || { translateToString: () => '' })
          .translateToString(true)
          .slice(0, 100)
      };
    }
  }
  return JSON.stringify({
    sessions: sessions.map((x) => ({
      id: x.id.slice(0, 10),
      name: x.name,
      host: (x.host || '').slice(0, 20),
      st: x.status,
      err: (x.error || '').slice(0, 90)
    })),
    terms,
    console: (window.__MOBAXTERM_CONSOLE || []).slice(-3),
    alive: !!(window.__MOBAXTERM_TERMS)
  });
  function b_is(t) { return t && t.buffer && t.buffer.active; }
})()
'@
    $resp = Invoke-Wd Post "/session/$SessionId/execute/sync" @{ script = $script; args = @() }
    if ($resp -and $resp.value) { return $resp.value }
    return $null
}

# ── Run ───────────────────────────────────────────────────────────────
$h = Invoke-RestMethod -Uri "$base/session" -Method Post `
    -Body (@{
        capabilities = @{
            alwaysMatch = @{
                'tauri:options' = @{ application = (Resolve-Path $AppPath).Path }
            }
        }
    } | ConvertTo-Json -Depth 6) -ContentType 'application/json' -TimeoutSec 60
$sid = $h.value.sessionId
Write-Host "DRIVER: session $sid"
Start-Sleep -Seconds 6

# Open the VM session row via DOM.
$open = @'
return (function () {
  const rows = [...document.querySelectorAll('div,span')]
    .filter((el) => el.textContent.trim() === "$SessionName");
  if (!rows.length) return JSON.stringify({clicked: false});
  rows[rows.length - 1].click();
  return JSON.stringify({clicked: true});
})()
'@
Invoke-Wd Post "/session/$sid/execute/sync" @{ script = $open; args = @() } | Out-Null
Start-Sleep -Seconds 4

# Resolve the FULL session id matching $SessionHost from the store.
$states = Get-States -SessionId $sid
$parsed = $states | ConvertFrom-Json
$target = $parsed.sessions | Where-Object { $_.host -like "*$SessionHost*" } | Select-Object -First 1
if (-not $target) { Write-Host "RUNNER: no session for $SessionHost"; exit 1 }
Write-Host "RUNNER: target session prefix $($target.id)"

# Resolve the full id (states reports only the prefix).
$fullId = Invoke-Wd Post "/session/$sid/execute/sync" @{
    script = "return (function(){const st=window.__MOBAXTERM_STORE.getState();const s=st.sessions.find(x=>x.type==='ssh'&&x.host.indexOf('$SessionHost')>-1);return s?s.id:''})()"
    args   = @()
}
$fullId = $fullId.value
if (-not $fullId) { Write-Host 'RUNNER: full id unresolved'; exit 5 }
Write-Host "RUNNER: full id reached ($($fullId.Length) chars)"

# The password rides the third line of the cred file and is never echoed.
$password = if ($CredFile) { (Get-Content $CredFile | Select-Object -Skip 2 -First 1) } else { $null }
if (-not $password) { Write-Host 'RUNNER: no password available'; exit 3 }

$passwordJson = $password | ConvertTo-Json
$typed = Send-ThroughHook -SessionId $sid -TerminalId $fullId -TextJson $passwordJson
Write-Host "RUNNER: password type: $typed"
Start-Sleep -Milliseconds 400
$enter = Send-ThroughHook -SessionId $sid -TerminalId $fullId -TextJson "'\n'"
Write-Host "RUNNER: enter: $enter"

# Wait for 'connected'.
$connected = $false
for ($w = 0; $w -lt 30 -and -not $connected; $w++) {
    Start-Sleep -Seconds 1
    $states = Get-States -SessionId $sid
    $parsed = $states | ConvertFrom-Json
    $sess = $parsed.sessions | Where-Object { $_.id -eq $target.id }
    $status = $sess.st
    if ($w % 5 -eq 0) { Write-Host "RUNNER: t+${w}s status=$status" }
    if ($status -eq 'connected') { $connected = $true }
    if ($status -in @('error', 'disconnected') -and $w -gt 3) { break }
}
if (-not $connected) {
    $states = Get-States -SessionId $sid
    Write-Host "RUNNER: not connected. STATES: $states"
    Invoke-Wd Delete "/session/$sid" | Out-Null
    exit 4
}
Write-Host 'RUNNER: connected'

# Dispatch the stress command.
$cmdJson = $Command | ConvertTo-Json
$typed = Send-ThroughHook -SessionId $sid -TerminalId $fullId -TextJson $cmdJson
$enter = Send-ThroughHook -SessionId $sid -TerminalId $fullId -TextJson "'\n'"
Write-Host "RUNNER: command dispatched: $typed"

# ── Polling window ───────────────────────────────────────────────────
$lastLines = -1
$staleFor = 0
$grown = 0
for ($i = 0; $i -lt $Seconds; $i++) {
    Start-Sleep -Seconds 1
    $app = Get-Process mobaxtauri -ErrorAction SilentlyContinue
    if (-not $app) {
        Write-Host "CRASH t=$i`: app process gone"
        break
    }
    $states = Get-States -SessionId $sid
    if (-not $states) {
        Write-Host "DEAD-RPC t=$i`: driver link down, process alive"
        break
    }
    $parsed = $states | ConvertFrom-Json
    $term = $parsed.terms.PSObject.Properties.Value | Select-Object -First 1
    $lines = if ($term) { $term.lineCount } else { -1 }
    $sessTxt = ($parsed.sessions | ForEach-Object { "$($_.name)=$($_.st)" }) -join ','
    $tail = if ($term) { $term.last } else { '' }
    if ($lines -gt $lastLines) { $grown++; $staleFor = 0; $lastLines = $lines }
    else { $staleFor++ }
    $marker = if ($staleFor -ge 6) { " STALL(${staleFor}s)" } else { "" }
    Write-Host "t=$i lines=$lines growth=$grown [$sessTxt] last='$($tail.Substring(0, [Math]::Min(60, $tail.Length)))'$marker"
    if ($staleFor -ge 25) {
        Write-Host "RUNNER: hard stall - giving up at t=$i"
        break
    }
}

# Final state snapshot + screenshot for forensics.
$states = Get-States -SessionId $sid
Write-Host "FINAL: $states"
try {
    $shot = Invoke-RestMethod -Uri "$base/session/$sid/screenshot" -TimeoutSec 25
    $bytes = [Convert]::FromBase64String($shot.value)
    [System.IO.File]::WriteAllBytes("$PWD\tmp\$OutPrefix-final.png", $bytes)
    Write-Host "RUNNER: screenshot saved to tmp\$OutPrefix-final.png"
} catch {
    Write-Host 'RUNNER: screenshot failed (may be renderer-guarded)'
}
Invoke-Wd Delete "/session/$sid" | Out-Null
Write-Host 'RUNNER: session closed'
