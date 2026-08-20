// This file is part of MiNap Go
// history.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Sleep-history rendering, inline editing of a previous marker's date and time, and
//   the per-night entry point for completing a skipped or missing survey.
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

// The night a pair of markers describes, for deciding whether a completion entry point applies
// and for matching it to a locally-known survey record. Mirrors assignSleepDay_ on the server:
// a SLEEP names its own night directly; a WAKE with no SLEEP on this device falls back to the
// noon rule on its own local time.
function nightSleepDay(hist, night) {
  if (night.sleep) return sleepDayFromLocal(night.sleep.event_local);
  if (night.wake) return findPrecedingSleepDayLocal(hist, night.wake.event_epoch_ms, night.wake.event_local);
  return null;
}

function timeField(ev, label, queuedIds) {
  var text = label + ' ' + fmtTime(ev);
  if (!ev) return text;
  if (ev.edited) text += '<sup>*</sup>';
  if (queuedIds && queuedIds[ev.record_id]) text += ' <span class="not-sent">Not yet sent</span>';
  var extra = '';
  if (isEditable(ev)) {
    extra = ' <button type="button" class="edit-time' + (ev.edited ? ' edited' : '') + '" data-id="' + ev.record_id + '" ' +
      'aria-label="Edit ' + label.toLowerCase() + ' time">&#9998;</button>';
  }
  return text + extra;
}

async function renderHistory() {
  var box = document.getElementById('history-list');
  var hist = await getHistory();
  if (!hist.length) {
    box.innerHTML = '<div class="empty"><div class="moon">&#127769;</div><p>No nights yet. Tap Go to sleep to begin.</p></div>';
    return;
  }
  var nights = pairNights(hist);
  var surveys = await getSurveys();
  var queuedIds = await queuedRecordIds();
  var queuedSurveys = await queuedSurveyIds();

  box.innerHTML = nights.map(function (n) {
    var anchor = n.sleep || n.wake;
    var pill;
    if (n.sleep && n.wake) {
      var auto = n.wake.auto ? ' auto' : '';
      var lbl = n.wake.auto ? 'auto ' : '';
      pill = '<span class="pill' + auto + '">' + lbl + fmtDur(n.wake.event_epoch_ms - n.sleep.event_epoch_ms) + '</span>';
    } else {
      pill = '<span class="pill open">' + (n.sleep ? 'in progress' : 'wake only') + '</span>';
    }

    var sleepDay = nightSleepDay(hist, n);
    var record = sleepDay ? surveys.filter(function (s) { return s.sleep_day === sleepDay; })[0] : null;
    var completion = '';
    if (n.wake && sleepDay && !isSurveyLocked(record) && isSleepDayCompletable(sleepDay)) {
      completion = '<button type="button" class="complete-survey" data-sleep-day="' + sleepDay + '">' +
        (record ? 'Finish diary' : 'Add diary') + '</button>';
    } else if (record && isSurveyLocked(record)) {
      completion = '<span class="survey-done">Diary ' + escapeHtml(record.end_reason) +
        (queuedSurveys[record.survey_id] ? ' &middot; <span class="not-sent">Not yet sent</span>' : '') +
        '</span>';
    }

    return '' +
      '<div class="night">' +
        '<div>' +
          '<div class="date">' + fmtDate(anchor) + '</div>' +
          '<div class="times">' + timeField(n.sleep, 'Sleep', queuedIds) + ' &middot; ' + timeField(n.wake, 'Wake', queuedIds) + '</div>' +
          completion +
        '</div>' + pill +
      '</div>';
  }).join('');
}

// ----- completing a skipped or missing survey from the history list -----

async function beginCompletion(sleepDay) {
  var hist = await getHistory();
  var nights = pairNights(hist);
  var match = nights.filter(function (n) { return nightSleepDay(hist, n) === sleepDay; })[0];
  if (!match) return;
  var surveys = await getSurveys();
  var existingRecord = surveys.filter(function (s) { return s.sleep_day === sleepDay; })[0] || null;
  openSurveyForCompletion({
    sleepDay: sleepDay, sleepEvent: match.sleep, wakeEvent: match.wake, existingRecord: existingRecord
  });
}

// ----- editing a previous entry's date/time -----
async function findHistEvent(recordId) {
  var hist = await getHistory();
  for (var i = 0; i < hist.length; i++) {
    if (hist[i].record_id === recordId) return hist[i];
  }
  return null;
}

var editingRecordId = null;

async function openEditor(recordId) {
  var ev = await findHistEvent(recordId);
  if (!ev || !isEditable(ev)) return;
  editingRecordId = recordId;
  document.getElementById('edit-modal-title').textContent =
    'Edit ' + (ev.marker === 'SLEEP' ? 'sleep' : 'wake') + ' time';
  document.getElementById('edit-datetime').value = toDatetimeLocalValue(ev.event_epoch_ms, ev.event_tz);
  openModal('edit-modal');
}

function closeEditor() {
  editingRecordId = null;
  closeModal('edit-modal');
}

async function applyLocalUpdate(updated) {
  if (!updated) return;
  await updateHistory(function (hist) {
    for (var i = 0; i < hist.length; i++) {
      if (hist[i].record_id === updated.record_id) { hist[i] = updated; break; }
    }
    return hist;
  });
}

async function saveEditor() {
  var ev = await findHistEvent(editingRecordId);
  if (!ev || !getSessionIdentity()) { closeEditor(); return; }

  var val = document.getElementById('edit-datetime').value; // "YYYY-MM-DDTHH:mm"
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(val || '');
  if (!m) { toast('Enter a valid date and time'); return; }

  var epoch = epochFromWallTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), ev.event_tz);
  var clientEditUtc = new Date().toISOString();
  var updated = Object.assign({}, ev, {
    event_epoch_ms: epoch,
    event_utc: new Date(epoch).toISOString(),
    event_local: toLocalIsoWithOffset(epoch, ev.event_tz),
    edited: true
  });

  // Show the edit immediately, the same optimistic-first pattern recordEvent uses for a new
  // marker. The queued request below reconciles with the server's authoritative row once it
  // lands, whether that is now or after the app is next online.
  await applyLocalUpdate(updated);
  closeEditor();
  renderHistory();

  await enqueue('marker_edit', { event: updated, client_edit_utc: clientEditUtc });
  flushQueue();
  toast('Time updated. Sending…');
}
