# Installs dist/Pigmento Setup <version>.exe for the current user, smoke-tests the installed app
# (tests/installed, with a temporary profile, so %APPDATA%\Pigmento is never touched), checks a
# real double-click through Windows' file association, then uninstalls and checks nothing is left.
# Run `npm run dist` first. Usage: powershell -File scripts/smoke-installed.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$setup = Join-Path (Resolve-Path dist) "Pigmento Setup $version.exe"
$dir = Join-Path $env:LOCALAPPDATA 'Programs\Pigmento'
$exe = Join-Path $dir 'Pigmento.exe'
$results = [ordered]@{}
function Check($name, $ok) { $script:results[$name] = [bool]$ok; if (-not $ok) { Write-Host "FAIL: $name" } }

if (Test-Path $exe) { throw "Pigmento is already installed in $dir; uninstall it first." }
if (-not (Test-Path $setup)) { throw "$setup not found: run npm run dist." }

# 1. Install (silent, per user).
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Check 'installed exe' (Test-Path $exe)
Check '.pigm associated' ((Get-ItemProperty 'HKCU:\Software\Classes\.pigm' -ErrorAction SilentlyContinue).'(default)' -ne $null)
Check 'Open with: .png' ((Get-ItemProperty 'HKCU:\Software\Classes\.png\OpenWithProgids' -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'Pigmento.Image')
Check 'Start menu shortcut' (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Pigmento.lnk'))
Check 'desktop shortcut' (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pigmento.lnk'))
$uninstallKey = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -eq 'Pigmento' }
Check 'listed in Installed apps' ($null -ne $uninstallKey)

try {
  # 2. The installed app, as Windows launches it (it leaves a project to double-click).
  $profile = Join-Path $env:TEMP ("pigmento-shell-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $profile | Out-Null
  $env:PIGMENTO_SMOKE_OUT = $profile
  npx playwright test --config playwright.installed.config.ts --reporter=line
  Check 'installed app smoke tests' ($LASTEXITCODE -eq 0)

  # 3. A real double-click: Windows opens a .pigm with Pigmento (with a temporary profile).
  Remove-Item Env:PIGMENTO_SMOKE_OUT
  $file = Join-Path $profile 'double-click.pigm'
  Check 'project left for double-click' (Test-Path $file)
  $env:PIGMENTO_USER_DATA = $profile
  Start-Process -FilePath $file
  $title = ''
  for ($i = 0; $i -lt 40 -and -not $title; $i++) {
    Start-Sleep -Milliseconds 500
    $title = (Get-Process Pigmento -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*double-click*' } | Select-Object -First 1).MainWindowTitle
  }
  Check 'double-click opens the project' ($title -like '*double-click*')
  Get-Process Pigmento -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item Env:PIGMENTO_USER_DATA
  Start-Sleep -Milliseconds 800
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
finally {
  # 4. Uninstall (silent) and check nothing is left behind.
  $uninstaller = Join-Path $dir 'Uninstall Pigmento.exe'
  if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait }
  for ($i = 0; $i -lt 20 -and (Test-Path $exe); $i++) { Start-Sleep -Milliseconds 500 }
  Check 'uninstalled: program removed' (-not (Test-Path $exe))
  Check 'uninstalled: Open with removed' (-not ((Get-ItemProperty 'HKCU:\Software\Classes\.png\OpenWithProgids' -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'Pigmento.Image'))
  Check 'uninstalled: image type removed' (-not (Test-Path 'HKCU:\Software\Classes\Pigmento.Image'))
  Check 'uninstalled: .pigm association removed' ((-not (Test-Path 'HKCU:\Software\Classes\.pigm')) -and (-not (Test-Path 'HKCU:\Software\Classes\Pigmento.Project')))
  Check 'uninstalled: shortcuts removed' (-not (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Pigmento.lnk')) -and -not (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pigmento.lnk')))
  Check 'uninstalled: not listed' ($null -eq (Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -eq 'Pigmento' }))
  $results.GetEnumerator() | ForEach-Object { '{0,-40} {1}' -f $_.Key, $(if ($_.Value) { 'ok' } else { 'FAILED' }) }
  if ($results.Values -contains $false) { exit 1 }
}
