// This file is part of MiNap Go
// auth.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Login, PIN setup/entry, Change PIN, logout, and the server-side revocation check.
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

// Mirrors Code.gs's PIN_MIN_LENGTH, for instant feedback on the setup/change screens. The
// server re-checks this itself and stays authoritative -- this constant only saves a round trip
// on the common case of typing too few digits.
var PIN_MIN_LENGTH = 6;

// One reason -> message lookup, shared by every screen that can receive a {ok, reason} or
// {valid, reason} envelope, so a reason is never translated into user-facing text more than
// once and nothing ever branches on err.message from a google.script.run failure handler.
var REASON_MESSAGES = {
  invalid_login: 'Please contact the study to ensure the Study ID and Participant ID are correct.',
  locked: 'Too many incorrect attempts. Contact your study team to unlock your account.',
  wrong_pin: 'Incorrect PIN. Try again.',
  pin_too_short: 'Choose a PIN of at least ' + PIN_MIN_LENGTH + ' digits.',
  not_set: 'No PIN is on file yet for this participant.',
  offline: 'You need a connection to do this. Check your connection and try again.'
};

var MSG_LOGIN_FAILED = 'Unable to log in. Please verify the Study ID and Participant ID are correct.';
var MSG_LOGIN_UNREACHABLE = 'Unable to reach the study server right now. Check your connection and try again.';

// The identity a PIN-setup or PIN-entry screen is currently acting on, and which of the three
// ways it got there: 'local-unlock' (a profile already exists on this device -- fully offline),
// 'server-verify' (a PIN is already set server-side, but this device has no local profile yet),
// or set implicitly by beginPinSetup (no PIN exists anywhere yet).
var pendingIdentity = null;
var pendingMode = null;

function setButtonBusy(id, busy) {
  document.getElementById(id).disabled = busy;
  document.getElementById(id + '-label').classList.toggle('hidden', busy);
  document.getElementById(id + '-spinner').classList.toggle('hidden', !busy);
}
function setLoginBusy(busy) { setButtonBusy('btn-start', busy); }
function setPinEntryBusy(busy) { setButtonBusy('btn-pin-entry', busy); }
function setPinSetupBusy(busy) { setButtonBusy('btn-pin-setup', busy); }
function setChangePinBusy(busy) { setButtonBusy('btn-change-pin-save', busy); }

function showPinEntryError(msg) { document.getElementById('pin-entry-error').textContent = msg; }
function showPinSetupError(msg) { document.getElementById('pin-setup-error').textContent = msg; }
function showChangePinError(msg) { document.getElementById('change-pin-error').textContent = msg; }

// Study/Participant ID submitted: routes to PIN entry (local unlock, or a server verify if this
// is a new device) or PIN setup (nobody has chosen a PIN for this identity yet), depending on
// what this device already knows and what the server says.
async function doStart() {
  var study = document.getElementById('in-study').value.trim().toUpperCase();
  var part = document.getElementById('in-part').value.trim().toUpperCase();
  var tz = document.getElementById('in-tz').value;
  if (!study || !part) { toast('Enter Study ID and Participant ID'); return; }

  setLoginBusy(true);
  var profile = await getProfile(study, part);
  if (profile) {
    setLoginBusy(false);
    beginPinEntry(study, part, tz, 'local-unlock');
    return;
  }

  validateLogin(study, part, function (res) {
    setLoginBusy(false);
    if (!res || !res.valid) { toast(MSG_LOGIN_FAILED); return; }
    if (res.pinSet) beginPinEntry(study, part, tz, 'server-verify');
    else beginPinSetup(study, part, tz);
  }, function () {
    setLoginBusy(false);
    toast(MSG_LOGIN_UNREACHABLE);
  });
}

function doSwitchAccount() {
  document.getElementById('in-study').value = '';
  document.getElementById('in-part').value = '';
  clearLastIdentity();
  document.getElementById('in-study').focus();
}

function beginPinEntry(studyId, participantId, tz, mode) {
  pendingIdentity = { studyId: studyId, participantId: participantId, tz: tz };
  pendingMode = mode;
  showPinEntryError('');
  document.getElementById('in-pin-entry').value = '';
  show('screen-pin-entry');
  document.getElementById('in-pin-entry').focus();
}

function beginPinSetup(studyId, participantId, tz) {
  pendingIdentity = { studyId: studyId, participantId: participantId, tz: tz };
  pendingMode = 'setup';
  showPinSetupError('');
  document.getElementById('in-pin-new').value = '';
  document.getElementById('in-pin-confirm').value = '';
  show('screen-pin-setup');
  document.getElementById('in-pin-new').focus();
}

function backToLogin() {
  pendingIdentity = null;
  pendingMode = null;
  show('screen-login');
}

