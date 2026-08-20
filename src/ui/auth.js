// This file is part of MiNap Go
// auth.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Login, PIN setup/entry, Change PIN, logout, and the server-side session check.
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

// How long a device may go without a successful checkSession before the interface says so.
// Nothing here ever signs anyone out for being offline -- see checkRevocation below -- this only
// controls when the quiet "not checked recently" line appears. Matches the fifteen-day backup
// reminder closely enough to be one interval a person has to remember.
var SESSION_REVALIDATE_DAYS = 14;

// One reason -> message lookup, shared by every screen that can receive a {ok, reason} or
// {valid, reason} envelope, so a reason is never translated into user-facing text more than
// once and nothing ever branches on err.message from a google.script.run failure handler.
var REASON_MESSAGES = {
  invalid_login: 'Please contact the study to ensure the Study ID and Participant ID are correct.',
  locked: 'Too many incorrect attempts. Contact your study team to unlock your account.',
  wrong_pin: 'Incorrect PIN. Try again.',
  pin_too_short: 'Choose a PIN of at least ' + PIN_MIN_LENGTH + ' digits.',
  not_set: 'No PIN is on file yet for this participant.',
  device_not_recognized: 'Please enter your PIN again on this device.',
  offline: 'You need a connection to do this. Check your connection and try again.',
  already_answered: 'This diary was already completed.',
  edit_window_expired: 'This is too old to edit or complete now.',
  not_found: 'That entry could not be found. It may have been removed.',
  busy: 'The study server is busy right now. This will be sent automatically shortly.',
  invalid_payload: 'This entry could not be sent. Please contact your study team.'
};

var MSG_LOGIN_FAILED = 'Unable to log in. Please verify the Study ID and Participant ID are correct.';
var MSG_LOGIN_UNREACHABLE = 'Unable to reach the study server right now. Check your connection and try again.';

// The identity a PIN-setup or PIN-entry screen is currently acting on, and which of the three
// ways it got there: 'local-unlock' (a profile already exists on this device, so a verified PIN
// unwraps it), 'server-verify' (a PIN is already set server-side, but this device has no local
// profile yet), or set implicitly by beginPinSetup (no PIN exists anywhere yet). Both PIN-entry
// modes confirm the PIN with the server before doing anything else: unwrapping a local profile
// is offline-capable on its own, but a device token can only be minted server-side, and signing
// in without one would leave the app unable to write anything.
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

// Study/Participant ID submitted: routes to PIN entry (this device already has a local profile
// to unwrap, or does not) or PIN setup (nobody has chosen a PIN for this identity yet),
// depending on what this device already knows and what the server says. Only reached after
// boot()'s tryAutoResume has already failed for the last identity used on this device, so a
// profile existing locally here does not by itself mean the device is still signed in.
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

