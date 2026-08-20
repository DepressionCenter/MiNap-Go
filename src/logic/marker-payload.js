// This file is part of MiNap Go
// marker-payload.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: Turns a local marker event into the payload logMarker/updateMarker expect on the
//   wire. The device token is read from the vault at call time rather than stored on the event
//   itself, so a marker sitting in the offline queue never carries a credential. No browser or
//   Apps Script globals; identical in both builds.
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

// Matches logMarker's payload exactly (src/server/Code.gs). study_id/participant_id come from
// the event itself rather than the session, so a queued marker still sends the identity it was
// recorded under even if the session has since changed.
function toLogMarkerPayload(event) {
  return {
    study_id: event.study_id,
    participant_id: event.participant_id,
    device_token: getSessionToken(),
    record_id: event.record_id,
    marker: event.marker,
    event_local: event.event_local,
    event_tz: event.event_tz,
    event_utc: event.event_utc,
    source: 'web',
    app_version: APP_VERSION
  };
}

// Matches updateMarker's payload. client_edit_utc is the instant the edit was made on the
// device, not when it happens to reach the server -- an edit made inside the edit window but
// queued offline is judged by when it was made, per section 10 of the architecture
// specification, so this has to be captured once, at edit time, and carried with the queued item
// rather than recomputed when the queue finally drains.
function toUpdateMarkerPayload(editedEvent, clientEditUtc) {
  return {
    study_id: editedEvent.study_id,
    participant_id: editedEvent.participant_id,
    device_token: getSessionToken(),
    record_id: editedEvent.record_id,
    event_local: editedEvent.event_local,
    event_tz: editedEvent.event_tz,
    event_utc: editedEvent.event_utc,
    client_edit_utc: clientEditUtc,
    source: 'web',
    app_version: APP_VERSION
  };
}
