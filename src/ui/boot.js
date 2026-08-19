// This file is part of MiNap Go
// boot.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Startup: loads server config, wires DOM event listeners, and shows the login screen,
//   pre-filled with the last identity used on this device if there is one.
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

async function boot() {
  buildTzOptions();
  loadConfig();

  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-switch-account').addEventListener('click', doSwitchAccount);
  document.getElementById('btn-pin-entry').addEventListener('click', doPinEntry);
  document.getElementById('btn-pin-entry-back').addEventListener('click', backToLogin);
  document.getElementById('btn-pin-setup').addEventListener('click', doPinSetup);
  document.getElementById('btn-pin-setup-back').addEventListener('click', backToLogin);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-change-pin').addEventListener('click', openChangePinModal);
  document.getElementById('btn-change-pin-cancel').addEventListener('click', closeChangePinModal);
  document.getElementById('btn-change-pin-save').addEventListener('click', doChangePin);
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

  var last = await getLastIdentity();
  if (last) {
    document.getElementById('in-study').value = last.study_id;
    document.getElementById('in-part').value = last.participant_id;
  }
  show('screen-login');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
