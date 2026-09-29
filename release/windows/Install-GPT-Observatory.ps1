$ErrorActionPreference = "Stop"

$payloadRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$releasePath = Join-Path $payloadRoot "release.json"
$manifestPath = Join-Path $payloadRoot "payload-manifest.json"
if (-not (Test-Path $releasePath)) {
  throw "Release payload metadata is missing: $releasePath"
}
if (-not (Test-Path $manifestPath)) {
  throw "Release payload manifest is missing: $manifestPath"
}

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json

foreach ($file in $manifest.files) {
  $path = Join-Path $payloadRoot ($file.path -replace '/', '\')
  if (-not (Test-Path $path)) {
    throw "Release payload is incomplete: $($file.path)"
  }
  $actual = (Get-FileHash $path -Algorithm SHA256).Hash
  if ($actual -ne $file.sha256) {
    throw "Release payload checksum mismatch: $($file.path)"
  }
}

$release = Get-Content -Raw $releasePath | ConvertFrom-Json

$installHome = if ($env:GPT_OBSERVATORY_INSTALL_HOME) {
  $env:GPT_OBSERVATORY_INSTALL_HOME
} else {
  Join-Path $env:LOCALAPPDATA "GPTObservatory"
}
$installHome = [System.IO.Path]::GetFullPath($installHome)
$env:GPT_OBSERVATORY_INSTALL_HOME = $installHome
$runtimeHome = Join-Path $installHome ("runtime-node\" + $release.nodeVersion)
$sourceRuntime = Join-Path $payloadRoot "runtime\node"
$nodeTarget = Join-Path $runtimeHome "node.exe"

New-Item -ItemType Directory -Force -Path $runtimeHome | Out-Null
if (-not (Test-Path $nodeTarget)) {
  Copy-Item -Path (Join-Path $sourceRuntime "*") -Destination $runtimeHome -Recurse -Force
}

if (-not (Test-Path $nodeTarget)) {
  throw "Bundled Node runtime installation failed: $nodeTarget"
}

$env:GPT_OBSERVATORY_RELEASE_PAYLOAD = "1"
$env:GPT_OBSERVATORY_BUILD_COMMIT = $release.commit
$env:GPT_OBSERVATORY_NO_BROWSER = "1"

& $nodeTarget (Join-Path $payloadRoot "scripts\install-desktop.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "GPT Observatory installer failed with exit code $LASTEXITCODE"
}

& $nodeTarget (Join-Path $installHome "launcher\start.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "GPT Observatory installed but failed to launch."
}
