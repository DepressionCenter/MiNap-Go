// This file is part of MiNap Go
// sleep-day.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: A client-side mirror of the server's sleep_day rule (src/server/Code.gs's
//   sleepDayFromWallClock_ and the backward SLEEP lookup) and its inverse (which calendar date a
//   survey's clock-time answer falls on, given the night it describes). Used for local display
//   only -- which night a completable survey belongs to, a preview of a repaired WAKE pairing
//   right after editing a SLEEP marker, and turning a survey's time inputs into stored local-ISO
//   values. The server's own sleep_day is always what is stored; see docs/architecture.md
//   section 3.5.1. No browser or Apps Script globals; identical in both builds.
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

// Mirrors sleepDayFromWallClock_ exactly: a night starting before noon local time belongs to the
// previous calendar day. Takes plain wall-clock components rather than a Date built in the
// browser's own zone, so a participant traveling away from their study time zone still gets the
// date that belongs to the clock they read, not the date the device happens to be sitting in.
function sleepDayFromWallClock(year, month, day, hour) {
  var d = new Date(Date.UTC(year, month - 1, day));
  if (hour < 12) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// The inverse of sleepDayFromWallClock: given a night and a clock time on it, which calendar
// date does that clock time fall on? A time before noon belongs to the morning after the night
// started; noon onward belongs to the same evening, per architecture.md section 4.1.
function dateForClockOnSleepDay(sleepDay, hour) {
  var s = String(sleepDay).split('-').map(Number);
  var d = new Date(Date.UTC(s[0], s[1] - 1, s[2]));
  if (hour < 12) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A survey's `time` question only asks for a clock reading (architecture.md section 3.4); the
// calendar date is derived from the night being described, via dateForClockOnSleepDay, then
// combined with the participant's time zone into the stored local-ISO-with-offset form.
function localIsoForTimeAnswer(sleepDay, hhmm, tz) {
  var m = /^(\d{2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  var hour = Number(m[1]), minute = Number(m[2]);
  var dateStr = dateForClockOnSleepDay(sleepDay, hour);
  var d = dateStr.split('-').map(Number);
  return toLocalIsoWithOffset(epochFromWallTime(d[0], d[1], d[2], hour, minute, tz), tz);
}

// A survey's `datetime` question asks for the date directly, so no sleep_day derivation applies.
function localIsoForDatetimeAnswer(dateStr, hhmm, tz) {
  var d = String(dateStr).split('-').map(Number);
  var m = /^(\d{2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  return toLocalIsoWithOffset(epochFromWallTime(d[0], d[1], d[2], Number(m[1]), Number(m[2]), tz), tz);
}

// Reads the date and hour straight out of a local ISO string (as toLocalIsoWithOffset produces,
// or as the datetime-local edit field's "YYYY-MM-DDTHH:mm" value already is) without ever
// constructing a browser-local Date from it, which would reinterpret the wall-clock numbers
// through whatever zone the device itself is in.
function sleepDayFromLocal(localIso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localIso || ''));
  if (!m) return null;
  return sleepDayFromWallClock(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
}

// Mirrors findPrecedingSleepDay_: the sleep_day a WAKE at or after beforeEpochMs should carry is
// the most recent SLEEP's own sleep_day, or -- if this device holds no SLEEP before it at all --
// the noon rule applied to the WAKE's own local time.
//
// @param {Array<Object>} events Local history entries, each carrying marker, event_epoch_ms,
//     and event_local. Order does not matter; every SLEEP is considered.
// @param {number} beforeEpochMs The WAKE's own instant. A SLEEP at or before this counts.
// @param {string} fallbackLocalIso The WAKE's own event_local, used only if no SLEEP qualifies.
// @return {?string} 'YYYY-MM-DD', or null if fallbackLocalIso cannot be parsed either.
function findPrecedingSleepDayLocal(events, beforeEpochMs, fallbackLocalIso) {
  var mostRecent = null;
  (events || []).forEach(function (e) {
    if (!e || e.marker !== 'SLEEP' || e.event_epoch_ms > beforeEpochMs) return;
    if (!mostRecent || e.event_epoch_ms > mostRecent.event_epoch_ms) mostRecent = e;
  });
  return mostRecent ? sleepDayFromLocal(mostRecent.event_local) : sleepDayFromLocal(fallbackLocalIso);
}
