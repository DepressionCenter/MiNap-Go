// This file is part of MiNap Go
// boot.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-18
// Summary: Startup: loads server config, wires DOM event listeners, and restores a saved
//   session or shows the login screen.
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

function loadConfig() {
  getConfig(function (cfg) { if (cfg && cfg.editWindowDays) editWindowDays = cfg.editWindowDays; }, function () {});
}

function boot() {
  buildTzOptions();
  loadConfig();
  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-sleep').addEventListener('click', onSleep);
  document.getElementById('btn-wake').addEventListener('click', onWake);
  document.getElementById('btn-history').addEventListener('click', function () {
    renderHistory();
    showOverlay(false);
    show('screen-history');
    checkRevocation(false); // catches a revoked ID
  });
  document.getElementById('btn-back').addEventListener('click', function () { show('screen-home'); applyHomeState(); });
  document.getElementById('history-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.edit-time');
    if (btn) openEditor(btn.getAttribute('data-id'));
  });
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditor);
  document.getElementById('btn-edit-save').addEventListener('click', saveEditor);

  if (load(K_SESSION, null)) enterHome();
  else show('screen-login');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
