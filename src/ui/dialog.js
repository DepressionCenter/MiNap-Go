// This file is part of MiNap Go
// dialog.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: Focus trap and focus restore behind screens.js's openModal/closeModal/showOverlay,
//   so every dialog in the app -- the edit-time modal, the change-PIN modal, and the sleeping
//   overlay -- gets keyboard containment and a return of focus to whatever opened it, written
//   once rather than per dialog.
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

var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// One dialog at a time is all this app ever opens, so a single module-level record of what is
// trapped and what to return focus to is enough -- no stack needed.
var focusTrapState = null;

function visibleFocusable(container) {
  return Array.prototype.slice.call(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(function (el) { return el.offsetParent !== null; });
}

function trapKeydown(e) {
  if (e.key !== 'Tab' || !focusTrapState) return;
  var focusable = visibleFocusable(focusTrapState.container);
  if (!focusable.length) return;
  var first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// Marks container as the active dialog: sets aria-modal, remembers what had focus so it can be
// restored, moves focus inside, and starts trapping Tab/Shift+Tab within it. Safe to call again
// on the same container while it is already trapped -- the edit and change-PIN modals are
// re-opened rather than re-rendered while visible, so this mainly guards against a stray
// double call.
function trapFocus(container) {
  if (focusTrapState && focusTrapState.container === container) return;
  releaseFocus();
  container.setAttribute('aria-modal', 'true');
  container.addEventListener('keydown', trapKeydown);
  focusTrapState = { trigger: document.activeElement, container: container };
  var target = visibleFocusable(container)[0] || container;
  target.focus();
}

// Removes the trap and returns focus to whatever opened the dialog, if it is still in the page --
// a participant who closed a dialog that replaced its own trigger (rare in this app, but cheap
// to guard) simply keeps whatever focus the close action already set.
function releaseFocus() {
  if (!focusTrapState) return;
  focusTrapState.container.removeEventListener('keydown', trapKeydown);
  focusTrapState.container.removeAttribute('aria-modal');
  var trigger = focusTrapState.trigger;
  focusTrapState = null;
  if (trigger && document.body.contains(trigger) && typeof trigger.focus === 'function') {
    trigger.focus();
  }
}
