// This file is part of MiNap Go
// Code.gs
// Author(s): Gabriel Mongefranco
// Created: 2026-07-09
// Summary: Server-side Apps Script; serves the web app and reads/writes sleep events to the bound Google Sheet.
// Notes: See README file for documentation and full license information.
//
// Copyright © 2026 The Regents of the University of Michigan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License along
// with this program. If not, see <https://www.gnu.org/licenses/>.

const SHEET_NAME = 'SleepDiary';
const SETUP_SHEET = 'Setup';
const APP_VERSION = '1.0.0';
const EDIT_WINDOW_DAYS = 7; // How far back in history is the user allowed to edit entries

const HEADERS = [
  'record_id', 'study_id', 'participant_id', 'event_type', 'event_epoch_ms',
  'event_iso_utc', 'event_tz', 'event_local', 'created_at_iso', 'updated_at_iso',
  'edited', 'source', 'app_version'
];

// Setup tab layout: URL to Share with Participants | Active Study ID | Active Participant IDs
const SETUP_COL_URL = 1;
const SETUP_COL_STUDY = 2;
const SETUP_COL_PARTICIPANTS = 3;
const SETUP_DATA_ROW = 2; // first row below the header
const DEFAULT_STUDY_ID = 'STUDY1';
const DEFAULT_PARTICIPANT_IDS = ['P01', 'P02', 'P03'];

function doGet(e) {
  recordWebAppUrl_(); // save the shareable link into the Sheet on first open
  var output = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('MiNap Go')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');

  // Only relax framing protection when the request opts in. This flag isn't a secret (it's
  // public in source control) so it's not a real barrier against a targeted attacker -- the
  // client-side referrer check in Index.html is what actually restricts embedding to the
  // approved demo page. This just keeps the bare URL from being framable by default.
  var allowEmbed = e && e.parameter && e.parameter.allowEmbed === 'true';
  if (allowEmbed) {
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return output;
}

// Write the live web app URL into the Setup tab so the researcher never loses it.
// The URL is only known in web-app context, so this runs on app open, not deploy.
function recordWebAppUrl_() {
  let url;
  try { url = ScriptApp.getService().getUrl(); } catch (e) { return; }
  if (!url) return; // not running as a published web app
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // busy; a later open will record it
  try {
    const sh = ensureSetupSheet_();
    const cell = sh.getRange(SETUP_DATA_ROW, SETUP_COL_URL);
    if (cell.getValue() !== url) cell.setValue(url); // keep current
  } catch (e) {
    // non-fatal; never block the app over URL bookkeeping
  } finally {
    lock.releaseLock();
  }
}

// Auto-provision the Setup tab: the shareable URL plus the Study ID / Participant ID allowlist.
// Placed right after the README tab (if present) so sheet order is README, Setup, SleepDiary.
function ensureSetupSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SETUP_SHEET);
  if (sh) return sh;

  const readme = ss.getSheetByName('README');
  sh = ss.insertSheet(SETUP_SHEET, readme ? readme.getIndex() : 0);

  sh.getRange(1, SETUP_COL_URL).setValue('URL to Share with Participants');
  sh.getRange(1, SETUP_COL_STUDY).setValue('Active Study ID')
    .setNote('Change this to your actual Study ID. This must be given to participants during enrollment.');
  sh.getRange(1, SETUP_COL_PARTICIPANTS).setValue('Active Participant IDs')
    .setNote('Enter your participant IDs below, one per row. Only the IDs listed here will be allowed to use the app.');
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setFrozenRows(1);

  sh.getRange(SETUP_DATA_ROW, SETUP_COL_STUDY).setValue(DEFAULT_STUDY_ID);
  sh.getRange(SETUP_DATA_ROW, SETUP_COL_PARTICIPANTS, DEFAULT_PARTICIPANT_IDS.length, 1)
    .setValues(DEFAULT_PARTICIPANT_IDS.map(function (id) { return [id]; }));

  sh.setColumnWidth(SETUP_COL_URL, 460);
  sh.setColumnWidth(SETUP_COL_STUDY, 140);
  sh.setColumnWidth(SETUP_COL_PARTICIPANTS, 140);
  return sh;
}

// Case-insensitive check of studyId/participantId against the Setup tab's allowlist.
function isValidParticipant_(studyId, participantId) {
  if (!studyId || !participantId) return false;
  const sh = ensureSetupSheet_();

  const study = String(sh.getRange(SETUP_DATA_ROW, SETUP_COL_STUDY).getValue() || '').trim().toUpperCase();
  if (!study || String(studyId).trim().toUpperCase() !== study) return false;

  const lastRow = sh.getLastRow();
  if (lastRow < SETUP_DATA_ROW) return false;
  const ids = sh.getRange(SETUP_DATA_ROW, SETUP_COL_PARTICIPANTS, lastRow - SETUP_DATA_ROW + 1, 1)
    .getValues()
    .map(function (r) { return String(r[0] || '').trim().toUpperCase(); })
    .filter(function (v) { return v; });
  return ids.indexOf(String(participantId).trim().toUpperCase()) !== -1;
}

// Client-callable: check a Study ID / Participant ID before letting the login screen proceed.
// Returns a plain value rather than throwing, so "invalid" and "can't reach the server"
// stay distinguishable on the client instead of both landing in a thrown-error channel.
function validateLogin(studyId, participantId) {
  return { valid: isValidParticipant_(studyId, participantId) };
}

