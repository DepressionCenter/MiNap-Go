// This file is part of MiNap Go
// boot.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-18
// Last Modified: 2026-08-19
// Summary: Startup: loads server config, wires every screen's DOM event listeners (including
//   the survey screen and the offline queue's 'online' trigger), and either resumes the last
//   identity used on this device with no prompt, or shows the login screen pre-filled with it.
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
    var editBtn = e.target.closest('.edit-time');
    if (editBtn) { openEditor(editBtn.getAttribute('data-id')); return; }
    var completeBtn = e.target.closest('.complete-survey');
    if (completeBtn) beginCompletion(completeBtn.getAttribute('data-sleep-day'));
  });
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditor);
  document.getElementById('btn-edit-save').addEventListener('click', saveEditor);

  document.getElementById('survey-questions').addEventListener('input', onSurveyInput);
  document.getElementById('survey-questions').addEventListener('change', onSurveyChange);
  document.getElementById('survey-questions').addEventListener('click', onSurveyStep);
  document.getElementById('btn-survey-submit').addEventListener('click', doSurveySubmit);
  document.getElementById('btn-survey-skip').addEventListener('click', doSurveySkip);
  document.getElementById('btn-survey-cancel').addEventListener('click', doSurveyCancel);

  // Retries whatever is still queued the moment connectivity returns, rather than waiting for
  // the participant to reopen the app or visit History. A no-op with no active session (nothing
  // queued can exist before someone has signed in on this device).
  window.addEventListener('online', function () {
    if (getSessionIdentity()) flushQueue();
  });

  var last = await getLastIdentity();
  if (last) {
    document.getElementById('in-study').value = last.study_id;
    document.getElementById('in-part').value = last.participant_id;
    // No PIN prompt, no network call: reads the device key this identity left behind (if any)
    // and unwraps straight into a working session. Falls through to the login screen, still
    // pre-filled, whenever there is nothing to resume.
    var resumed = await tryAutoResume(last.study_id, last.participant_id);
    if (resumed) { enterHome(); return; }
  }
  show('screen-login');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
