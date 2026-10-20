# Builds the ALTER and ALTERA beta APKs against the beta server. Run from anywhere in PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy\beta\build-apks.ps1 [-Url https://...]
# The address is https://<BETA_SERVER_IP with dashes>.sslip.io (from .env.beta) unless -Url is given.
# The APKs land in deploy\beta\apk\ (git-ignored), ready to send.
# A path with a space ("C:\THE ALT") breaks ALTERA's release build, so it is built through a temporary drive letter.
param([string]$Url = '')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$flutter = if ($env:FLUTTER) { $env:FLUTTER } else { 'C:\flutter\bin\flutter.bat' }

if (-not $Url) {
  $line = Get-Content (Join-Path $repo '.env.beta') | Where-Object { $_ -match '^BETA_SERVER_IP=' }
  $ip = ($line -replace '^BETA_SERVER_IP=', '').Trim()
  if (-not $ip) { throw 'BETA_SERVER_IP is empty in .env.beta' }
  $Url = "https://$($ip -replace '\.', '-').sslip.io"
}

$drive = 'WVUTSRQP'.ToCharArray() | ForEach-Object { "$($_):" } | Where-Object { -not (Test-Path "$_\") } | Select-Object -First 1
if (-not $drive) { throw 'no free drive letter' }
subst $drive $repo
try {
  Write-Host "building the beta APKs for $Url (through $drive)"
  $out = Join-Path $repo 'deploy\beta\apk'
  New-Item -ItemType Directory -Force $out | Out-Null
  foreach ($app in 'alter', 'altera') {
    Push-Location "$drive\apps\$app"
    try {
      $log = Join-Path $out "build-$app.log"
      $ErrorActionPreference = 'Continue'   # Gradle writes warnings to stderr; only the exit code counts
      & $flutter build apk --release "--dart-define=ALT_API_URL=$Url" "--dart-define=ALT_PLATFORM=$app" *> $log
      $code = $LASTEXITCODE
      # A Gradle daemon left from one app can break the next app's release build: stop it between apps.
      & .\android\gradlew.bat -p android --stop *> $null
      $ErrorActionPreference = 'Stop'
      if ($code -ne 0) { throw "$app build failed, see $log" }
      Write-Host "  $app built"
    } finally { Pop-Location }
    Copy-Item (Join-Path $repo "apps\$app\build\app\outputs\flutter-apk\app-release.apk") (Join-Path $out "$($app.ToUpper())-beta.apk") -Force
  }
  Get-ChildItem $out | Format-Table Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
} finally {
  subst $drive /d
}