// Client-callable: expose settings the UI needs without hardcoding a second copy of the constant.
function getConfig() {
  return { editWindowDays: EDIT_WINDOW_DAYS, appVersion: APP_VERSION };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Resolve the target spreadsheet. Bound script uses its own Sheet (no ID needed);
// standalone deployments fall back to a SPREADSHEET_ID script property.
function getSpreadsheet_() {
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('No spreadsheet. Bind this script to a Sheet, or set a SPREADSHEET_ID script property.');
}

// Auto-provision the data sheet and headers on first use; recreate headers if the schema drifted.
// Always created right after the Setup tab, so sheet order is README, Setup, SleepDiary.
function ensureSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    const setupSh = ensureSetupSheet_();
    sh = ss.insertSheet(SHEET_NAME, setupSh.getIndex());
  }
  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('') !== HEADERS.join('')) {
    sh.clear();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Append one Sleep or Wake event. Returns { invalid: true } if the study/participant ID
// isn't on the Setup tab's allowlist (checked as a plain return value, not a thrown error,
// so the client can reliably tell "invalid" apart from "request failed").
function logEvent(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!payload || !isValidParticipant_(payload.study_id, payload.participant_id)) {
      return { invalid: true };
    }
    validateEvent_(payload);
    const sh = ensureSheet_();
    const nowIso = new Date().toISOString();
    const row = [
      payload.record_id,
      String(payload.study_id).trim().toUpperCase(),
      String(payload.participant_id).trim().toUpperCase(),
      payload.event_type,
      Number(payload.event_epoch_ms),
      payload.event_iso_utc,
      payload.event_tz,
      payload.event_local,
      nowIso,
      '',
      'FALSE',
      'web',
      payload.app_version || APP_VERSION
    ];
    sh.appendRow(row);
    return { invalid: false, row: rowToObj_(row) };
  } finally {
    lock.releaseLock();
  }
}

// Return this participant's events, newest first, capped. Returns { invalid: true } instead
// of the rows if the study/participant ID isn't (or is no longer) on the Setup tab's allowlist.
function getHistory(req) {
  if (!req || !isValidParticipant_(req.study_id, req.participant_id)) {
    return { invalid: true, rows: [] };
  }
  const sh = ensureSheet_();
  const values = sh.getDataRange().getValues();
  const studyU = String(req.study_id).trim().toUpperCase();
  const partU = String(req.participant_id).trim().toUpperCase();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const o = rowToObj_(values[i]);
    if (String(o.study_id).trim().toUpperCase() === studyU &&
        String(o.participant_id).trim().toUpperCase() === partU) {
      out.push(o);
    }
  }
  out.sort(function (a, b) { return b.event_epoch_ms - a.event_epoch_ms; });
  return { invalid: false, rows: out.slice(0, req.limit || 200) };
}

// Edit an existing Sleep/Wake event's date & time. Only entries within the edit window
// (based on their currently stored time, not the proposed new one) may be changed.
// Returns { invalid: true } (rather than throwing) if the study/participant ID isn't
// on the Setup tab's allowlist; still throws for genuinely unexpected/structural problems.
function updateEvent(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!req || !req.record_id) throw new Error('Missing record_id');
    if (!req.event_epoch_ms || isNaN(Number(req.event_epoch_ms))) throw new Error('Bad timestamp');
    if (!isValidParticipant_(req.study_id, req.participant_id)) return { invalid: true };

    const sh = ensureSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) throw new Error('Record not found');

    const studyU = String(req.study_id).trim().toUpperCase();
    const partU = String(req.participant_id).trim().toUpperCase();
    const values = sh.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      // Match on study/participant too, so no one can edit another participant's row by guessing a record_id.
      if (String(row[0]) === String(req.record_id) &&
          String(row[1]).trim().toUpperCase() === studyU &&
          String(row[2]).trim().toUpperCase() === partU) {
        assertWithinWindow_(Number(row[4])); // gate on the currently stored time
        const sheetRow = i + 2; // +1 for the header row, +1 for 1-based indexing
        sh.getRange(sheetRow, 5).setValue(Number(req.event_epoch_ms));  // event_epoch_ms
        sh.getRange(sheetRow, 6).setValue(req.event_iso_utc || '');     // event_iso_utc
        sh.getRange(sheetRow, 7).setValue(req.event_tz || row[6]);      // event_tz
        sh.getRange(sheetRow, 8).setValue(req.event_local || '');       // event_local
        sh.getRange(sheetRow, 10).setValue(new Date().toISOString());  // updated_at_iso
        sh.getRange(sheetRow, 11).setValue('TRUE');                    // edited
        const updatedRow = sh.getRange(sheetRow, 1, 1, HEADERS.length).getValues()[0];
        return { invalid: false, row: rowToObj_(updatedRow) };
      }
    }
    throw new Error('Record not found');
  } finally {
    lock.releaseLock();
  }
}

// ----- v2 stub: add a missing time within the edit window (not yet implemented) -----
function addEvent(payload) {
  throw new Error('Not implemented in v1');
}

// ----- helpers -----
function assertWithinWindow_(epochMs) {
  const ageDays = (Date.now() - Number(epochMs)) / 86400000;
  if (ageDays > EDIT_WINDOW_DAYS) {
    throw new Error('Edit window expired (older than ' + EDIT_WINDOW_DAYS + ' days)');
  }
}

function validateEvent_(p) {
  if (!p || !p.record_id) throw new Error('Missing record_id');
  if (!p.study_id || !p.participant_id) throw new Error('Missing study or participant id');
  if (p.event_type !== 'SLEEP' && p.event_type !== 'WAKE') throw new Error('Bad event_type');
  if (!p.event_epoch_ms || isNaN(Number(p.event_epoch_ms))) throw new Error('Bad timestamp');
}

function rowToObj_(row) {
  const o = {};
  for (let i = 0; i < HEADERS.length; i++) o[HEADERS[i]] = row[i];
  o.event_epoch_ms = Number(o.event_epoch_ms);
  return o;
}
