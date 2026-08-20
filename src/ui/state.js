// This file is part of MiNap Go
// state.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: The Sleep/Wake state machine -- derives whether the participant is currently
//   asleep from local history, records new markers, and drains the offline retry queue. Every
//   write (a marker, a marker edit, or a survey) goes through the same queue: appended to local
//   storage first, then enqueued, then a drain is attempted immediately -- so a write that
//   cannot reach the server yet is never lost, only delayed.
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
  return hist[0].marker === 'SLEEP' ? 'SLEEPING' : 'AWAKE';
}

// The open SLEEP event, if the user is currently asleep.
async function topSleep() {
  var hist = await getHistory();
  return (hist.length && hist[0].marker === 'SLEEP') ? hist[0] : null;
}

// If asleep for >= AUTO_WAKE_HOURS, auto-log a wake on app open. Does not open the survey --
// the participant did not just tap Wake, so nothing has established they are present to answer
// it. The night stays completable later through history's completion entry point.
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

// Tapping Sleep means "I am trying to go to sleep now" -- not bedtime, and not lights-out.
// Getting into and out of bed are separate questions in the morning diary (architecture.md
// section 3.4.2).
async function onSleep() {
  var identity = getSessionIdentity();
  if (!identity) { show('screen-login'); return; }
  await recordEvent(buildEvent('SLEEP', sessionForBuildEvent(identity)));
  toast('Sleep logged ' + fmtClock(Date.now(), identity.tz));
  applyHomeState();
}

// Tapping Wake means "I woke up for the last time" -- getting out of bed is asked separately as
// Q07. Opens the morning survey immediately, prefilled from this WAKE and the SLEEP it closes,
// per architecture.md section 3.4.2.
async function onWake() {
  var identity = getSessionIdentity();
  if (!identity) { show('screen-login'); return; }
  var sleepEvent = await topSleep(); // read before recording, which flips the computed state
  var wakeEvent = buildEvent('WAKE', sessionForBuildEvent(identity));
  await recordEvent(wakeEvent);
  showOverlay(false);
  openSurveyForNight(sleepEvent, wakeEvent);
}

// Appends a raw marker/edit/survey draft to the offline queue. The queued payload never carries
// a credential -- toLogMarkerPayload/toUpdateMarkerPayload/toLogSurveyPayload attach the current
// device token only at send time, so a queue item sitting on disk for days is never a stored
// secret.
function enqueue(kind, payload) {
  return updateQueue(function (q) {
    q.push({ queue_id: uuid(), kind: kind, payload: payload, enqueued_at: new Date().toISOString() });
    return q;
  });
}
function dequeue(queueId) {
  return updateQueue(function (q) { return q.filter(function (item) { return item.queue_id !== queueId; }); });
}

// Every marker record_id that still has a queue item waiting to be confirmed -- the "not yet
// sent" indicator history.js shows next to a Sleep or Wake time. Covers both a fresh marker
// (kind 'marker') and a queued edit to one (kind 'marker_edit'), since either leaves the
// participant's own device unsure whether the Sheet has caught up yet.
async function queuedRecordIds() {
  var q = await getQueue();
  var ids = {};
  q.forEach(function (item) {
    if (item.kind === 'marker' && item.payload) ids[item.payload.record_id] = true;
    else if (item.kind === 'marker_edit' && item.payload && item.payload.event) {
      ids[item.payload.event.record_id] = true;
    }
  });
  return ids;
}

// Every survey_id that still has a queue item waiting to be confirmed -- the "not yet sent"
// indicator history.js's per-night status shows once a survey has been submitted, skipped, or
// abandoned locally but not yet acknowledged by the server.
async function queuedSurveyIds() {
  var q = await getQueue();
  var ids = {};
  q.forEach(function (item) {
    if (item.kind === 'survey' && item.payload) ids[item.payload.survey_id] = true;
  });
  return ids;
}

function payloadForQueueItem(item) {
  if (item.kind === 'marker') return toLogMarkerPayload(item.payload);
  if (item.kind === 'marker_edit') return toUpdateMarkerPayload(item.payload.event, item.payload.client_edit_utc);
  if (item.kind === 'survey') return toLogSurveyPayload(item.payload);
  return null;
}
function senderForQueueItem(item) {
  if (item.kind === 'marker') return logMarker;
  if (item.kind === 'marker_edit') return updateMarker;
  if (item.kind === 'survey') return logSurvey;
  return null;
}

// Reasons the server will never accept no matter how many times the same item is resent. Left
// queued, one of these would jam every later item behind it forever, so these are dropped (with
// a message) rather than retried -- the same treatment section 14.1 already gives invalid_login,
// extended to the completion-guard and edit-window reasons a survey resend can also hit.
var QUEUE_TERMINAL_REASONS = [
  'invalid_login', 'already_answered', 'edit_window_expired', 'invalid_payload', 'not_found'
];

// Drains the offline queue oldest-first, one item at a time. Nothing leaves the queue until the
// server actually confirms it; a transport failure or a transient server reason (busy) halts the
// drain until the next trigger -- boot when online, the 'online' event, or right after
// enqueueing -- so a server problem cannot turn into a flood of retries, and items keep their
// original order.
async function flushQueue() {
  var q = await getQueue();
  if (!q.length) return;
  var item = q[0];
  var payload = payloadForQueueItem(item);
  var sender = senderForQueueItem(item);
  if (!payload || !sender) { await dequeue(item.queue_id); return flushQueue(); } // unrecognised kind

  sender(payload, function (ok, res) {
    if (!ok) return; // request never completed: stop the drain, retry later

    if (res && res.ok) {
      dequeue(item.queue_id).then(flushQueue);
      return;
    }
    if (res && res.reason === 'device_not_recognized') {
      softSignOut(REASON_MESSAGES.device_not_recognized); // stops the drain; queue is untouched
      return;
    }
    if (res && QUEUE_TERMINAL_REASONS.indexOf(res.reason) !== -1) {
      toast(REASON_MESSAGES[res.reason] || 'This entry could not be sent.');
      dequeue(item.queue_id).then(flushQueue);
      return;
    }
    // Any other reason (busy, or one this build does not recognise): stop the drain, retry later.
  });
}

// append locally + enqueue + attempt to send now (falls back to the offline queue automatically
// if the attempt does not complete)
async function recordEvent(ev) {
  await updateHistory(function (hist) { hist.unshift(ev); return hist; });
  await enqueue('marker', ev);
  flushQueue();
}
