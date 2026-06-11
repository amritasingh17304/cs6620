// app-dev.js — DEV version of our demo app. Deliberately full of vulnerabilities.
// Used to demonstrate the SAST scanner catching issues in the earliest environment.
const express = require('express');
const crypto = require('crypto');
const app = express();

// HARDCODED_SECRET (HIGH)
const apiKey = "ak_live_9f8e7d6c5b4a3210ffff";
const password = "admin123";

// SQL_INJECTION (HIGH)
function getUser(db, id) {
  return db.query("SELECT * FROM users WHERE id = " + id);
}

// XSS (HIGH)
function render(el, userInput) {
  el.innerHTML = userInput;
}

// INSECURE_FUNCTION (HIGH)
function run(cmd) {
  return eval(cmd);
}

// WEAK_CRYPTO (MEDIUM)
const hash = crypto.createHash('md5').update(password).digest('hex');

// INSECURE_RANDOM (MEDIUM) used for a session token
const sessionToken = Math.random().toString(36);

// HARDCODED_IP (MEDIUM)
const dbHost = "10.0.0.42";

module.exports = { getUser, render, run, hash, sessionToken, dbHost, apiKey };
