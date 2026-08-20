// This file is part of MiNap Go
// edit-window.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Edit-window validation -- whether a logged Sleep/Wake time is still recent enough
//   to edit, and whether a skipped or missing survey is still recent enough to complete. No
//   browser or Apps Script globals; identical in both builds.
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

// Mirrors the server's daysSinceSleepDay_: whole calendar days between a sleep_day and today,
// with no time-of-day component -- a survey is measured by the night it describes, not by an
// instant, the same "measured from the stored value" principle isEditable applies to markers.
// Lets the history screen hide a completion entry point before ever asking the server, using the
// same day count logSurvey's own guard enforces.
function isSleepDayCompletable(sleepDay) {
  var s = String(sleepDay).split('-').map(Number);
  var sleepDayUtc = Date.UTC(s[0], s[1] - 1, s[2]);
  var t = new Date().toISOString().slice(0, 10).split('-').map(Number);
  var todayUtc = Date.UTC(t[0], t[1] - 1, t[2]);
  var ageDays = Math.round((todayUtc - sleepDayUtc) / 86400000);
  return ageDays <= editWindowDays;
}