// PIN entered on the entry screen: unwraps locally (fully offline, when a profile already
// exists on this device) or checks it against the server and bootstraps a fresh local profile
// (a device seeing this identity for the first time has nothing to unwrap yet -- there is no
// read path to repopulate its history from, so it legitimately starts empty).
async function doPinEntry() {
  var pin = document.getElementById('in-pin-entry').value;
  if (!pin) { toast('Enter your PIN'); return; }
  var id = pendingIdentity;
  setPinEntryBusy(true);

  if (pendingMode === 'local-unlock') {
    var ok = await unlockWithPin(id.studyId, id.participantId, pin);
    setPinEntryBusy(false);
    if (!ok) { showPinEntryError(REASON_MESSAGES.wrong_pin); return; }
    await setLastIdentity(id.studyId, id.participantId);
    enterHome(); // revalidates in the background itself; local unlock already let them in
    return;
  }

  verifyPin(id.studyId, id.participantId, pin, function (res) {
    if (!res || !res.ok) {
      setPinEntryBusy(false);
      showPinEntryError(REASON_MESSAGES[res && res.reason] || MSG_LOGIN_FAILED);
      return;
    }
    createLocalProfile(id.studyId, id.participantId, id.tz, pin)
      .then(function () { return setLastIdentity(id.studyId, id.participantId); })
      .then(function () {
        setPinEntryBusy(false);
        enterHome();
      });
  }, function () {
    setPinEntryBusy(false);
    toast(MSG_LOGIN_UNREACHABLE);
  });
}

// PIN chosen on the setup screen: registers it server-side first, then mints the local key --
// in that order, so a device never holds a local profile the server doesn't also know about.
function doPinSetup() {
  var pin = document.getElementById('in-pin-new').value;
  var confirmPin = document.getElementById('in-pin-confirm').value;
  if (!pin || pin.length < PIN_MIN_LENGTH) { showPinSetupError(REASON_MESSAGES.pin_too_short); return; }
  if (pin !== confirmPin) { showPinSetupError('PINs do not match.'); return; }

  var id = pendingIdentity;
  setPinSetupBusy(true);
  setPin(id.studyId, id.participantId, pin, undefined, function (res) {
    if (!res || !res.ok) {
      setPinSetupBusy(false);
      showPinSetupError(REASON_MESSAGES[res && res.reason] || 'Could not set PIN. Try again.');
      return;
    }
    createLocalProfile(id.studyId, id.participantId, id.tz, pin)
      .then(function () { return setLastIdentity(id.studyId, id.participantId); })
      .then(function () {
        setPinSetupBusy(false);
        enterHome();
      });
  }, function () {
    setPinSetupBusy(false);
    toast(MSG_LOGIN_UNREACHABLE);
  });
}

async function enterHome() {
  var identity = getSessionIdentity();
  document.getElementById('who-study').textContent = identity.studyId;
  document.getElementById('who-part').textContent = identity.participantId;
  show('screen-home');
  await applyHomeState(); // from cache first (instant)
  flushQueue();
  checkRevocation(true); // catches a revoked ID, then re-applies state
}

// Ends the session without touching local data: a participant who logs back in with the
// correct PIN sees the same history, unchanged. Returns to PIN entry for the same identity,
// since nothing about it was forgotten. See docs/architecture.md's local storage section.
function doLogout() {
  var identity = getSessionIdentity();
  lock();
  showOverlay(false);
  if (identity) beginPinEntry(identity.studyId, identity.participantId, null, 'local-unlock');
  else show('screen-login');
}

// The server has the final say on the allowlist: if this participant's ID was revoked, stop
// them continuing on (possibly stale) local history. This also only locks, never deletes --
// a later re-enable should not cost the participant their on-device history.
function forceLogout(message) {
  lock();
  showOverlay(false);
  show('screen-login');
  if (message) toast(message);
}

function checkRevocation(thenApplyHome) {
  var identity = getSessionIdentity();
  if (!identity) return;
  validateLogin(identity.studyId, identity.participantId, function (res) {
    if (!res || !res.valid) { forceLogout(REASON_MESSAGES.invalid_login); return; }
    if (thenApplyHome) applyHomeState();
  }, function () {}); // request never completed (offline/etc.) - stay logged in, retry later
}

// ----- Change PIN: a distinct case from setup or forgot-it (architecture.md section 5.2) -----

function openChangePinModal() {
  showChangePinError('');
  document.getElementById('in-pin-old').value = '';
  document.getElementById('in-pin-change-new').value = '';
  document.getElementById('in-pin-change-confirm').value = '';
  openModal('change-pin-modal');
  document.getElementById('in-pin-old').focus();
}
function closeChangePinModal() {
  closeModal('change-pin-modal');
}

async function doChangePin() {
  var oldPin = document.getElementById('in-pin-old').value;
  var newPin = document.getElementById('in-pin-change-new').value;
  var confirmPin = document.getElementById('in-pin-change-confirm').value;
  if (!newPin || newPin.length < PIN_MIN_LENGTH) { showChangePinError(REASON_MESSAGES.pin_too_short); return; }
  if (newPin !== confirmPin) { showChangePinError('New PINs do not match.'); return; }

  setChangePinBusy(true);
  var result = await changePin(oldPin, newPin);
  setChangePinBusy(false);
  if (!result.ok) { showChangePinError(REASON_MESSAGES[result.reason] || 'Could not change PIN. Try again.'); return; }
  closeChangePinModal();
  toast('PIN changed');
}
