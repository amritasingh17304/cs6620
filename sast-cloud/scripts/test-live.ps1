# test-live.ps1 — POST the three sample app versions to the live API and show
# the findings. Demonstrates the full cloud path: API Gateway -> Lambda -> DynamoDB.
# Run after deploy.ps1:  .\scripts\test-live.ps1
$ErrorActionPreference = 'Stop'

Push-Location "$PSScriptRoot\..\infra"
$endpoint = (terraform output -raw scan_endpoint).Trim()
$table    = (terraform output -raw scan_results_table).Trim()
Pop-Location

Write-Host "Scan endpoint: $endpoint`n" -ForegroundColor Cyan

# Ordered so the demo runs dev -> staging -> prod.
$envs = [ordered]@{ 'app-dev.js' = 'dev'; 'app-staging.js' = 'staging'; 'app-prod.js' = 'prod' }
foreach ($file in $envs.Keys) {
    $env = $envs[$file]
    # Read as a clean .NET string. (Get-Content -Raw piped into ConvertTo-Json
    # can be mangled into an object by Windows PowerShell 5.1, so we avoid it.)
    $code = [System.IO.File]::ReadAllText("$PSScriptRoot\..\samples\$file")
    $json = @{ code = $code; filename = $file; env = $env } | ConvertTo-Json -Compress
    # Send explicit UTF-8 bytes so non-ASCII characters survive the request.
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    Write-Host "==> Scanning $file as env=$env" -ForegroundColor Yellow
    $resp = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes
    Write-Host "    jobId=$($resp.jobId)  persisted=$($resp.persisted)"
    Write-Host "    findings: total=$($resp.summary.totalVulnerabilities) HIGH=$($resp.summary.high) MEDIUM=$($resp.summary.medium) LOW=$($resp.summary.low)"
    $resp.vulnerabilities | ForEach-Object { Write-Host "      [$($_.severity)] $($_.name) (line $($_.line))" }
    Write-Host ""
}

Write-Host "==> Total rows now stored in DynamoDB table '$table':" -ForegroundColor Green
aws dynamodb scan --table-name $table --select COUNT --query "Count"
