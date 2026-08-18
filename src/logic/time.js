// This file is part of MiNap Go
// time.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: Timezone and epoch-millisecond conversions used by history rendering and time
//   editing in both builds. No browser or Apps Script globals; identical in both builds.
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

function fmtClock(epochMs, tz) {
  return new Date(epochMs).toLocaleTimeString('en-US',
    { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}
function sameDay(epochMs, tz) {
  var opt = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Date(epochMs).toLocaleDateString('en-US', opt) ===
         new Date().toLocaleDateString('en-US', opt);
}
function fmtTime(ev) { return ev ? fmtClock(ev.event_epoch_ms, ev.event_tz) : '--'; }
function fmtDate(ev) {
  return new Date(ev.event_epoch_ms).toLocaleDateString('en-US',
    { timeZone: ev.event_tz, weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDur(ms) {
  var m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

// Format an instant as "YYYY-MM-DDTHH:mm" in the given IANA tz, for a datetime-local input.
function toDatetimeLocalValue(epochMs, tz) {
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  var p = dtf.formatToParts(new Date(epochMs)).reduce(function (acc, x) { acc[x.type] = x.value; return acc; }, {});
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
}

// How far the wall clock in tz differs from UTC at this instant (ms), via Intl (no tz library).
function tzOffsetMs(date, tz) {
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  var p = dtf.formatToParts(date).reduce(function (acc, x) { acc[x.type] = x.value; return acc; }, {});
  var asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

// Wall-clock date/time components as read in tz -> epoch ms. Two passes to settle across DST edges.
function epochFromWallTime(y, mo, d, h, mi, tz) {
  var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  var offset = tzOffsetMs(new Date(guess), tz);
  var epoch = guess - offset;
  offset = tzOffsetMs(new Date(epoch), tz);
  return guess - offset;
}
