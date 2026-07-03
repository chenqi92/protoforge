param(
  [Parameter(Mandatory = $true)]
  [string]$Target,

  [string]$Config = "",

  [int]$Attempts = 3
)

$ErrorActionPreference = "Stop"
$lastExitCode = 1
$tauriCli = Resolve-Path (Join-Path $PSScriptRoot "..\node_modules\@tauri-apps\cli\tauri.js")

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
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

  if ($attempt -lt $Attempts) {
    $delaySeconds = [Math]::Min(120, 30 * $attempt)
    Write-Warning "Tauri Windows build failed with exit code $lastExitCode. Retrying in $delaySeconds seconds..."
    Start-Sleep -Seconds $delaySeconds
  }
}

exit $lastExitCode
