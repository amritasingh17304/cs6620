# Milestone 1 — Video Script (easy to speak, ~4.5 min)

**Submit as:** `Singh_Ramandeep_VideoMilestone.mp4` · **Length:** 4–6 min
**Before recording (not filmed):** start a fresh lab, paste creds, run
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`, confirm it's
deployed. Open: VS Code, PowerShell, and the AWS Console.

Just read the lines in quotes. Keep it relaxed — short sentences, small pauses.

---

## 🎬 0:00 – 0:25 — Intro
*[ON SCREEN: your face or VS Code]*

> "Hi, I'm Ramandeep. This is my Milestone 1 for Cloud Computing, Group 18.
> Our project scans code for security bugs. My part is the SAST pipeline — it
> scans source code and stores the results on AWS. My teammate Amrit does the
> pentest side."

---

## 🎬 0:25 – 1:10 — The code
*[ON SCREEN: open `scanner.js`]*

> "We had to build on the professor's tool. This is his scanner. It finds bugs
> like hardcoded passwords and SQL injection. I use it exactly as-is — I didn't
> change it."

*[ON SCREEN: open `index.mjs`]*

> "His version runs as a normal server. But Lambda doesn't work like that — it
> only wakes up when a request comes in. So I wrote this small handler. It takes
> the code, runs his scanner, saves the result to the database, and sends it back.
> I kept his brain — I just changed how it runs."

---

## 🎬 1:10 – 1:55 — Terraform (infra as code)
*[ON SCREEN: open `main.tf`, scroll slowly]*

> "All my AWS setup is written as code with Terraform. Right here I create the
> database, the Lambda, the API, and the logs. One command builds everything, one
> command deletes it."

*[ON SCREEN: PowerShell → `cd infra; terraform output; cd ..`]*

> "And here's the live public link to my scanner."

---

## 🎬 1:55 – 3:20 — Live demo
*[ON SCREEN: PowerShell → `.\scripts\test-live.ps1`]*

> "Now let's run it live. To act like real environments, I made three versions of
> one app — dev, staging, and prod. I'm sending each one to my live AWS link."

*[wait for the results]*

> "Dev has seven problems, four of them serious.
> Staging has just one — the team fixed the big ones.
> But look at prod — the serious hardcoded password is back. A bad merge brought
> it back after it was already fixed in staging."

> "That's the whole point of my project. A bug that was fixed, but came back in
> production. And every scan is saved in the database, tagged by environment — so
> we can compare them."

---

## 🎬 3:20 – 4:10 — Show it's real (AWS Console)
*[ON SCREEN: DynamoDB → ScanResults → Explore items → Run]*

> "Here in DynamoDB are my three scans — dev, staging, and prod. This is the real
> saved data."

*[ON SCREEN: Lambda → Function overview diagram]*

> "This is my Lambda, with the API Gateway connected as its trigger."

*[ON SCREEN: Lambda → Monitor tab]*

> "And my monitoring — 100% success, no errors, and each scan takes about 138
> milliseconds. It's so fast that a small Lambda is the perfect fit."

---

## 🎬 4:10 – 4:30 — Challenge (required)
*[ON SCREEN: `index.mjs` — the type-check line]*

> "One problem I hit: my scans kept coming back empty. I found out PowerShell was
> sending my code in the wrong format, so the scanner got nothing. I fixed it, and
> I also added a check so a bad request now gives a clear error. Next, for
> Milestone 2, I'll build the part that flags these regressions automatically."

---

## 🎬 4:30 – 4:50 — Closing
*[ON SCREEN: VS Code or README]*

> "So that's my SAST pipeline — live, scanning code, and saving results per
> environment. Next steps are the auto-compare engine, alerts, and connecting with
> Amrit's side. Thanks for watching."

---

## After recording
- `.\scripts\destroy.ps1` to tear down.
- Check length is 4–6 min. Rename to `Singh_Ramandeep_VideoMilestone.mp4`. Submit.

## Cheat sheet (keep visible while recording)
| Moment | Command / screen |
|---|---|
| Show deployed | `cd infra; terraform output; cd ..` |
| Live demo | `.\scripts\test-live.ps1` → dev=7, staging=1, prod=2 |
| DynamoDB | Explore items → 3 rows |
| Lambda | Function overview (API Gateway trigger) |
| Monitoring | Monitor tab (100% success, ~138 ms) |
