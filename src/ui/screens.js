// This file is part of MiNap Go
// screens.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Screen show/hide, toasts, and the timezone dropdown, plus the shared modal helpers
//   (focus trap and restore live in dialog.js, wired in behind these).
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

// Iterates every element carrying the .screen class rather than a hardcoded id list, so a new
// screen only has to be marked up with that class to participate -- nothing here has to change.
function show(id) {
  document.querySelectorAll('.screen').forEach(function (s) {
    s.classList.toggle('hidden', s.id !== id);
  });
}
function showOverlay(on) {
  var el = document.getElementById('sleep-overlay');
  el.classList.toggle('hidden', !on);
  if (on) trapFocus(el); else releaseFocus();
}

// Shows/hides one of the modal dialogs, trapping and restoring focus around it. Every dialog in
// the app routes through these two functions, so that work is written once rather than per
// dialog.
function openModal(id) {
  var el = document.getElementById(id);
  el.classList.remove('hidden');
  trapFocus(el);
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  releaseFocus();
}

var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
}

// Best-effort local timezone via Intl; falls back to a sane default if unavailable.
function detectTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Detroit'; }
  catch (e) { return 'America/Detroit'; }
}
// Populate the timezone dropdown, defaulting to the browser-detected zone.
function buildTzOptions() {
  var sel = document.getElementById('in-tz');
  var auto = detectTz();
  var zones = [
    'America/New_York', 'America/Detroit', 'America/Chicago', 'America/Denver',
    'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
    'America/Toronto', 'Europe/London', 'UTC'
  ];
  if (zones.indexOf(auto) === -1) zones.unshift(auto);
  sel.innerHTML = '';
  zones.forEach(function (z) {
    var o = document.createElement('option');
    o.value = z;
    o.textContent = (z === auto) ? (z + ' (detected)') : z;
    if (z === auto) o.selected = true;
    sel.appendChild(o);
  });
}
