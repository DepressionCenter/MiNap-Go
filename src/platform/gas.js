// This file is part of MiNap Go
// gas.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Environment adapter for the Apps Script build. Wraps every google.script.run call
//   site behind a named function so the rest of the client never references
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

// Sends one Sleep/Wake event to the server. onDone(ok, data): on success, data is the
// server's { invalid, row } envelope; on failure (request never completed), data is the
// original payload, for requeueing.
function sendEvent(payload, onDone) {
  google.script.run
    .withSuccessHandler(function (res) { onDone(true, res); })
    .withFailureHandler(function () { onDone(false, payload); })
    .logEvent(payload);
}

// Re-checks a Study ID / Participant ID against the server's Setup-sheet allowlist.
function validateLogin(studyId, participantId, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .validateLogin(studyId, participantId);
}

// Saves an edited Sleep/Wake time, subject to the server's edit window.
function updateEvent(payload, onSuccess, onFailure) {
  google.script.run
    .withSuccessHandler(onSuccess)
    .withFailureHandler(onFailure)
    .updateEvent(payload);
}

// Fetches server-side settings the UI needs (edit window length, app version).
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
