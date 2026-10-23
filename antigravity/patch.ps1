[CmdletBinding()]
param(
    [string]$Path = (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources\bin\language_server.exe'),
    [switch]$Restore,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BackupPath = $Path + '.orig-backup'
$DefaultPath = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources\bin\language_server.exe'
$FixBytes = [byte[]](0xC6, 0x40, 0x08, 0x01, 0x90, 0x90)
$GateLength = 15

function Find-GateOffsets {
    param([byte[]]$Bytes)

    $offsets = New-Object System.Collections.Generic.List[int]
    $start = 0
    $last = $Bytes.Length - $GateLength

    while ($start -le $last) {
        $i = [Array]::IndexOf($Bytes, [byte]0x80, $start)
        if ($i -lt 0 -or $i -gt $last) { break }

        if ($Bytes[$i + 1] -eq 0x78 -and
            $Bytes[$i + 2] -eq 0x08 -and
            $Bytes[$i + 3] -eq 0x00 -and
            $Bytes[$i + 4] -eq 0x74 -and
            $Bytes[$i + 6] -eq 0x48 -and
            $Bytes[$i + 7] -eq 0x8B -and
            $Bytes[$i + 9] -eq 0x24 -and
            $Bytes[$i + 11] -eq 0x48 -and
            $Bytes[$i + 12] -eq 0x89 -and
            $Bytes[$i + 14] -eq 0x60) {
            $offsets.Add($i)
            if ($offsets.Count -gt 1) { break }
        }

        $start = $i + 1
    }

    return $offsets
}

function Assert-Closed {
    if ([string]::Equals($Path, $DefaultPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $running = Get-Process -Name 'Antigravity', 'language_server*' -ErrorAction SilentlyContinue
        if ($running) {
            throw 'Antigravity is running. Close it completely (including the tray icon) and retry.'
        }
    }

    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $stream.Close()
    } catch {
        throw 'language_server.exe is in use. Close Antigravity completely and retry.'
    }
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "File not found: $Path"
}

if ($Restore) {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
        throw "Backup not found: $BackupPath"
    }
    Assert-Closed
    Copy-Item -LiteralPath $BackupPath -Destination $Path -Force
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    Write-Host 'Restored from backup.'
    Write-Host "SHA256: $hash"
    exit 0
}

$bytes = [System.IO.File]::ReadAllBytes($Path)
$offsets = @(Find-GateOffsets -Bytes $bytes)

if ($offsets.Count -gt 1) {
    throw "Gate signature is ambiguous ($($offsets.Count) matches). Aborting."
}

if ($offsets.Count -eq 0) {
    if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
        $backupBytes = [System.IO.File]::ReadAllBytes($BackupPath)
        $backupOffsets = @(Find-GateOffsets -Bytes $backupBytes)
        if ($backupOffsets.Count -eq 1) {
            $o = $backupOffsets[0]
            if ($bytes.Length -ge $o + 6 -and
                $bytes[$o] -eq 0xC6 -and
                $bytes[$o + 1] -eq 0x40 -and
                $bytes[$o + 2] -eq 0x08 -and
                $bytes[$o + 3] -eq 0x01 -and
                $bytes[$o + 4] -eq 0x90 -and
                $bytes[$o + 5] -eq 0x90) {
                Write-Host "Already patched (offset $o)."
                exit 0
            }
        }
    }
    throw 'Gate signature not found. This build is unsupported, or the file is patched without a backup.'
}

$offset = $offsets[0]
$version = (Get-Item -LiteralPath $Path).VersionInfo.FileVersion
if ([string]::IsNullOrWhiteSpace($version)) { $version = 'unknown' }

if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
    $backupHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash
    $currentHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($backupHash -ne $currentHash) {
        throw "A backup from a different build exists: $BackupPath. Move it away and retry."
    }
    $backupBytes = [System.IO.File]::ReadAllBytes($BackupPath)
    $backupOffsets = @(Find-GateOffsets -Bytes $backupBytes)
    if ($backupOffsets.Count -ne 1) {
        throw "Backup does not look like an original build: $BackupPath"
    }
}

Write-Host "Target: $Path"
Write-Host "Version: $version"
Write-Host "Gate offset: $offset"

if ($DryRun) {
    Write-Host 'Dry run: patch would be applied. No changes made.'
    exit 0
}

Assert-Closed

if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
    Copy-Item -LiteralPath $Path -Destination $BackupPath
    Write-Host "Backup: $BackupPath"
}

$stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
    $stream.Seek($offset, [System.IO.SeekOrigin]::Begin) | Out-Null
    $stream.Write($FixBytes, 0, $FixBytes.Length)
    $stream.Flush()
    $stream.Seek($offset, [System.IO.SeekOrigin]::Begin) | Out-Null
    $check = New-Object byte[] 6
    $stream.Read($check, 0, 6) | Out-Null
} finally {
    $stream.Close()
}

for ($i = 0; $i -lt 6; $i++) {
    if ($check[$i] -ne $FixBytes[$i]) {
        throw 'Verification failed after write. Restore from backup.'
    }
}

$hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
Write-Host 'Patched successfully.'
Write-Host "SHA256: $hash"
Write-Host 'Restore with: .\patch.ps1 -Restore'
