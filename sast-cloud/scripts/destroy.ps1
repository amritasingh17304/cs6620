# destroy.ps1 — tear everything down (the "golden rule" at end of a lab session).
# Run from the sast-pipeline folder:  .\scripts\destroy.ps1
$ErrorActionPreference = 'Stop'

$roleArn = (aws iam get-role --role-name LabRole --query Role.Arn --output text).Trim()

Push-Location "$PSScriptRoot\..\infra"
try {
    terraform destroy -auto-approve -var "lab_role_arn=$roleArn"
    Write-Host "`n==> All SAST resources destroyed." -ForegroundColor Green
}
finally {
    Pop-Location
}
