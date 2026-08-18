// This file is part of MiNap Go
// storage.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: localStorage access for the MiNap Go client. The only file, in either build, that
//   may reference localStorage directly.
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

var K_SESSION = 'minap.session';
var K_HISTORY = 'minap.history';
var K_QUEUE = 'minap.queue';

function load(key, fallback) {
  try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
function clearAll() {
  [K_SESSION, K_HISTORY, K_QUEUE].forEach(function (k) {
    try { localStorage.removeItem(k); } catch (e) {}
  });
}
