<#
.SYNOPSIS
  SendLayer CLI installer for Windows.

.DESCRIPTION
  Downloads the latest sendlayer release, verifies its SHA256 checksum against
  the published SHA256SUMS, installs it under %LOCALAPPDATA%\Programs\sendlayer,
  and adds that directory to the user PATH.

  Windows counterpart to scripts/install.sh.

.EXAMPLE
  irm https://sendlayer.com/install.ps1 | iex

.EXAMPLE
  $env:SENDLAYER_VERSION = 'v0.2.0'; irm https://sendlayer.com/install.ps1 | iex

.EXAMPLE
  $env:SENDLAYER_INSTALL_DIR = 'C:\tools\sendlayer'; irm https://sendlayer.com/install.ps1 | iex
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows PowerShell 5.1 defaults to TLS 1.0, which github.com rejects.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }

$Repo = if ($env:SENDLAYER_REPO) { $env:SENDLAYER_REPO } else { 'SendLayer/sendlayer-cli' }
$BinName = 'sendlayer'

$InstallDir = if ($env:SENDLAYER_INSTALL_DIR) {
  $env:SENDLAYER_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\sendlayer'
}

# Only x64 binaries are published. Windows on ARM runs them under emulation.
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') {
  Write-Warn 'No native arm64 build yet; installing the x64 build (runs under emulation).'
} elseif ($arch -ne 'AMD64') {
  throw "Unsupported architecture: $arch"
}

# Resolve the version to install.
if ($env:SENDLAYER_VERSION) {
  $Version = $env:SENDLAYER_VERSION
} else {
  Write-Info 'Resolving latest version...'
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
      -Headers @{ 'User-Agent' = 'sendlayer-installer' }
    $Version = $release.tag_name
  } catch {
    throw "Could not resolve the latest version. Set `$env:SENDLAYER_VERSION='v0.X.Y' to bypass. ($_)"
  }
}
if (-not $Version) {
  throw "Could not resolve version. Set `$env:SENDLAYER_VERSION='v0.X.Y' to bypass."
}

$VersionBare = $Version -replace '^v', ''
$Archive = "sendlayer_${VersionBare}_windows_x64.zip"
$BaseUrl = "https://github.com/$Repo/releases/download/$Version"

Write-Info "Installing $BinName $Version for windows-x64"

$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("sendlayer-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp -Force | Out-Null

try {
  $ArchivePath = Join-Path $Temp $Archive
  $SumsPath = Join-Path $Temp 'SHA256SUMS'

  Write-Info "Downloading $BaseUrl/$Archive"
  Invoke-WebRequest -Uri "$BaseUrl/$Archive" -OutFile $ArchivePath -UseBasicParsing
  Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS" -OutFile $SumsPath -UseBasicParsing

  Write-Info 'Verifying checksum'
  $expectedLine = Get-Content $SumsPath | Where-Object { $_ -match "\s$([regex]::Escape($Archive))$" }
  if (-not $expectedLine) {
    throw "No checksum published for $Archive"
  }
  $expected = ($expectedLine -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    throw "Checksum mismatch for ${Archive}: expected $expected, got $actual"
  }

  Write-Info "Installing to $InstallDir"
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  # Expand-Archive will not overwrite in PS 5.1, so unpack to a staging dir
  # and copy over any previous install.
  $Stage = Join-Path $Temp 'stage'
  Expand-Archive -Path $ArchivePath -DestinationPath $Stage -Force
  Copy-Item -Path (Join-Path $Stage '*') -Destination $InstallDir -Recurse -Force

  # Add to the user PATH (persisted), skipping if already present.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  $onPath = $userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') }
  if (-not $onPath) {
    $newPath = if ($userPath.TrimEnd(';')) { $userPath.TrimEnd(';') + ';' + $InstallDir } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Info "Added $InstallDir to your user PATH."
    Write-Warn 'Open a new terminal for the PATH change to take effect.'
  }
  # Make it usable in the current session too.
  $env:Path = "$env:Path;$InstallDir"

  $exe = Join-Path $InstallDir "$BinName.exe"
  Write-Info "Installed to $exe"
  & $exe --version
} finally {
  Remove-Item -Path $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
