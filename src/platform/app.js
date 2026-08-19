// This file is part of MiNap Go
// app.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Environment adapter for the standalone build. There is no server in this build, so
//   every function throws rather than returning a value -- a silent no-op would let a future
//   caller believe a submission succeeded when nothing happened.
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

function sendEvent(payload, onDone) {
  throw new Error('sendEvent is not available in the standalone build');
}

function validateLogin(studyId, participantId, onSuccess, onFailure) {
  throw new Error('validateLogin is not available in the standalone build');
}

function updateEvent(payload, onSuccess, onFailure) {
  throw new Error('updateEvent is not available in the standalone build');
}

function getConfig(onSuccess, onFailure) {
  throw new Error('getConfig is not available in the standalone build');
}

function setPin(studyId, participantId, newPin, oldPin, onSuccess, onFailure) {
  throw new Error('setPin is not available in the standalone build');
}

function verifyPin(studyId, participantId, pin, onSuccess, onFailure) {
  throw new Error('verifyPin is not available in the standalone build');
}

function checkSession(studyId, participantId, deviceToken, onSuccess, onFailure) {
  throw new Error('checkSession is not available in the standalone build');
}

function signOutDevice(studyId, participantId, deviceToken, onSuccess, onFailure) {
  throw new Error('signOutDevice is not available in the standalone build');
}
