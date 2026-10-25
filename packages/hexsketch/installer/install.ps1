# HexSketch for Claude Desktop (Windows): copies the server to
# %LOCALAPPDATA%\HexSketch-MCP, adds it to Claude Desktop's config file and
# restarts Claude.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'HexSketch-MCP'
$config = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host 'HexSketch needs Node.js. The download page is opening: install the LTS version, then run this command again.'
  Start-Process 'https://nodejs.org/en/download'
  exit 1
}
$major = [int](& $node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) {
  Write-Host "Node.js $major is too old (HexSketch needs 20 or later). The download page is opening: install the LTS version, then run this command again."
  Start-Process 'https://nodejs.org/en/download'
  exit 1
}

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $here 'server\*') $dest
& $node (Join-Path $here 'configure.mjs') $config $node (Join-Path $dest 'dist\cli.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Restarting Claude...'
$claude = Get-Process Claude -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path
Get-Process Claude -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
if ($claude) { Start-Process $claude } else { Write-Host 'Open Claude again yourself.' }
Write-Host ''
Write-Host 'Done. In Claude, start a new chat and ask: Open the HexSketch sketcher with ibuprofen'
