// index.mjs — SAST Lambda handler (Ramandeep, CS6620 Group 18, Milestone 1)
// ---------------------------------------------------------------------------
// The thin, event-driven "adapter" that lets the professor's scanner run on AWS
// Lambda. Lambda has no always-on server and no port, so we do NOT run his
// Express server.js. This handler instead:
//   1. reads the code out of the API Gateway (HTTP API v2) event,
//   2. calls the UNCHANGED scanCode() from scanner.js (the "brain"),
//   3. persists the findings to DynamoDB (best-effort; failures are reported),
//   4. logs a structured line to CloudWatch and returns JSON.
//
// Request contract (POST /scan), JSON body:
//   { "code": "<source>", "filename"?: "app.js", "env"?: "dev", "scanType"?: "SAST" }
// Response: { success, jobId, env, scanType, filename, scannedAt, durationMs,
//             persisted, persistError, summary, vulnerabilities }
//
// AWS SDK v3 is preinstalled in the Node.js 22 runtime, so it is not bundled.

import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { scanCode } from './scanner.js'; // reused unchanged

const TABLE_NAME = process.env.TABLE_NAME;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Guard against oversized payloads. The scanner is regex-based and meant for
// source files, not multi-MB blobs; reject early to keep latency predictable.
const MAX_CODE_BYTES = 1_000_000; // 1 MB

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body)
});

// Decode the raw request body (API Gateway may base64-encode it).
const readBody = (event) => {
  let raw = event?.body ?? '';
  if (event?.isBase64Encoded && raw) {
    raw = Buffer.from(raw, 'base64').toString('utf-8');
  }
  return raw;
};

export const handler = async (event) => {
  const start = Date.now();

  // --- CORS preflight / non-POST safety net -------------------------------
  // The HTTP API only routes POST /scan, but handle OPTIONS and a simple
  // health probe defensively so the function is robust to direct invokes.
  const method =
    event?.requestContext?.http?.method ?? event?.httpMethod ?? 'POST';
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (method === 'GET') {
    return respond(200, { status: 'healthy', service: 'SAST Scanner', table: TABLE_NAME });
  }

  // --- 1. Parse the request body ------------------------------------------
  const raw = readBody(event);
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    return respond(400, { error: 'Invalid JSON', message: err.message });
  }

  const code = payload.code;
  const filename = payload.filename || 'untitled.js';
  // Normalize so the DynamoDB sort key is consistent (e.g. always "dev#SAST").
  const env = String(payload.env || 'dev').toLowerCase();
  const scanType = String(payload.scanType || 'SAST').toUpperCase();

  if (!code || typeof code !== 'string') {
    return respond(400, {
      error: 'No code provided',
      message: 'POST a JSON body like {"code":"...","filename":"app.js","env":"dev"}'
    });
  }
  if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES) {
    return respond(413, {
      error: 'Code too large',
      message: `Code exceeds the ${MAX_CODE_BYTES}-byte limit for a single scan.`
    });
  }

  // --- 2. Run the professor's scanner (the unchanged brain) ----------------
  const vulnerabilities = scanCode(code, filename);

  const summary = {
    totalVulnerabilities: vulnerabilities.length,
    high: vulnerabilities.filter((v) => v.severity === 'HIGH').length,
    medium: vulnerabilities.filter((v) => v.severity === 'MEDIUM').length,
    low: vulnerabilities.filter((v) => v.severity === 'LOW').length
  };

  const jobId = randomUUID();
  const scannedAt = new Date().toISOString();
  const durationMs = Date.now() - start;

  // --- 3. Persist to DynamoDB ----------------------------------------------
  // Schema (proposal-feedback answer #7):
  //   PK jobId, SK envScanType ("<env>#<scanType>", e.g. "dev#SAST").
  // Wrapped so a storage failure still returns the scan result to the caller
  // (graceful degradation; retries + SNS alerting are Milestone 2).
  let persisted = false;
  let persistError = null;
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        jobId,
        envScanType: `${env}#${scanType}`,
        env,
        scanType,
        filename,
        scannedAt,
        durationMs,
        summary,
        vulnerabilities
      }
    }));
    persisted = true;
  } catch (err) {
    persistError = err.message;
    console.error('DynamoDB write failed:', err);
  }

  // --- 4. Respond ----------------------------------------------------------
  // Structured CloudWatch log line (scan duration + finding counts).
  console.log(JSON.stringify({
    msg: 'scan_complete', jobId, env, scanType, filename,
    findings: summary.totalVulnerabilities, durationMs, persisted
  }));

  return respond(200, {
    success: true,
    jobId,
    env,
    scanType,
    filename,
    scannedAt,
    durationMs,
    persisted,
    persistError,
    summary,
    vulnerabilities
  });
};
