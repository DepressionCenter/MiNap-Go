// This file is part of MiNap Go
// auth.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: Login, session bootstrap, logout, and the server-side revocation check.
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

var MSG_INVALID_CREDENTIALS = 'Please contact the study to ensure the Study ID and Participant ID are correct.';
var MSG_LOGIN_FAILED = 'Unable to log in. Please verify the Study ID and Participant ID are correct.';
var MSG_LOGIN_UNREACHABLE = 'Unable to reach the study server right now. Check your connection and try again.';

function setLoginBusy(busy) {
  document.getElementById('btn-start').disabled = busy;
  document.getElementById('btn-start-label').classList.toggle('hidden', busy);
  document.getElementById('btn-start-spinner').classList.toggle('hidden', !busy);
}

function doStart() {
  var study = document.getElementById('in-study').value.trim().toUpperCase();
  var part = document.getElementById('in-part').value.trim().toUpperCase();
  var tz = document.getElementById('in-tz').value;
  if (!study || !part) { toast('Enter Study ID and Participant ID'); return; }

  setLoginBusy(true);
  validateLogin(study, part, function (res) {
    setLoginBusy(false);
    if (!res || !res.valid) { toast(MSG_LOGIN_FAILED); return; }
    save(K_SESSION, { study_id: study, participant_id: part, tz: tz, created_at: new Date().toISOString() });
    enterHome();
  }, function () {
    setLoginBusy(false);
    toast(MSG_LOGIN_UNREACHABLE);
  });
}

function enterHome() {
  var session = load(K_SESSION, null);
  document.getElementById('who-study').textContent = session.study_id;
  document.getElementById('who-part').textContent = session.participant_id;
  show('screen-home');
  applyHomeState();   // from cache first (instant)
  flushQueue();
  checkRevocation(true); // catches a revoked ID, then re-applies state
}

// Clears the local session and returns to login. `message`, if given, is toasted
// (used when the server rejects a revoked Study/Participant ID); the manual
// "Log out" link calls this with no message.
function forceLogout(message) {
  clearAll();
  showOverlay(false);
  document.getElementById('in-study').value = '';
  document.getElementById('in-part').value = '';
  show('screen-login');
  if (message) toast(message);
}

function doLogout() {
  forceLogout();
}

// The server has the final say on the allowlist: if this participant's ID was
// revoked, don't keep showing (possibly stale) local history — log out immediately.
function checkRevocation(thenApplyHome) {
  var session = load(K_SESSION, null);
  if (!session) return;
  validateLogin(session.study_id, session.participant_id, function (res) {
    if (!res || !res.valid) { forceLogout(MSG_INVALID_CREDENTIALS); return; }
    if (thenApplyHome) applyHomeState();
  }, function () {}); // request never completed (offline/etc.) - stay logged in, retry later
}
