// This file is part of MiNap Go
// event.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: The Sleep/Wake event object shape, shared by both builds. No browser or Apps
//   Script globals; identical in both builds.
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

function buildEvent(type, session, epochMs) {
  var ms = epochMs || Date.now();
  var d = new Date(ms);
  return {
    record_id: uuid(),
    study_id: session.study_id,
    participant_id: session.participant_id,
    event_type: type,
    event_epoch_ms: ms,
    event_iso_utc: d.toISOString(),
    event_tz: session.tz,
    event_local: d.toLocaleString('en-US', { timeZone: session.tz, hour12: true }),
    app_version: APP_VERSION
  };
}