// PIN entered on the entry screen. Always confirms with the server first (verifyPin), whether
// or not this device already has a local profile to unwrap: unwrapping is local and works
// offline on its own, but only the server can mint the device token a fresh sign-in needs, so
// entering a PIN here requires connectivity either way. What 'local-unlock' still changes is
// only what happens after a successful verify -- unwrapping an existing profile rather than
// creating a new one.
async function doPinEntry() {
  var pin = document.getElementById('in-pin-entry').value;
  if (!pin) { toast('Enter your PIN'); return; }
  var id = pendingIdentity;
  var hasLocalProfile = pendingMode === 'local-unlock';
  setPinEntryBusy(true);

  verifyPin(id.studyId, id.participantId, pin, function (res) {
    if (!res || !res.ok) {
      setPinEntryBusy(false);
      showPinEntryError(REASON_MESSAGES[res && res.reason] || MSG_LOGIN_FAILED);
      return;
    }
    var established = hasLocalProfile
      ? unlockWithPin(id.studyId, id.participantId, pin, res.deviceToken)
      : createLocalProfile(id.studyId, id.participantId, id.tz, pin, res.deviceToken)
        .then(function () { return true; });

    established.then(function (unlockedOk) {
      setPinEntryBusy(false);
      if (hasLocalProfile && !unlockedOk) {
        // The server just accepted this PIN, but this device's own locally-wrapped copy did
        // not unwrap with it. Only reachable if the PIN was changed from a different device
        // after this one last signed in, which leaves this device's local copy permanently
        // under the old PIN -- there is no way to re-derive it from the new one. Not
        // auto-recovered: that would mean silently discarding an encrypted profile the
        // participant never asked to discard.
        showPinEntryError('This PIN does not match what is stored on this device. If you '
          + 'changed your PIN on another device, contact your study team about resetting this '
          + 'one.');
        return;
      }
      setLastIdentity(id.studyId, id.participantId).then(enterHome);
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
    createLocalProfile(id.studyId, id.participantId, id.tz, pin, res.deviceToken)
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
  await updateSessionNote();
  flushQueue();
  checkRevocation(true); // confirms this device is still recognised, then re-applies state
}

// Shows or hides the quiet "have not checked in a while" line, per SESSION_REVALIDATE_DAYS.
// This is purely informational -- being offline never signs anyone out (checkRevocation) -- it
// only tells the participant their entries are queued rather than confirmed recently.
async function updateSessionNote() {
  var note = document.getElementById('session-note');
  var identity = getSessionIdentity();
  if (!identity) { note.classList.add('hidden'); return; }
  var profile = await getProfile(identity.studyId, identity.participantId);
  var lastVerified = profile && profile.last_verified_utc;
  var daysSince = lastVerified ? (Date.now() - new Date(lastVerified).getTime()) / 86400000 : Infinity;
  if (daysSince > SESSION_REVALIDATE_DAYS) {
    note.textContent = 'This device has not checked in with the study server in a while. '
      + 'Your entries are still saved here.';
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

// Ends the session without touching local data: a participant who logs back in with the
// correct PIN sees the same history, unchanged. Returns to PIN entry for the same identity,
// since nothing about it was forgotten. See docs/architecture.md's local storage section.
async function doLogout() {
  var identity = getSessionIdentity();
  if (identity) await logout(identity.studyId, identity.participantId);
  showOverlay(false);
  if (identity) beginPinEntry(identity.studyId, identity.participantId, identity.tz, 'local-unlock');
  else show('screen-login');
}

// The server has the final say on the allowlist: if this participant's ID was revoked, stop
// them continuing on (possibly stale) local history. Routes through the same vault.logout as an
// explicit "Log out" -- not just clearing the in-memory session -- because the device key would
// otherwise still be sitting on disk, and the very next boot's tryAutoResume would use it to
// walk straight back into Home with no PIN prompt at all, undoing the point of logging out here.
// This still only locks, never deletes: a later re-enable should not cost the participant their
// on-device history.
function forceLogout(message) {
  var identity = getSessionIdentity();
  var cleanup = identity ? logout(identity.studyId, identity.participantId) : Promise.resolve();
  cleanup.then(function () {
    showOverlay(false);
    show('screen-login');
    if (message) toast(message);
  });
}

// A device whose token the server no longer recognises -- replaced by another device signing
// in, or cleared by the researcher -- keeps every queued and stored entry. Unlike forceLogout,
// nothing about this participant's access was actually revoked, so there is nothing to warn
// them out of; the queue simply cannot drain until the PIN is entered again to mint a fresh
// token. Clearing the local device-key material (via the same vault.logout used for an explicit
// logout) is what stops the next boot from silently auto-resuming with the token that was just
// rejected.
function softSignOut(message) {
  var identity = getSessionIdentity();
  if (!identity) return;
  logout(identity.studyId, identity.participantId).then(function () {
    showOverlay(false);
    beginPinEntry(identity.studyId, identity.participantId, identity.tz, 'local-unlock');
    if (message) toast(message);
  });
}

// Confirms this device is still the one recognised for this participant. Called on entering
// Home and History, per docs/architecture.md section 5.6: authoritative only on an explicit
// rejection from the server, never on a failure to reach it at all -- an offline participant is
// never signed out, they simply keep working and try again on the next trigger.
function checkRevocation(thenApplyHome) {
  var identity = getSessionIdentity();
  var token = getSessionToken();
  if (!identity || !token) return;
  checkSession(identity.studyId, identity.participantId, token, function (res) {
    if (res && res.ok) {
      markSessionVerified().then(updateSessionNote);
      if (thenApplyHome) applyHomeState();
      return;
    }
    if (res && res.reason === 'device_not_recognized') {
      softSignOut(REASON_MESSAGES.device_not_recognized);
      return;
    }
    forceLogout(REASON_MESSAGES[(res && res.reason) || 'invalid_login']);
  }, function () {}); // request never completed (offline/etc.) -- stay signed in, retry later
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
