# SAST Pipeline — Multi‑Stage Security Regression Tracker

> **CS6620 Cloud Computing · Group 18 · Milestone 1 (individual)**
> **Owner:** Ramandeep Singh — the **SAST (static code‑scanning) pipeline**
> Teammate **Amrit** owns the Pentest / Docker / Fargate half (built separately).

A serverless AWS service that scans source code for security vulnerabilities and
stores the findings **per environment** (`dev` / `staging` / `prod`). Because every
scan is persisted and tagged by environment, the system can later detect a security
**regression** — a vulnerability that was fixed in one environment but reappears in
another (e.g. a hardcoded password removed in staging but live again in prod).

A user `POST`s code to a public URL → an AWS Lambda runs a static analyzer →
findings are saved in DynamoDB and logged to CloudWatch → results return as JSON.

---

## Table of contents
- [Architecture](#architecture)
- [What I reused vs. built](#what-i-reused-vs-built)
- [The key design decision: why a Lambda handler](#the-key-design-decision-why-a-lambda-handler)
- [DynamoDB schema](#dynamodb-schema)
- [How the proposal feedback is addressed](#how-the-professors-proposal-feedback-is-addressed)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [How dev/staging/prod works](#how-devstagingprod-works)
- [Project structure](#project-structure)
- [Cost](#cost)
- [Security note](#security-note)
- [Troubleshooting](#troubleshooting)
- [Milestone 2 roadmap](#milestone-2-roadmap)

---

## Architecture

```
 Client (PowerShell / curl / CI pipeline)
        │  HTTPS  POST /scan   { code, filename, env }
        ▼
 ┌─────────────────────┐
 │  API Gateway (HTTP) │   public "front door"  (replaces the local Express server)
 └─────────┬───────────┘
           │  AWS_PROXY (event)
           ▼
 ┌─────────────────────┐
 │  Lambda  index.mjs  │   thin, event-driven handler
 │   └ calls scanner.js│   the professor's regex engine, REUSED UNCHANGED
 └─────────┬───────────┘
           │
   ┌───────┴────────┐
   ▼                ▼
 ┌──────────────┐  ┌──────────────────┐
 │  DynamoDB    │  │  CloudWatch Logs │
 │ ScanResults  │  │ scan_complete:   │
 │ (per env)    │  │ duration,#findings│
 └──────────────┘  └──────────────────┘
```

Every resource is defined in **Terraform** (`infra/`) — one command to build, one to destroy.

---

## What I reused vs. built

| Layer | File | Source |
|---|---|---|
| Vulnerability engine — `scanCode(code, filename)` | `src/sast/scanner.js` | Professor's repo, **unchanged** |
| Event-driven Lambda handler | `src/sast/index.mjs` | **Mine** |
| Infrastructure (DynamoDB, Lambda, API GW, CloudWatch) | `infra/*.tf` | **Mine** |
| 3 environment code versions | `samples/app-{dev,staging,prod}.js` | **Mine** |
| Local + live test / deploy / teardown | `scripts/*` | **Mine** |

Provided repo: <https://github.com/aanchan/cs6620> (the `sast/backend` tool). The
scanner detects 10 vulnerability classes (hardcoded secrets, SQL/NoSQL injection,
XSS, path traversal, insecure functions like `eval`, weak crypto, etc.).

---

## The key design decision: why a Lambda handler

The professor's `server.js` is an **always‑on Express server** (`app.listen(3000)`).
AWS Lambda is **event‑driven** — there is no port and no persistent process; AWS
invokes the function for a single request and then it sleeps. So instead of running
his server, I wrote a thin adapter, `index.mjs`, that:

1. reads the code from the API Gateway event,
2. calls the **unchanged** `scanCode()` from `scanner.js`,
3. persists the findings to DynamoDB (wrapped in try/catch so a storage failure
   still returns results — graceful degradation),
4. logs a structured `scan_complete` line to CloudWatch and returns JSON.

> **Reused the brain; replaced only the hosting layer.**

**Why Lambda (not a container)?** The scan is regex pattern‑matching that finishes
in milliseconds — nowhere near Lambda's 15‑minute limit — so a cheap, auto‑scaling,
pay‑per‑use zip Lambda is the ideal fit. The heavy, slow work (live‑URL pentesting)
is the part the teammate containerizes on Fargate.

---

## DynamoDB schema

**`ScanResults`** — one row per scan
| Key | Attribute | Example | Purpose |
|---|---|---|---|
| Partition key | `jobId` (S) | `870b34ce-…` | unique id for the scan run |
| Sort key | `envScanType` (S) | `prod#SAST` | `"<env>#<scanType>"` — lets us compare the same scan type across environments |

Other attributes: `env`, `scanType`, `filename`, `scannedAt`, `durationMs`,
`summary` (counts by severity), `vulnerabilities` (the full findings list).

**`Environments`** — `envId` (S) partition key, for registering `dev`/`staging`/`prod`.

Both tables are **on‑demand (PAY_PER_REQUEST)** — zero idle cost.

---

## How the professor's proposal feedback is addressed

| # | Feedback | How this slice answers it |
|---|---|---|
| 1 | Use Infrastructure as Code | Everything in Terraform (`infra/`) — repeatable build/teardown |
| 2 | Each member owns a portion | SAST = me; Pentest/Docker = Amrit (clearly separate services) |
| 3 | Split SAST/Pentest; mind the 15‑min Lambda limit | SAST is ms‑fast regex → a zip Lambda is correct; the slow pentest is the container |
| 4 | No 3 real code versions — how simulate environments? | 3 versions of one app (`samples/`) + an `env` label on each scan |
| 5 | Job failure / retry / notification | DynamoDB write is try/catch → returns `persisted:false` on failure; full retry + SNS alerts in M2 |
| 6 | CloudWatch monitoring | Dedicated log group with retention; each scan logs duration + finding counts |
| 7 | DynamoDB schema | `ScanResults` (PK `jobId`, SK `envScanType`) + `Environments` (PK `envId`) |

---

## Prerequisites

- **AWS CLI v2**, **Terraform ≥ 1.5**, **Node.js** (all installed for this project)
- An **AWS Academy Learner Lab** session with current credentials
- Region **us‑east‑1**; you **cannot create IAM roles** — the Lambda reuses the
  pre‑made **`LabRole`** as its execution role

---

## Quick start

```powershell
# 0. From the project root
cd "C:\Users\<you>\Downloads\Cloud computing project\sast-pipeline"

# 1. (FREE, no AWS) prove the scanner works locally
node scripts/local-test.mjs

# 2. Load this session's Learner Lab creds into ~/.aws/credentials, then verify
aws sts get-caller-identity

# 3. Allow scripts in this window (Windows blocks unsigned .ps1 by default)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# 4. Deploy everything (prints your public URL)
.\scripts\deploy.ps1

# 5. Run the live demo: scans dev/staging/prod, stores results in DynamoDB
.\scripts\test-live.ps1

# 6. Tear it all down when finished
.\scripts\destroy.ps1
```

Expected from step 5:

```
app-dev.js     (dev)      total=7  HIGH=4 MEDIUM=3
app-staging.js (staging)  total=1  MEDIUM=1
app-prod.js    (prod)     total=2  HIGH=1 MEDIUM=1   ← the HIGH "Hardcoded Secret" regression
Total rows now stored in DynamoDB: 3
```

---

## How dev/staging/prod works

There is **one** pipeline (one Lambda, one API, one database). An "environment" is a
**label** (`env`) sent with each scan — not separate infrastructure. This mirrors
real CI/CD, where one scanning service runs against code from every stage and tags
the results.

- `samples/app-dev.js` → 7 findings (the messy version)
- `samples/app-staging.js` → 1 finding (serious issues fixed)
- `samples/app-prod.js` → 2 findings — a HIGH bug **regressed** back in

In a real pipeline these three scans happen at different times as code is promoted;
the demo fires them back‑to‑back so the comparison is visible in one run. The
automatic diff that *flags* the regression is **Milestone 2**.

---

## Project structure

```
sast-pipeline/
├─ src/sast/
│  ├─ scanner.js        # professor's engine — UNCHANGED
│  ├─ index.mjs         # my event-driven Lambda handler
│  └─ package.json      # marks the folder as ESM ("type":"module")
├─ infra/
│  ├─ versions.tf       # providers (aws, archive)
│  ├─ variables.tf      # region, project_name, lab_role_arn, log retention
│  ├─ main.tf           # DynamoDB ×2, Lambda, API Gateway, CloudWatch
│  ├─ outputs.tf        # public scan endpoint + resource names
│  └─ terraform.tfvars.example
├─ samples/             # app-dev/staging/prod.js + the provided test-vulnerable.js
├─ scripts/
│  ├─ local-test.mjs    # free local scan (no AWS)
│  ├─ deploy.ps1        # terraform init + apply
│  ├─ test-live.ps1     # POST the 3 versions to the live API
│  └─ destroy.ps1       # terraform destroy
├─ README.md
├─ DEPLOY_RUNBOOK.md    # step-by-step recording runbook
└─ VIDEO_SCRIPT.md      # 4–6 min narration script
```

---

## Cost

Lambda + DynamoDB (on‑demand) + HTTP API are pay‑per‑use and **cost ~nothing while
idle**. A full demo run is a few **cents** — far under the $50 Learner Lab budget.
Run `.\scripts\destroy.ps1` at the end of a session as good hygiene.

---

## Security note

For the demo the `/scan` endpoint is **public with no authentication** — convenient
for testing. For production I would attach API‑key or AWS IAM authorization to the
route (a small API Gateway change). Custom IAM roles aren't used because the Learner
Lab forbids creating them; the Lambda reuses the provided `LabRole`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `running scripts is disabled on this system` | Windows execution policy blocks `.ps1` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` |
| `aws : not recognized` | AWS CLI just installed; old terminal | Open a **new** PowerShell window |
| `ExpiredToken` / `InvalidClientTokenId` | Lab creds expired (~4 h) | Re‑paste a fresh `[default]` block into `~/.aws/credentials` |
| `explicit deny … policy/voc-cancel-cred` | Lab **session ended** — AWS Academy attaches a deny‑all policy | Click **Start Lab** again, refresh creds; resources/data are NOT deleted |
| Scan returns `total=0` from PowerShell | Win PS 5.1 `ConvertTo-Json` mangles `Get-Content -Raw` strings into objects | Read files with `[IO.File]::ReadAllText` and send UTF‑8 bytes (already done in `test-live.ps1`) |
| `{"message":"Not Found"}` in a browser | Browser sends GET `/`; only `POST /scan` exists | Expected — call it with a POST (use `test-live.ps1`) |

---

## Milestone 2 roadmap

- **Regression diff engine** — read all environments' rows and automatically flag a
  vulnerability present in a later env but fixed in an earlier one.
- **SNS alerts** on HIGH‑severity regressions; retries on failed jobs.
- **S3** for uploaded code zips and stored reports.
- **CloudWatch dashboard** (scan duration, finding trends) + alarms.
- **Integration** with Amrit's Pentest (Fargate) results into a shared schema.
