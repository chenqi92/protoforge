param(
  [Parameter(Mandatory = $true)]
  [string]$Target,

  [string]$Config = "",

  [int]$Attempts = 3
)

$ErrorActionPreference = "Stop"
$lastExitCode = 1
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$tauriConfig = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$packageJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$productName = $tauriConfig.productName
$version = $packageJson.version
$tauriCli = Resolve-Path (Join-Path $repoRoot "node_modules\@tauri-apps\cli\tauri.js")

function Test-WindowsBundlesCreated {
  param(
    [DateTime]$StartedAt
  )

  $arch = switch -Wildcard ($Target) {
    "x86_64-*" { "x64" }
    "aarch64-*" { "arm64" }
    default { $Target }
  }

  $bundleRoot = Join-Path $repoRoot "src-tauri\target\$Target\release\bundle"
  $msi = Join-Path $bundleRoot "msi\$($productName)_$($version)_$($arch)_en-US.msi"
  $nsis = Join-Path $bundleRoot "nsis\$($productName)_$($version)_$($arch)-setup.exe"

  foreach ($path in @($msi, $nsis)) {
    $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if (-not $item -or $item.LastWriteTimeUtc -lt $StartedAt.ToUniversalTime()) {
      return $false
    }
  }

  return $true
}

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  $startedAt = Get-Date
  $buildArgs = @($tauriCli.Path, "build", "--target", $Target, "--ci")
  if ($Config) {
    $buildArgs += @("--config", $Config)
  }

  Write-Host "Running: node $($buildArgs -join ' ') (attempt $attempt/$Attempts)"
  & node @buildArgs
  $lastExitCode = $LASTEXITCODE

  if ($lastExitCode -eq 0) {
    exit 0
  }

  if (Test-WindowsBundlesCreated -StartedAt $startedAt) {
    Write-Warning "Tauri exited with code $lastExitCode after creating Windows installer bundles; continuing so artifacts can be collected."
    exit 0
  }

  if ($attempt -lt $Attempts) {
    $delaySeconds = [Math]::Min(120, 30 * $attempt)
    Write-Warning "Tauri Windows build failed with exit code $lastExitCode. Retrying in $delaySeconds seconds..."
    Start-Sleep -Seconds $delaySeconds
  }
}

exit $lastExitCode
