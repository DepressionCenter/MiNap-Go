// This file is part of MiNap Go
// edit-window.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: Edit-window validation -- whether a logged Sleep/Wake time is still recent enough
//   to edit. No browser or Apps Script globals; identical in both builds.
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

var editWindowDays = 7; // fallback until server config loads (see loadConfig)

// Editable if this specific event's own logged time is within the edit window.
function isEditable(ev) {
  if (!ev) return false;
  var ageDays = (Date.now() - Number(ev.event_epoch_ms)) / 86400000;
  return ageDays <= editWindowDays;
}
