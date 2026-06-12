# Multi-Stage Security Regression Tracker — Complete Project Guide

CS6620 Cloud Computing · Group 18 · Amrita Thakur (Pentest pipeline) & Ramandeep (SAST pipeline)

This is the definitive guide to the whole system: what it does, every file and why it
exists, the end-to-end call flows, every function, the design decisions we made (and the
alternatives), the errors we hit and how we fixed them, cost management, and what we would
improve. Read top-to-bottom to understand the project start to finish.

---

## Table of Contents
1. [What the project is](#1-what-the-project-is)
2. [The problem & the idea](#2-the-problem--the-idea)
3. [High-level architecture](#3-high-level-architecture)
4. [The provided foundation (professor's code)](#4-the-provided-foundation)
5. [Why each AWS service (justifications)](#5-why-each-aws-service)
6. [Repository structure — every file explained](#6-repository-structure)
7. [End-to-end call flows](#7-end-to-end-call-flows)
8. [The shared data model (DynamoDB schema)](#8-the-shared-data-model)
9. [Function-by-function reference](#9-function-by-function-reference)
10. [Key design decisions & alternatives](#10-key-design-decisions)
11. [Errors we hit & how we fixed them](#11-errors-we-hit--how-we-fixed-them)
12. [Cost / budget management](#12-cost--budget-management)
13. [What could be better (future work)](#13-what-could-be-better)
14. [Deploy-from-scratch runbook](#14-deploy-from-scratch-runbook)
15. [Demo script](#15-demo-script)

---

## 1. What the project is

A **cloud security platform** on AWS that scans an application's three environments
(**dev → staging → prod**) with two complementary kinds of security testing and detects
**regressions** — a vulnerability that was fixed in an earlier environment but reappears
(or a new one is introduced) in a later one.

- **SAST** (Static Application Security Testing) — reads source **code** for vulnerabilities.
- **Pentest** (dynamic) — probes the **running** application over HTTP for weaknesses.

Both write their findings to a **shared database**; a **diff engine** compares results
across environments and **alerts** the team (email) when a HIGH-severity regression appears.

---

## 2. The problem & the idea

As code is promoted dev → staging → prod, security fixes don't always carry across. A fix
made in staging can be missing in prod (a bad merge, a config drift, a rushed hotfix). These
**security regressions** often go unnoticed until they're exploited.

Our platform makes regressions **visible automatically**: scan every environment with both a
static and a dynamic tool, store everything together, and diff across environments to flag
anything that's worse in a later environment than an earlier one.

**Why two tools?** They catch different classes of issue:

| | SAST (static) | Pentest (dynamic) |
|---|---|---|
| Looks at | source code | the running app |
| Catches | code-level flaws (hardcoded secrets, injection patterns, weak crypto) | runtime/config flaws (missing security headers, no rate limiting, data exposure) |
| Speed | very fast | slower (real HTTP calls) |

Using both gives comprehensive coverage — and lets us demonstrate **two kinds of regression**
(a code regression and a runtime regression) in the same platform.

---

## 3. High-level architecture

```
        ┌──────────────────────────────────────────────────────────────────────┐
        │  3 environments of ONE sample app:  dev   staging   prod               │
        └──────────────────────────────────────────────────────────────────────┘
              │ (source code)                         │ (running deployment / URL)
              ▼                                        ▼
   ┌─────────────────────────┐              ┌────────────────────────────────────┐
   │  SAST pipeline (Lambda)  │              │  Pentest pipeline (ECS Fargate)     │
   │  API Gateway → Lambda    │              │  one task = target + scanner        │
   │  → scanCode()            │              │  containers (share localhost)       │
   └─────────────┬───────────┘              └───────────────────┬────────────────┘
                 │ writes findings                               │ writes findings
                 ▼                                               ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │   Shared DynamoDB table:  regression-tracker-ScanResults                 │
        │   PK jobId,  SK envScanType ("<env>#<scanType>", e.g. "prod#SAST")       │
        └────────────────────────────────────────┬───────────────────────────────┘
                                                  │ read by
                                                  ▼
                            ┌───────────────────────────────────────────┐
                            │  Diff engine (Lambda)  GET /regressions     │
                            │  compares envs per tool → finds regressions │
                            └───────────────────┬─────────────────────────┘
                                                │ HIGH regression
                                                ▼
                            ┌───────────────────────────────────────────┐
                            │  SNS topic  →  email both teammates         │
                            └───────────────────────────────────────────┘
   Everything is defined as Infrastructure-as-Code (Terraform). Runs in AWS Academy
   Learner Lab; all roles reuse the pre-provided "LabRole".
```

**Three independent Terraform stacks**, each in its own folder, deployed into **one AWS
account**, all writing to / reading from the one shared table:
- `sast-cloud/infra` — SAST Lambda + API Gateway + the shared DynamoDB tables.
- `pentest/infra` — ECS cluster + the two-container Fargate task.
- `integration/infra` — diff-engine Lambda + API Gateway + SNS topic.

---

## 4. The provided foundation

The course provided a base repo (`github.com/aanchan/cs6620`) with two Node.js/Express tools
we had to **build on top of, not rewrite**.

### `sast/backend/scanner.js` — the SAST engine ("the brain")
Pure regex pattern-matching over source text. `scanCode(code, filename)` returns an array of
findings. Detects 10 vulnerability types: hardcoded secrets, SQL injection, NoSQL injection,
XSS, path traversal, insecure functions (`eval`/`exec`), hardcoded IPs, weak randomness
(`Math.random`), sensitive-data logging, weak crypto (MD5/SHA1), and security TODOs.
**We reuse this file unchanged** (copied into `sast-cloud/src/sast/scanner.js`).

### `pentest/backend/tester.js` — the Pentest engine ("the brain")
`runAllTests(targetUrl)` makes real HTTP requests to a URL and runs 6 tests: missing
authentication, SQL injection, NoSQL injection, rate limiting, security headers, sensitive
data exposure. Each returns PASS/FAIL/WARNING/ERROR. **We reuse this file unchanged.**

### `pentest/backend/test-target.js` — a deliberately vulnerable app
An Express API (port 4000) with endpoints that expose vulnerabilities, used as the scan
target. **We extended it** (see §6) to toggle its security posture via env vars so it can
represent dev/staging/prod.

### `pentest/backend/server.js` / `sast/backend/server.js` — local HTTP wrappers
Express servers that expose the engines locally. We do **not** use these in the cloud — they
are an always-on model that doesn't fit serverless (see §10).

---

## 5. Why each AWS service

| Service | Used for | Why this one |
|---|---|---|
| **AWS Lambda** | SAST scanner, diff engine | Event-driven, millisecond jobs, pay-per-invoke, auto-scales. SAST is fast regex work that finishes in ms — a perfect fit. |
| **ECS Fargate** | Pentest scanner + target | Serverless **containers** (satisfies the "use Docker" requirement). Pentest makes many HTTP calls, can run longer, and needs full networking — no 15-min Lambda cap. |
| **Amazon ECR** | Stores the pentest Docker images | Fargate pulls images from a registry; ECR is the AWS-native one. |
| **DynamoDB** | Shared `ScanResults` + `Environments` tables | Fast, schemaless, **pay-per-request** (≈$0 idle). Ideal for storing scan results keyed by job/env. |
| **API Gateway (HTTP API)** | Public endpoints for SAST `/scan` and diff `/regressions` | Managed HTTPS front door; replaces the local Express server. |
| **SNS** | Email alerts on HIGH regressions | Simple pub/sub; email subscribers; free tier covers our volume. |
| **CloudWatch (Logs + Container Insights)** | Logs + metrics for every component | Built-in observability; Container Insights gives CPU/memory/task metrics for Fargate. |
| **IAM `LabRole`** | Execution/task role for everything | Learner Lab forbids creating IAM roles, so all components reuse the provided `LabRole`. |

**Why NOT EC2:** EC2 bills per hour even when idle and you manage the OS/scaling. Our work is
short, on-demand jobs — serverless (Lambda/Fargate) bills only while running and needs no
server management, which protects the $50 Learner Lab budget.

---

## 6. Repository structure

```
cs6620/
├── sast/                         # professor's original base (kept as-is for reference)
├── pentest/                      # Amrita's pentest pipeline
│   ├── backend/
│   │   ├── tester.js             # PROVIDED engine (6 tests) — reused unchanged
│   │   ├── server.js             # PROVIDED local Express server — not used in cloud
│   │   ├── test-target.js        # PROVIDED vulnerable app — EXTENDED with env toggles
│   │   ├── run-scan.mjs           # NEW: one-shot launcher (container entrypoint)
│   │   ├── Dockerfile             # NEW: packages the scanner image
│   │   ├── Dockerfile-target      # NEW: packages the target image
│   │   ├── .dockerignore          # NEW: keeps images small
│   │   └── package.json           # PROVIDED + added @aws-sdk/* for DynamoDB writes
│   └── infra/                     # NEW: Terraform for the pentest pipeline
│       ├── providers.tf           #   AWS provider + region
│       ├── variables.tf           #   region, LabRole, image URIs, target URL, table, env
│       ├── network.tf             #   default VPC/subnet lookup + egress-only security group
│       ├── ecs.tf                 #   log group, cluster (+Container Insights), task definition
│       └── outputs.tf             #   cluster, subnet, SG, and a ready-to-run run-task command
├── sast-cloud/                   # Ramandeep's SAST pipeline
│   ├── src/sast/
│   │   ├── scanner.js             # PROVIDED engine — reused unchanged
│   │   ├── index.mjs              # NEW: Lambda handler (adapter for scanner.js)
│   │   └── package.json           # NEW: marks ES module
│   ├── infra/                     # NEW: Terraform for SAST
│   │   ├── versions.tf            #   providers (aws + archive)
│   │   ├── variables.tf           #   region, project_name, lab_role_arn, log retention
│   │   ├── main.tf                #   Lambda + API Gateway + 2 DynamoDB tables + log group
│   │   └── outputs.tf             #   scan endpoint, table names, lambda name
│   ├── samples/
│   │   ├── app-dev.js             # dev version (many code vulns)
│   │   ├── app-staging.js         # staging version (most vulns fixed)
│   │   ├── app-prod.js            # prod version (a HIGH vuln REGRESSED back)
│   │   └── test-vulnerable.js     # extra sample input
│   └── scripts/
│       ├── local-test.mjs         # run scanner locally on the 3 samples (free)
│       ├── deploy.ps1             # one-command deploy
│       ├── test-live.ps1          # POST the 3 samples to the live API
│       └── destroy.ps1            # one-command teardown
├── integration/                  # the joint integration layer (diff engine)
│   ├── src/diff/
│   │   └── index.mjs              # NEW: regression diff Lambda
│   └── infra/                     # NEW: Terraform
│       ├── versions.tf            #   providers
│       ├── variables.tf           #   region, table name, alert emails
│       ├── main.tf                #   diff Lambda + API Gateway + SNS topic/subscriptions
│       └── outputs.tf             #   /regressions endpoint, topic ARN
├── docs/PROJECT_GUIDE.md         # this document
├── .gitignore                    # ignores node_modules, .terraform, state, build artifacts
└── README.md                     # professor's project brief
```

### Why each NEW file was introduced
- **`run-scan.mjs`** — Lambda has a handler; a container just runs a command. `server.js`
  is an always-on server (wrong for a one-shot job), so we wrote a launcher that runs the
  scan **once**, prints findings, writes to DynamoDB, and exits. It's the container's entrypoint.
- **`Dockerfile` / `Dockerfile-target`** — package the scanner and the target into images so
  Fargate can run them. (Two separate recipes for two separate images.)
- **`.dockerignore`** — excludes `node_modules`, `.git`, the target file, etc., so the
  scanner image stays small and clean.
- **SAST `index.mjs`** — the Lambda adapter: parses the API request, calls `scanCode()`,
  writes to DynamoDB, returns JSON. (Same role `server.js` played locally, but in Lambda's shape.)
- **diff `index.mjs`** — the regression engine (new logic, see §9).
- **All `infra/*.tf`** — Infrastructure as Code so the whole system is repeatable and
  version-controlled (directly addresses the professor's #1 feedback).

---

## 7. End-to-end call flows

### A) SAST scan
```
caller (test-live.ps1 / curl)
   │ POST /scan { code, filename, env }
   ▼
API Gateway (HTTP API)
   ▼
SAST Lambda  index.handler(event)
   ├─ parse body → code, env, scanType="SAST"
   ├─ scanCode(code, filename)          ← provided engine
   ├─ build summary (high/medium/low counts)
   ├─ PutItem → DynamoDB ScanResults  (jobId, "<env>#SAST", vulnerabilities[])
   └─ return JSON { summary, vulnerabilities }
```

### B) Pentest scan
```
operator: aws ecs run-task (with per-env overrides: SECURE_HEADERS/RATE_LIMIT, SCAN_ENV)
   ▼
ECS Fargate task starts TWO containers in one network namespace:
   ├─ test-target  (listens on localhost:4000, security posture set by env vars)
   └─ pentest-scanner  runs run-scan.mjs:
        ├─ runAllTests("http://localhost:4000/api/users")   ← provided engine
        ├─ build summary (passed/failed/warnings)
        ├─ PutItem → DynamoDB ScanResults  (jobId, "<env>#PENTEST", findings[])
        └─ print findings to stdout → CloudWatch Logs
   scanner is the "essential" container → when it exits, the whole task stops.
```

### C) Regression diff
```
caller: GET /regressions
   ▼
API Gateway → diff Lambda index.handler()
   ├─ Scan DynamoDB ScanResults (all rows)
   ├─ keep the LATEST row per "<env>#<scanType>"
   ├─ for each scanType, for each adjacent env pair (dev→staging, staging→prod):
   │     issues_in_later_not_in_earlier  = REGRESSION
   ├─ if any HIGH regression → SNS Publish → email both teammates
   └─ return JSON { totalRegressions, highRegressions, alerted, regressions[] }
```

---

## 8. The shared data model

**Table `regression-tracker-ScanResults`** (DynamoDB, pay-per-request):

| Attribute | Example | Role |
|---|---|---|
| `jobId` (PK) | `a1b2c3…` (UUID) | unique per scan |
| `envScanType` (SK) | `prod#SAST` | environment + tool — the key the diff engine groups by |
| `env` | `prod` | dev / staging / prod |
| `scanType` | `SAST` or `PENTEST` | which tool produced it |
| `summary` | `{high, medium, low}` or `{passed, failed, …}` | counts |
| `vulnerabilities` (SAST) / `findings` (PENTEST) | `[…]` | the actual issues |
| `scannedAt`, `durationMs` | ISO time, ms | metadata |

**Why this schema:** keying by `jobId` makes every scan a unique row; the `env#scanType`
sort key lets the diff engine quickly group "the latest prod SAST scan", etc. Crucially,
**`scanType` is parameterized** so the *same* table holds both tools' results — that single
decision is what makes the two pipelines integrate.

There is also an `Environments` table (PK `envId`) reserved for registering environments
(future UI), included to fully implement the proposed schema.

---

## 9. Function-by-function reference

### `sast-cloud/src/sast/scanner.js` (provided, unchanged)
- `scanCode(code, filename)` → runs every regex rule over the text, returns an array of
  findings `{id, name, severity, description, file, line, column, evidence}`, sorted by severity.
- `scanFile(path)` / `scanDirectory(path)` → file/dir variants (not used in the Lambda path).

### `sast-cloud/src/sast/index.mjs` (Lambda handler)
- `handler(event)` → reads the HTTP body (`readBody`), validates the `code`, calls
  `scanCode`, builds a `summary`, `PutItem`s the result into DynamoDB (best-effort, wrapped in
  try/catch so a DB failure still returns the scan), logs a structured line, returns JSON.
- `readBody(event)` → extracts and base64-decodes the request body if needed.
- `respond(statusCode, body)` → builds the API Gateway response with CORS headers.

### `pentest/backend/tester.js` (provided, unchanged)
- `runAllTests(targetUrl, options)` → runs all 6 test functions against the URL, returns results.
- `runSpecificTest(testId, url)` / `getAvailableTests()` → single-test / listing helpers.
- Internal test functions: `testMissingAuth`, `testSqlInjection`, `testNosqlInjection`,
  `testRateLimiting`, `testSecurityHeaders`, `testSensitiveDataExposure` — each makes real
  HTTP requests and returns `{id, name, status, severity, findings, details}`.

### `pentest/backend/run-scan.mjs` (our one-shot launcher)
- `main()` → reads `TARGET_URL`, `SCAN_ENV`, `TABLE_NAME` from env; calls `runAllTests`;
  builds a summary; if `TABLE_NAME` is set, `PutItem`s a `PENTEST` row into the shared table
  (best-effort); prints the full report to stdout; exits non-zero if any test FAILED (so the
  task result signals "issues found").

### `pentest/backend/test-target.js` (provided, extended)
- Defines vulnerable endpoints (`/api/users`, `/api/user`, `/api/login`, `/api/data`, …).
- **Our extension:** if `SECURE_HEADERS=true`, adds the security headers the pentest checks
  for and disables `X-Powered-By`; if `RATE_LIMIT=true`, returns HTTP 429 after a burst.
  This lets one image represent dev (off), staging (on), prod (headers regressed off).

### `integration/src/diff/index.mjs` (regression diff engine)
- `handler()` → scans the whole `ScanResults` table, keeps the latest row per
  `env#scanType`, and for each tool compares adjacent environments; an issue present in the
  later env but not the earlier = a regression. Publishes an SNS alert if any are HIGH.
- `issuesFromRow(row)` → normalizes a row into a set of issue ids: for SAST, every
  `vulnerabilities[].id`; for PENTEST, every `findings[].id` with `status === 'FAIL'`. This
  is where the two tools' different result shapes are unified.
- `respond(statusCode, body)` → API Gateway response helper.

---

## 10. Key design decisions

1. **Reuse the provided engines unchanged.** `scanner.js` and `tester.js` are the "brains";
   we only added thin adapters and infrastructure around them. *(Requirement: build on the
   provided code. Alternative: rewrite — rejected, more work and against the brief.)*
2. **Lambda for SAST, Fargate for Pentest.** Matched compute to workload: SAST is fast,
   stateless, event-driven (Lambda); Pentest is container-based, network-heavy, possibly
   longer (Fargate), and satisfies the Docker requirement.
3. **One-shot launcher (`run-scan.mjs`) instead of the Express server.** A container should
   run the job and exit, not stay up waiting for requests. *(Alternative: run `server.js`
   in the container behind a load balancer — more cost and complexity; kept for a future UI.)*
4. **Two containers in ONE Fargate task.** The scanner and target share `localhost`, so the
   scanner reaches the target with no load balancer and the vulnerable target is never exposed
   to the internet. *(Alternative: separate tasks + public IPs + DNS — more moving parts and
   an exposed vulnerable app.)*
5. **One shared DynamoDB table with a parameterized `scanType`.** The integration "contract."
   Both tools write the same envelope keyed by `env#scanType`. *(Alternative: separate tables
   per tool — then the diff engine would need to join across tables.)*
6. **Reuse `LabRole`.** Learner Lab can't create IAM roles. *(Trade-off: `LabRole` is broad,
   not least-privilege; in production we'd scope a minimal role per component.)*
7. **Public subnet + public IP, no NAT Gateway.** Fargate needs outbound to pull images from
   ECR; a NAT Gateway costs ~$32/mo. *(Alternative: private subnet + NAT — rejected on cost.)*
8. **Generic shared name `regression-tracker-…`.** The table/resources are platform-level, not
   SAST-specific, since both tools use them.
9. **Three environments via configuration, not three codebases.** SAST uses three source
   versions; Pentest uses one target image toggled by env vars. This realistically mirrors how
   dev/staging/prod often differ by config, and directly answers the proposal feedback
   ("you don't have three versions of code — how will you simulate this?").
10. **Container Insights for monitoring.** Gives CPU/memory/task metrics (answers the
    "what CloudWatch monitoring?" feedback). We used the basic tier to control cost.

---

## 11. Errors we hit & how we fixed them

| # | Problem | Cause | Fix |
|---|---|---|---|
| 1 | Scanner couldn't reach target on `localhost` (local Docker) | Inside a container, `localhost` = the container itself, not the host | Locally used `host.docker.internal`; in the cloud put both containers in **one task** to share localhost |
| 2 | Scanner ran before the target was ready (connection errors) | Container startup race | Added a **health check** on the target + `dependsOn: HEALTHY` on the scanner |
| 3 | Container "exited with code 1" looked like a failure | We intentionally exit non-zero when findings exist | Documented it as **by design** (signals "issues found"; useful for alerting/retries) |
| 4 | `docker login` to ECR failed with HTTP 400 (PowerShell) | PowerShell's pipe mangled the password's encoding | Capture the token into a variable, pass via `--password` instead of piping |
| 5 | `$reg` / `$d` variables not recognized | Mixed `cmd` and PowerShell; `cmd` doesn't use `$vars`; a Terraform flag didn't expand the var | Use PowerShell for `$vars`; pass Terraform `-chdir` a **literal quoted path** |
| 6 | `tail` not recognized | `tail` is a Unix command, not PowerShell | Use `Select-Object -Last N` |
| 7 | `docker build` failed: "cannot connect to the Docker daemon" | Docker Desktop wasn't running | Start Docker Desktop, confirm with `docker info` |
| 8 | Risk: `npm ci` fails in Docker if `package.json` ≠ lockfile | Hand-editing `package.json` desyncs the lockfile | Add deps with `npm install` (updates both files together) |
| 9 | `.dockerignore` patterns silently not matching | `.dockerignore`/`.gitignore` don't support inline `#` comments | Put comments on their own lines |
| 10 | Em-dash rendered as `â` in the diff output | UTF-8 em-dash in a non-UTF-8 console | Replaced with a plain hyphen |
| 11 | Budget was draining ~$2.50/day | Leftover EC2 + NAT Gateway + ALB from earlier (non-project) labs | Scanned the account, tore them down, released Elastic IPs |
| 12 | SNS alerts not delivered | Email subscriptions need confirmation | Each subscriber clicks the confirmation link AWS emails |

---

## 12. Cost / budget management

Learner Lab budget is **$50**. The whole project is **serverless and pay-per-use**, so it
costs **~$0/day idle** and pennies in total:
- Lambda, DynamoDB (pay-per-request), API Gateway, SNS → charged per use, ~$0 idle.
- Fargate tasks are **one-shot** (bill only the ~30–60s they run) and stop themselves.
- ECR image storage ≈ a few cents/month.

**Cost guardrails we followed:** no EC2, **no NAT Gateway** (~$32/mo avoided via public
subnet + public IP), smallest Fargate size (0.25 vCPU), pay-per-request DynamoDB, and
`terraform destroy` when not demoing. *(Lesson learned: other course labs can leave expensive
resources running — periodically scan EC2/EKS/RDS/NAT/ALB and tear down leftovers.)*

---

## 13. What could be better (future work)

- **Least-privilege IAM** — replace the broad `LabRole` with a minimal role per component.
- **Retries + dead-letter handling** — orchestrate scans with **Step Functions** (or SQS+DLQ)
  so a failed scan retries and a persistent failure raises an alert (proposal feedback #5).
- **Automated triggering** — run scans on a schedule (EventBridge) or on a GitHub push
  (webhook), instead of manually.
- **Normalized findings schema** — a single common finding shape across both tools so the diff
  engine doesn't special-case SAST vs PENTEST.
- **A dashboard UI** (S3 + CloudFront) — register environments and view results/regressions.
- **Store full reports in S3** — keep DynamoDB for summaries/queries, archive big reports cheaply.
- **The 3 environments as a reusable Terraform module** — instantiate dev/staging/prod from
  one definition instead of running tasks with overrides.
- **Authentication** on the public API endpoints (API keys / Cognito).
- **De-duplicate scan rows** — currently each scan is a new row; the diff uses the latest, but
  a TTL or "current state" table would keep it tidy.
- **CI/CD** — a pipeline that builds/pushes images and applies Terraform automatically.

---

## 14. Deploy-from-scratch runbook

Prerequisites: AWS CLI, Terraform, Docker Desktop, Node.js. AWS creds from Learner Lab
(`aws sts get-caller-identity` should show the account). All commands from the repo root.

**1. SAST stack** (creates the shared table):
```
cd sast-cloud/infra
terraform init
terraform apply -var "lab_role_arn=<LabRole ARN>" -var "project_name=regression-tracker"
# note the scan_endpoint output
```

**2. Pentest images → ECR** (create repos once, then build/push):
```
aws ecr create-repository --repository-name pentest-scanner --region us-east-1
aws ecr create-repository --repository-name pentest-target  --region us-east-1
cd pentest/backend
docker build -t pentest-scanner .
docker build -f Dockerfile-target -t pentest-target .
# login then tag+push both to <acct>.dkr.ecr.us-east-1.amazonaws.com/<name>:latest
```

**3. Pentest stack**:
```
cd pentest/infra
terraform init && terraform apply        # defaults reference the shared table
```

**4. Integration (diff engine) stack**:
```
cd integration/infra
terraform init && terraform apply         # creates /regressions endpoint + SNS topic
# confirm the SNS subscription emails
```

**5. Run scans** — SAST: `sast-cloud/scripts/test-live.ps1` (POSTs the 3 samples). Pentest:
`aws ecs run-task … --overrides …` for dev/staging/prod (see §15).

**6. See regressions:** `GET <diff endpoint>/regressions`.

**7. Tear down:** `terraform destroy` in each `infra/` folder (ECR images persist; delete
them manually if desired).

---

## 15. Demo script

1. **Show the code & IaC** — `scanner.js`/`tester.js` (reused), `run-scan.mjs`, the Dockerfiles,
   the three `infra/` folders.
2. **Show it deployed** — ECR images, the SAST Lambda + API, the ECS task definition (two
   containers), the diff Lambda + SNS topic.
3. **Run SAST** on the 3 samples (`test-live.ps1`) — show dev=many, staging=few, prod=regressed.
4. **Run Pentest** on the 3 environments (`run-task` with per-env `SECURE_HEADERS`/`RATE_LIMIT`).
5. **Show the shared table** — rows for `dev/staging/prod # SAST` and `# PENTEST`.
6. **Hit `GET /regressions`** — it reports **two** regressions: SAST `HARDCODED_SECRET`
   (staging→prod, HIGH) and PENTEST `SECURITY_HEADERS` (staging→prod) — and `alerted: true`.
7. **Show the SNS email** received by the team.
8. **Wrap up** — architecture, what we'd improve (§13).

---

*End of guide.*
