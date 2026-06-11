// app-staging.js — STAGING version. Most DEV vulnerabilities have been FIXED here.
// The SAST scan should report far fewer findings than dev.
const express = require('express');
const crypto = require('crypto');
const app = express();

// FIXED: secret now comes from the environment instead of being hardcoded.
const apiKey = process.env.API_KEY;
const password = process.env.DB_PASSWORD;

// FIXED: parameterized query instead of string concatenation.
function getUser(db, id) {
  return db.query("SELECT * FROM users WHERE id = ?", [id]);
}

// FIXED: use textContent instead of innerHTML.
function render(el, userInput) {
  el.textContent = userInput;
}

// FIXED: removed eval; use a safe lookup table instead.
const COMMANDS = { status: () => 'ok' };
function run(cmd) {
  return (COMMANDS[cmd] || (() => 'unknown'))();
}

// FIXED: strong hash.
const hash = crypto.createHash('sha256').update(password).digest('hex');

// FIXED: cryptographically secure token.
const sessionToken = crypto.randomUUID();

// STILL PRESENT: hardcoded IP (MEDIUM) — not yet addressed in staging.
const dbHost = "10.0.0.42";

module.exports = { getUser, render, run, hash, sessionToken, dbHost };
