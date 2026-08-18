// This file is part of MiNap Go
// history.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: Sleep-history rendering and inline editing of a previous entry's date and time.
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

function pairNights(events) {
  var asc = events.slice().sort(function (a, b) { return a.event_epoch_ms - b.event_epoch_ms; });
  var nights = [];
  var openSleep = null;
  asc.forEach(function (e) {
    if (e.event_type === 'SLEEP') {
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

function timeField(ev, label) {
  var text = label + ' ' + fmtTime(ev);
  if (!ev) return text;
  var edited = ev.edited === 'TRUE' || ev.edited === true;
  if (edited) text += '<sup>*</sup>';
  var extra = '';
  if (isEditable(ev)) {
    extra = ' <button type="button" class="edit-time' + (edited ? ' edited' : '') + '" data-id="' + ev.record_id + '" ' +
      'aria-label="Edit ' + label.toLowerCase() + ' time">&#9998;</button>';
  }
  return text + extra;
}

function renderHistory() {
  var box = document.getElementById('history-list');
  var hist = load(K_HISTORY, []);
  if (!hist.length) {
    box.innerHTML = '<div class="empty"><div class="moon">&#127769;</div><p>No nights yet. Tap Go to sleep to begin.</p></div>';
    return;
  }
  var nights = pairNights(hist);
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
    return '' +
      '<div class="night">' +
        '<div>' +
          '<div class="date">' + fmtDate(anchor) + '</div>' +
          '<div class="times">' + timeField(n.sleep, 'Sleep') + ' &middot; ' + timeField(n.wake, 'Wake') + '</div>' +
        '</div>' + pill +
      '</div>';
  }).join('');
}

// ----- editing a previous entry's date/time -----
function findHistEvent(recordId) {
  var hist = load(K_HISTORY, []);
  for (var i = 0; i < hist.length; i++) {
    if (hist[i].record_id === recordId) return hist[i];
  }
  return null;
}

var editingRecordId = null;

function openEditor(recordId) {
  var ev = findHistEvent(recordId);
  if (!ev || !isEditable(ev)) return;
  editingRecordId = recordId;
  document.getElementById('edit-modal-title').textContent =
    'Edit ' + (ev.event_type === 'SLEEP' ? 'sleep' : 'wake') + ' time';
  document.getElementById('edit-datetime').value = toDatetimeLocalValue(ev.event_epoch_ms, ev.event_tz);
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditor() {
  editingRecordId = null;
  document.getElementById('edit-modal').classList.add('hidden');
}

function applyServerUpdate(saved) {
  if (!saved) return;
  var hist = load(K_HISTORY, []);
  for (var i = 0; i < hist.length; i++) {
    if (hist[i].record_id === saved.record_id) { hist[i] = saved; break; }
  }
  save(K_HISTORY, hist);
}

function saveEditor() {
  var ev = findHistEvent(editingRecordId);
  var session = load(K_SESSION, null);
  if (!ev || !session) { closeEditor(); return; }

  var val = document.getElementById('edit-datetime').value; // "YYYY-MM-DDTHH:mm"
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(val || '');
  if (!m) { toast('Enter a valid date and time'); return; }

  var epoch = epochFromWallTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), ev.event_tz);
  var d = new Date(epoch);
  var updated = {
    record_id: ev.record_id,
    study_id: session.study_id,
    participant_id: session.participant_id,
    event_epoch_ms: epoch,
    event_iso_utc: d.toISOString(),
    event_tz: ev.event_tz,
    event_local: d.toLocaleString('en-US', { timeZone: ev.event_tz, hour12: true })
  };

  // Show the edit immediately (same optimistic-first pattern as logging a new event);
  // the server round-trip below reconciles with the authoritative row afterward.
  applyServerUpdate(Object.assign({}, ev, updated, { edited: 'TRUE' }));
  closeEditor();
  renderHistory();

  var btn = document.getElementById('btn-edit-save');
  btn.disabled = true;
  updateEvent(updated, function (res) {
    btn.disabled = false;
    if (res && res.invalid) { toast(MSG_INVALID_CREDENTIALS); return; }
    applyServerUpdate(res && res.row);
    renderHistory();
    toast('Time updated');
  }, function () {
    btn.disabled = false;
    toast('Could not save. Try again.');
  });
}
