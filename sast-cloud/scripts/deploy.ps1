# deploy.ps1 — provision the SAST pipeline into your Learner Lab account.
# Prereqs: AWS CLI configured with current lab creds (see README step 2).
# Run from the sast-pipeline folder:  .\scripts\deploy.ps1
$ErrorActionPreference = 'Stop'

Write-Host "==> Verifying AWS credentials..." -ForegroundColor Cyan
aws sts get-caller-identity

Write-Host "==> Looking up LabRole ARN..." -ForegroundColor Cyan
$roleArn = (aws iam get-role --role-name LabRole --query Role.Arn --output text).Trim()
Write-Host "    LabRole = $roleArn"

Push-Location "$PSScriptRoot\..\infra"
try {
    terraform init -input=false
    terraform apply -auto-approve -var "lab_role_arn=$roleArn"
    Write-Host "`n==> Done. Your public scan endpoint:" -ForegroundColor Green
    terraform output -raw scan_endpoint
    Write-Host ""
}
finally {
    Pop-Location
}
