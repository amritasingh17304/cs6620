// app-prod.js — PROD version. Mostly matches staging, BUT a HIGH-severity
// vulnerability that was fixed in staging has REGRESSED back into prod.
// This is exactly the kind of cross-environment regression our tracker exists
// to catch (a fix present in staging but missing in prod). The diff/alerting
// engine that flags this is built in Milestone 2.
const express = require('express');
const crypto = require('crypto');
const app = express();

const apiKey = process.env.API_KEY;

// REGRESSION (HIGH): a bad merge reintroduced the hardcoded DB password that
// was correctly removed in staging.
const password = "admin123";

// Still fixed: parameterized query.
function getUser(db, id) {
  return db.query("SELECT * FROM users WHERE id = ?", [id]);
}

// Still fixed: textContent.
function render(el, userInput) {
  el.textContent = userInput;
}

// Still fixed: strong hash + secure token.
const hash = crypto.createHash('sha256').update(password).digest('hex');
const sessionToken = crypto.randomUUID();

// Still present: hardcoded IP (MEDIUM).
const dbHost = "10.0.0.42";

module.exports = { getUser, render, hash, sessionToken, dbHost };
