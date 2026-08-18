// This file is part of MiNap Go
// state.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: The Sleep/Wake state machine -- derives whether the participant is currently
//   asleep from local history, records new events, and drains the offline retry queue.
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

var AUTO_WAKE_HOURS = 12; // auto-wake if asleep for more than this many hours

// Sleeping if the most recent event is a SLEEP with no WAKE after it.
function computeState() {
  var hist = load(K_HISTORY, []);
  if (!hist.length) return 'AWAKE';
  return hist[0].event_type === 'SLEEP' ? 'SLEEPING' : 'AWAKE';
}

// The open SLEEP event, if the user is currently asleep.
function topSleep() {
  var hist = load(K_HISTORY, []);
  return (hist.length && hist[0].event_type === 'SLEEP') ? hist[0] : null;
}

// If asleep for >= AUTO_WAKE_HOURS, auto-log a wake on app open.
function maybeAutoWake() {
  var sleep = topSleep();
  if (!sleep) return false;
  var session = load(K_SESSION, null);
  if (!session) return false;
  var hours = (Date.now() - Number(sleep.event_epoch_ms)) / 3600000;
  if (hours < AUTO_WAKE_HOURS) return false;
  var ev = buildEvent('WAKE', session);
  ev.auto = true; // local display flag only
  recordEvent(ev);
  toast('Auto-logged wake (12h elapsed)');
  return true;
}

function applyHomeState() {
  maybeAutoWake();
  var st = computeState();
  if (st === 'SLEEPING') {
    var s = topSleep();
    var label = fmtClock(s.event_epoch_ms, s.event_tz);
    if (!sameDay(s.event_epoch_ms, s.event_tz)) {
      label = new Date(s.event_epoch_ms)
        .toLocaleDateString('en-US', { timeZone: s.event_tz, weekday: 'short' }) + ' ' + label;
    }
    document.getElementById('asleep-since').textContent = 'Since ' + label;
    showOverlay(true);
  } else {
    showOverlay(false);
  }
  renderStatus();
}

function renderStatus() {
  var chip = document.getElementById('status-chip');
  chip.textContent = computeState() === 'SLEEPING' ? 'Are you ready to wake up?' : 'Are you going to sleep?';
}

function onSleep() {
  var session = load(K_SESSION, null);
  if (!session) { show('screen-login'); return; }
  recordEvent(buildEvent('SLEEP', session));
  toast('Sleep logged ' + fmtClock(Date.now(), session.tz));
  applyHomeState();
}

function onWake() {
  var session = load(K_SESSION, null);
  if (!session) { show('screen-login'); return; }
  recordEvent(buildEvent('WAKE', session));
  toast('Good morning. Wake logged ' + fmtClock(Date.now(), session.tz));
  applyHomeState();
}

// Drain the offline queue one item at a time; a failure halts the drain until the next call.
function flushQueue() {
  var q = load(K_QUEUE, []);
  if (!q.length) return;
  var next = q.shift();
  save(K_QUEUE, q);
  sendEvent(next, function (ok, res) {
    if (ok && res && res.invalid) {
      toast(MSG_INVALID_CREDENTIALS); // will never succeed until re-validated; don't requeue
      return;
    }
    if (!ok) {
      var qq = load(K_QUEUE, []); qq.push(res); save(K_QUEUE, qq);
    } else {
      flushQueue();
    }
  });
}

// append locally + push to server (with offline retry queue)
function recordEvent(ev) {
  var hist = load(K_HISTORY, []);
  hist.unshift(ev);
  save(K_HISTORY, hist);
  sendEvent(ev, function (ok, res) {
    if (ok && res && res.invalid) {
      toast(MSG_INVALID_CREDENTIALS);
      return;
    }
    if (!ok) {
      var q = load(K_QUEUE, []); q.push(ev); save(K_QUEUE, q);
    }
  });
}
