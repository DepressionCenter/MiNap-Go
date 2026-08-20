// This file is part of MiNap Go
// event.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: The Sleep/Wake marker object shape, shared by both builds. Field names match the
//   logMarker/updateMarker payload contract in src/server/Code.gs exactly, so nothing between
//   here and the server has to translate one name into another. No browser or Apps Script
//   globals; identical in both builds.
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

var APP_VERSION = '1.0.0';

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// identity is a plain {study_id, participant_id, tz} object, not the vault's own in-memory
// session -- kept distinctly named so the two are never confused once every src/data and
// src/logic file is concatenated into one script scope by build.py.
//
// Field names (marker, event_utc, event_local, event_tz) match logMarker's payload exactly, so
// marker-payload.js can pass this object straight through with only the credential added.
function buildEvent(marker, identity, epochMs) {
  var ms = epochMs || Date.now();
  return {
    record_id: uuid(),
    study_id: identity.study_id,
    participant_id: identity.participant_id,
    marker: marker,
    event_epoch_ms: ms, // local-only convenience for sorting/pairing; never sent to the server
    event_utc: new Date(ms).toISOString(),
    event_tz: identity.tz,
    event_local: toLocalIsoWithOffset(ms, identity.tz),
    app_version: APP_VERSION
  };
}
