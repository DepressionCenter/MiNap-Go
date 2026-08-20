// This file is part of MiNap Go
// gas.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Environment adapter for the Apps Script build. Wraps every google.script.run call
//   site behind a named function, matching the server's actual public functions in
//   src/server/Code.gs (logMarker, updateMarker, logSurvey -- not the pre-Phase-2 logEvent/
//   updateEvent, which no longer exist), so the rest of the client never references
//   google.script.run directly -- this is the only file allowed to.
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

// Sends one Sleep/Wake marker to the server. onDone(ok, data): on success, data is the server's
// {ok, reason, sleep_day} envelope; on failure (the request never completed), data is the
// original payload, unchanged, so the caller can requeue it.
function logMarker(payload, onDone) {
  google.script.run
    .withSuccessHandler(function (res) { onDone(true, res); })
    .withFailureHandler(function () { onDone(false, payload); })
    .logMarker(payload);
}

// Re-checks a Study ID / Participant ID against the server's Setup-sheet allowlist.
function validateLogin(studyId, participantId, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .validateLogin(studyId, participantId);
}

// Saves an edited Sleep/Wake time, subject to the server's edit window. Same onDone(ok, data)
// shape as logMarker, so both can be drained by the same offline queue.
function updateMarker(payload, onDone) {
  google.script.run
    .withSuccessHandler(function (res) { onDone(true, res); })
    .withFailureHandler(function () { onDone(false, payload); })
    .updateMarker(payload);
}

// Sends one survey and every answer it showed. Same onDone(ok, data) shape as logMarker.
function logSurvey(payload, onDone) {
  google.script.run
    .withSuccessHandler(function (res) { onDone(true, res); })
    .withFailureHandler(function () { onDone(false, payload); })
    .logSurvey(payload);
}

// Fetches server-side settings the UI needs (edit window length, app version, visible questions).
function getConfig(onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .getConfig();
}

// Sets a participant's PIN for the first time, or changes it (oldPin is required and checked
// only when one is already on file). onSuccess receives {ok, reason}; onFailure fires only on a
// transport failure (offline, etc.), never on a rejected PIN -- that arrives as ok:false.
function setPin(studyId, participantId, newPin, oldPin, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .setPin(studyId, participantId, newPin, oldPin);
}

// Checks a PIN against the one on file, for logging in on a device with no local profile yet.
function verifyPin(studyId, participantId, pin, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .verifyPin(studyId, participantId, pin);
}

// Confirms this participant is still enabled and this device's token is still the one on file.
// Called on entering Home and History, and periodically per SESSION_REVALIDATE_DAYS; a rejected
// token here never deletes anything locally on its own, it only routes the interface back to a
// sign-in prompt.
function checkSession(studyId, participantId, deviceToken, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .checkSession(studyId, participantId, deviceToken);
}

// Best-effort: tells the server to forget this device's token on logout. onFailure (offline,
// etc.) is treated the same as success by every caller -- the local device-session material is
// what actually needs to go, and that is deleted regardless of whether this call lands.
function signOutDevice(studyId, participantId, deviceToken, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .signOutDevice(studyId, participantId, deviceToken);
}
