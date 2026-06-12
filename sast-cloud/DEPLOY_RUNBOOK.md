# Deploy Runbook (do this while recording)

> Open a **fresh PowerShell window** first — AWS CLI was just installed, and only
> a new terminal will have `aws` on its PATH. Verify with: `aws --version`

Working folder for every command below:
```powershell
cd "C:\Users\Ramandeep\Downloads\Cloud computing project\sast-pipeline"
```

---

## STEP 0 — One-time, BEFORE you hit record (setup, not filmed)

1. **Start the lab fresh** in AWS Academy and wait for the green dot. (Sessions
   last ~4 h, then a `voc-cancel-cred` deny policy blocks everything — so record
   in one sitting right after starting.)
2. **Paste lab creds** into `C:\Users\Ramandeep\.aws\credentials`
   (AWS Academy → AWS Details → AWS CLI: Show → copy the `[default]` block).
3. **Allow scripts in this window** (Windows blocks unsigned `.ps1` by default):
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
   ```
4. Confirm creds work:
   ```powershell
   aws sts get-caller-identity
   ```
   You should see an Account number and a `...:role/...` ARN. If it errors with
   `ExpiredToken` or `voc-cancel-cred`, restart the lab and re-paste a fresh block.

> Optional but recommended: run STEP 2 (`deploy.ps1`) ONCE before recording so the
> resources already exist. Then during the video your `terraform apply` is quick
> (it shows "No changes" or a fast re-apply), and `test-live.ps1` returns instantly.
> If you'd rather film a full from-scratch build, run `.\scripts\destroy.ps1` first.

---

## STEP 1 — (filmed) Show the code: reuse + handler  ⏱ ~45s
- Show `src/sast/scanner.js` → "Professor's scanner, **reused unchanged**."
- Show `src/sast/index.mjs` → "My thin Lambda handler — Lambda is event-driven so
  instead of his Express server, this reads the request, calls his `scanCode()`,
  stores results in DynamoDB, returns JSON."
- Show `infra/main.tf` → point at DynamoDB, Lambda, API Gateway, CloudWatch log group.

## STEP 2 — (filmed) Deploy with Terraform  ⏱ ~60s
```powershell
.\scripts\deploy.ps1
```
Narrate: "This is Infrastructure as Code — Terraform creates DynamoDB, the Lambda,
the API Gateway, and the log group in one command." At the end it prints your
**public scan endpoint** — read it out.

## STEP 3 — (filmed) Live scan across dev / staging / prod  ⏱ ~90s
```powershell
.\scripts\test-live.ps1
```
Narrate each result:
- **dev** → 7 findings (4 HIGH): hardcoded secret, SQL injection, XSS, eval.
- **staging** → 1 finding — "team fixed the HIGH issues."
- **prod** → HIGH "Hardcoded password" **reappears** — "a bad merge brought back a
  vulnerability that was fixed in staging. This reappearing finding across
  environments is the **regression** our tracker is built to catch. The diff
  engine that auto-flags it is Milestone 2."

## STEP 4 — (filmed) Prove it's real in the AWS Console  ⏱ ~45s
- **DynamoDB** → Tables → `sast-tracker-ScanResults` → **Explore table items** →
  show the stored rows (`jobId`, `envScanType` = `dev#SAST` / `prod#SAST`, the
  vulnerabilities, durationMs).
- **CloudWatch** → Log groups → `/aws/lambda/sast-tracker-scanner` → newest stream
  → show a `scan_complete` JSON log line (duration + finding count).

## STEP 5 — (filmed) Closing  ⏱ ~30s
"My SAST slice is deployed and working: a public endpoint that scans code and
stores findings per environment. Next, for Milestone 2: S3 for uploaded code, the
diff/regression engine, SNS alerts on HIGH regressions, and integrating with
Amrit's Pentest results."

---

## AFTER recording — tear down (save budget)
```powershell
.\scripts\destroy.ps1
```

## Quick reference
| Thing | Value |
|---|---|
| Submit file name | `Singh_Ramandeep_VideoMilestone.mp4` |
| Length | 4–6 min (strict — outside = −5 pts) |
| Region | us-east-1 |
| Scan endpoint | printed by `deploy.ps1` (ends in `/scan`) |
| DynamoDB table | `sast-tracker-ScanResults` |
| Log group | `/aws/lambda/sast-tracker-scanner` |
