[CmdletBinding()]
param(
    [string]$StoragePath = (Join-Path $env:APPDATA 'Antigravity\app_storage.json'),
    [switch]$Enable
)

$ErrorActionPreference = 'Stop'
$DefaultStoragePath = Join-Path $env:APPDATA 'Antigravity\app_storage.json'

if (-not (Test-Path -LiteralPath $StoragePath -PathType Leaf)) {
    throw "Storage not found: $StoragePath"
}

if ([string]::Equals($StoragePath, $DefaultStoragePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    $running = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue
    if ($running) {
        throw 'Antigravity is running. Close it completely (including the tray icon) and retry.'
    }
}

$raw = [System.IO.File]::ReadAllText($StoragePath)
$json = $raw | ConvertFrom-Json
if ($null -eq $json) {
    throw "Unexpected storage format: $StoragePath"
}

$value = if ($Enable) { 'true' } else { 'false' }
$json | Add-Member -NotePropertyName 'autoCheckForUpdates' -NotePropertyValue $value -Force

$text = $json | ConvertTo-Json -Depth 100
$null = $text | ConvertFrom-Json

$backupPath = $StoragePath + '.bak'
if (-not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $StoragePath -Destination $backupPath
}

[System.IO.File]::WriteAllText($StoragePath, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "autoCheckForUpdates=$value"
Write-Host "Storage: $StoragePath"
Write-Host "Backup:  $backupPath"
Write-Host 'Restart Antigravity for the setting to take effect.'
