// index.mjs — Regression diff engine (Milestone 2 integration layer).
// ---------------------------------------------------------------------------
// Reads the SHARED ScanResults table (written to by BOTH the SAST Lambda and
// the Pentest Fargate task), compares findings across dev -> staging -> prod
// for each tool, and flags REGRESSIONS: an issue present in a later environment
// but absent in the earlier one (e.g. a vuln fixed in staging that reappears in
// prod). On a HIGH-severity regression it publishes an SNS alert.
//
// Triggered by GET /regressions (API Gateway HTTP API).
// AWS SDK v3 ships with the Node 22 runtime, so nothing is bundled.
// ---------------------------------------------------------------------------

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const TABLE_NAME = process.env.TABLE_NAME;
const TOPIC_ARN  = process.env.ALERT_TOPIC_ARN; // optional; alert only if set
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});

// Environments in promotion order. A "regression" is something present in a
// LATER env that was absent in the env before it.
const ENV_ORDER = ['dev', 'staging', 'prod'];

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const respond = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body, null, 2) });

// Reduce a stored scan row to a map of issueId -> {id, name, severity}.
// This is where the two tools' different shapes are unified:
//   SAST  -> every entry in `vulnerabilities[]` is an issue
//   PENTEST -> every entry in `findings[]` with status === 'FAIL' is an issue
const issuesFromRow = (row) => {
  const map = new Map();
  if (row.scanType === 'SAST') {
    for (const v of row.vulnerabilities || []) {
      map.set(v.id, { id: v.id, name: v.name, severity: v.severity });
    }
  } else if (row.scanType === 'PENTEST') {
    for (const f of row.findings || []) {
      if (f.status === 'FAIL') {
        map.set(f.id, { id: f.id, name: f.name, severity: f.severity });
      }
    }
  }
  return map;
};

export const handler = async () => {
  // --- 1. Read every row from the shared table (paginated) ----------------
  const rows = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey }));
    rows.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // --- 2. Keep only the LATEST scan per "<env>#<scanType>" ----------------
  const latest = {};
  for (const row of rows) {
    const key = row.envScanType; // e.g. "prod#SAST"
    if (!latest[key] || (row.scannedAt || '') > (latest[key].scannedAt || '')) {
      latest[key] = row;
    }
  }

  // --- 3. Compare adjacent environments per scanType ----------------------
  const scanTypes = [...new Set(Object.values(latest).map((r) => r.scanType))];
  const regressions = [];
  for (const scanType of scanTypes) {
    for (let i = 1; i < ENV_ORDER.length; i++) {
      const prevEnv = ENV_ORDER[i - 1];
      const currEnv = ENV_ORDER[i];
      const prevRow = latest[`${prevEnv}#${scanType}`];
      const currRow = latest[`${currEnv}#${scanType}`];
      if (!prevRow || !currRow) continue; // need both envs scanned to compare

      const prevIssues = issuesFromRow(prevRow);
      const currIssues = issuesFromRow(currRow);

      for (const [id, issue] of currIssues) {
        if (!prevIssues.has(id)) {
          regressions.push({
            scanType,
            fromEnv: prevEnv,
            toEnv: currEnv,
            id: issue.id,
            name: issue.name,
            severity: issue.severity,
            detail: `${issue.name} (${issue.id}) is present in ${currEnv} but was not in ${prevEnv} - a regression.`
          });
        }
      }
    }
  }

  // --- 4. Alert on HIGH-severity regressions (SNS) ------------------------
  const highRegressions = regressions.filter((r) => r.severity === 'HIGH');
  let alerted = false;
  if (TOPIC_ARN && highRegressions.length > 0) {
    try {
      await sns.send(new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: `[Regression Tracker] ${highRegressions.length} HIGH-severity regression(s) detected`,
        Message:
          'HIGH-severity security regressions detected across environments:\n\n' +
          highRegressions.map((r) => `- [${r.scanType}] ${r.detail}`).join('\n')
      }));
      alerted = true;
    } catch (err) {
      console.error('SNS publish failed:', err);
    }
  }

  // --- 5. Respond ----------------------------------------------------------
  console.log(JSON.stringify({
    msg: 'diff_complete', scannedRows: rows.length,
    totalRegressions: regressions.length, highRegressions: highRegressions.length, alerted
  }));

  return respond(200, {
    environmentsCompared: ENV_ORDER,
    scanTypes,
    totalRegressions: regressions.length,
    highRegressions: highRegressions.length,
    alerted,
    regressions
  });
};
