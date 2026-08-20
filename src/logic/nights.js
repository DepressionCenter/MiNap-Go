// This file is part of MiNap Go
// nights.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: Pairs SLEEP and WAKE markers into nights. Domain logic rather than a rendering
//   concern, since the survey-completion flow needs the same grouping the history screen does.
//   No browser or Apps Script globals; identical in both builds.
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

// Walks local history oldest-first, closing each SLEEP with the next WAKE it meets. A SLEEP with
// no WAKE yet (still asleep, or the pair was interrupted) surfaces with wake: null; a WAKE with
// no preceding SLEEP (the very first entry on a device, or a missed tap) surfaces with
// sleep: null. Returned newest-first, matching how the history screen lists nights.
function pairNights(events) {
  var asc = events.slice().sort(function (a, b) { return a.event_epoch_ms - b.event_epoch_ms; });
  var nights = [];
  var openSleep = null;
  asc.forEach(function (e) {
    if (e.marker === 'SLEEP') {
      if (openSleep) nights.push({ sleep: openSleep, wake: null });
      openSleep = e;
    } else {
      nights.push({ sleep: openSleep, wake: e });
      openSleep = null;
    }
  });
  if (openSleep) nights.push({ sleep: openSleep, wake: null });
  return nights.reverse();
}
