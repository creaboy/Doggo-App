# Run with Windows PowerShell 5.1: powershell -NoProfile -File scripts/test-launcher-syntax.ps1
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot "start-dev.ps1"
$bytes = [System.IO.File]::ReadAllBytes($launcher)
if (@($bytes | Where-Object { $_ -gt 127 }).Count -gt 0) {
    throw "The launcher must stay ASCII so Windows PowerShell can read it without a BOM."
}

$source = [System.Text.Encoding]::ASCII.GetString($bytes)
$normalized = $source.Replace("`r`n", "`n")
foreach ($variant in @($normalized, $normalized.Replace("`n", "`r`n"))) {
    $parseErrors = $null
    $tokens = $null
    [System.Management.Automation.Language.Parser]::ParseInput($variant, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
        throw ($parseErrors | Out-String)
    }
}
Write-Output "PASS: launcher is ASCII and parses with both LF and CRLF line endings."
