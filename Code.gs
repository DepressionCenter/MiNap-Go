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

// Easiest setup: keep this script bound to its Google Sheet (Extensions > Apps
// Script from inside the Sheet). No ID or code editing needed. The data tab and
// headers are created automatically on first use. Deploy as Web App
// (Execute as: Me, Who has access: Anyone).

const SHEET_NAME = 'SleepDiary';
const SETUP_SHEET = 'Setup';
const APP_VERSION = '1.0.0';
const EDIT_WINDOW_DAYS = 7; // How far back in history is the user allowed to edit entries

const HEADERS = [
  'record_id', 'study_id', 'participant_id', 'event_type', 'event_epoch_ms',
  'event_iso_utc', 'event_tz', 'event_local', 'created_at_iso', 'updated_at_iso',
  'edited', 'source', 'app_version'
];

function doGet() {
  recordWebAppUrl_(); // save the shareable link into the Sheet on first open
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('MiNap Go')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// Write the live web app URL to a Setup tab so the researcher never loses it.
// The URL is only known in web-app context, so this runs on app open, not deploy.
function recordWebAppUrl_() {
  let url;
  try { url = ScriptApp.getService().getUrl(); } catch (e) { return; }
  if (!url) return; // not running as a published web app
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // busy; a later open will record it
  try {
    const ss = getSpreadsheet_();
    let sh = ss.getSheetByName(SETUP_SHEET);
    if (!sh) {
      sh = ss.insertSheet(SETUP_SHEET, 0); // make it the first tab
      sh.getRange('A1').setValue('MiNap Go setup').setFontWeight('bold');
      sh.getRange('A2').setValue('Web app URL (share this link with participants):');
      sh.setColumnWidth(1, 460);
    }
    if (sh.getRange('A3').getValue() !== url) sh.getRange('A3').setValue(url); // keep current
  } catch (e) {
    // non-fatal; never block the app over URL bookkeeping
  } finally {
    lock.releaseLock();
  }
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
function ensureSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('') !== HEADERS.join('')) {
    sh.clear();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Append one Sleep or Wake event. Returns the stored row as an object.
function logEvent(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    validateEvent_(payload);
    const sh = ensureSheet_();
    const nowIso = new Date().toISOString();
    const row = [
      payload.record_id,
      String(payload.study_id),
      String(payload.participant_id),
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
    return rowToObj_(row);
  } finally {
    lock.releaseLock();
  }
}

// Return this participant's events, newest first, capped.
function getHistory(req) {
  const sh = ensureSheet_();
  const values = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const o = rowToObj_(values[i]);
    if (String(o.study_id) === String(req.study_id) &&
        String(o.participant_id) === String(req.participant_id)) {
      out.push(o);
    }
  }
  out.sort(function (a, b) { return b.event_epoch_ms - a.event_epoch_ms; });
  return out.slice(0, req.limit || 200);
}

// ----- v2 stubs: edit or add a missing time within the 7 day window -----
function updateEvent(req) {
  throw new Error('Not implemented in v1');
}
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
