// This file is part of MiNap Go
// state.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
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

// buildEvent expects study_id/participant_id/tz; the vault's session identity uses
// studyId/participantId/tz. This is the one adapter point between the two shapes.
function sessionForBuildEvent(identity) {
  return { study_id: identity.studyId, participant_id: identity.participantId, tz: identity.tz };
}

// Sleeping if the most recent event is a SLEEP with no WAKE after it.
async function computeState() {
  var hist = await getHistory();
  if (!hist.length) return 'AWAKE';
  return hist[0].event_type === 'SLEEP' ? 'SLEEPING' : 'AWAKE';
}

// The open SLEEP event, if the user is currently asleep.
async function topSleep() {
  var hist = await getHistory();
  return (hist.length && hist[0].event_type === 'SLEEP') ? hist[0] : null;
}

// If asleep for >= AUTO_WAKE_HOURS, auto-log a wake on app open.
async function maybeAutoWake() {
  var sleep = await topSleep();
  if (!sleep) return false;
  var identity = getSessionIdentity();
  if (!identity) return false;
  var hours = (Date.now() - Number(sleep.event_epoch_ms)) / 3600000;
  if (hours < AUTO_WAKE_HOURS) return false;
  var ev = buildEvent('WAKE', sessionForBuildEvent(identity));
  ev.auto = true; // local display flag only
  await recordEvent(ev);
  toast('Auto-logged wake (12h elapsed)');
  return true;
}

async function applyHomeState() {
  await maybeAutoWake();
  var st = await computeState();
  if (st === 'SLEEPING') {
    var s = await topSleep();
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
  await renderStatus();
}

async function renderStatus() {
  var chip = document.getElementById('status-chip');
  chip.textContent = (await computeState()) === 'SLEEPING' ? 'Are you ready to wake up?' : 'Are you going to sleep?';
}

async function onSleep() {
  var identity = getSessionIdentity();
  if (!identity) { show('screen-login'); return; }
  await recordEvent(buildEvent('SLEEP', sessionForBuildEvent(identity)));
  toast('Sleep logged ' + fmtClock(Date.now(), identity.tz));
  applyHomeState();
}

async function onWake() {
  var identity = getSessionIdentity();
  if (!identity) { show('screen-login'); return; }
  await recordEvent(buildEvent('WAKE', sessionForBuildEvent(identity)));
  toast('Good morning. Wake logged ' + fmtClock(Date.now(), identity.tz));
  applyHomeState();
}

// Drain the offline queue one item at a time; a failure halts the drain until the next call.
// The real drain engine (idempotent dispatch by kind, never-retry-on-revoke) is Stage 3 -- this
// keeps today's shape, only made async, so the app keeps running end to end in the meantime.
async function flushQueue() {
  var q = await getQueue();
  if (!q.length) return;
  var next = q.shift();
  await setQueue(q);
  sendEvent(next, function (ok, res) {
    if (ok && res && res.invalid) {
      toast(REASON_MESSAGES.invalid_login); // will never succeed until re-validated; don't requeue
      return;
    }
    if (!ok) {
      updateQueue(function (qq) { qq.push(res); return qq; });
    } else {
      flushQueue();
    }
  });
}

// append locally + push to server (with offline retry queue)
async function recordEvent(ev) {
  await updateHistory(function (hist) { hist.unshift(ev); return hist; });
  sendEvent(ev, function (ok, res) {
    if (ok && res && res.invalid) {
      toast(REASON_MESSAGES.invalid_login);
      return;
    }
    if (!ok) {
      updateQueue(function (q) { q.push(ev); return q; });
    }
  });
}
