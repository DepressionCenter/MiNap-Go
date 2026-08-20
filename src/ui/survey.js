// This file is part of MiNap Go
// survey.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: The morning diary. Renders whatever questions getConfig currently reports as
//   visible, dispatching on input_style (slider, buttons, stepper) and falling back to
//   answer_type for time, datetime, and boolean, per architecture.md section 3.4.3. Builds the
//   answers array logSurvey expects, and drives both entry points into a night's survey: right
//   after waking, and completing a skipped or missing one later from history.
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

// Question IDs Q01-Q08 are the shipped Consensus Sleep Diary Core items (architecture.md
// section 3.4.1); anything else visible was added by the researcher on QuestionsSetup. The
// standalone build's own participant-authored questions (question_source 'participant') are
// Phase 5 scope and do not exist yet.
var DEFAULT_QUESTION_IDS = ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08'];
function questionSourceFor(questionId) {
  return DEFAULT_QUESTION_IDS.indexOf(questionId) !== -1 ? 'default' : 'researcher';
}

var surveyDraft = null;   // the in-progress survey; see initSurveyDraft
var surveyQuestions = []; // the visible question list this draft is being answered against
var surveyAnswerCounter = 1;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Reads the question list to render this survey against: the cached copy of getConfig's last
// successful fetch first, so an offline participant still sees their study's own questions, then
// a fresh network fetch to keep it current, then the hardcoded default as a last resort.
async function loadSurveyQuestions() {
  var cached = await getCachedConfig();
  if (cached && Array.isArray(cached.questions) && cached.questions.length) {
    surveyQuestions = cached.questions;
  } else {
    surveyQuestions = DEFAULT_QUESTIONS || [];
  }
  getConfig(function (cfg) {
    if (cfg) {
      if (Array.isArray(cfg.questions)) surveyQuestions = cfg.questions;
      setCachedConfig(cfg);
    }
  }, function () {}); // offline: keep whatever loaded above
  return surveyQuestions;
}

// One unanswered SurveyAnswers row per visible question, per architecture.md section 3.6: every
// question shown gets a row, whether or not it is ever answered.
function buildAnswerSkeleton(question, displayOrder) {
  return {
    record_id: uuid(),
    question_id: question.question_id,
    question_source: questionSourceFor(question.question_id),
    answer_type: question.answer_type,
    question_text_shown: question.display_text,
    required: !!question.required,
    display_order: displayOrder,
    answer_order: '',
    value: '',
    value_number: '',
    value_unit: '',
    answered_utc: '',
    edited_utc: '',
    edit_count: 0,
    time_to_answer_ms: ''
  };
}

function findAnswer(questionId) {
  return surveyDraft.answers.filter(function (a) { return a.question_id === questionId; })[0];
}
function findQuestion(questionId) {
  return surveyQuestions.filter(function (q) { return q.question_id === questionId; })[0];
}

// Marks an answer's first value. Only called once per answer; later changes go through
// markEdited instead, so answered_utc always names the moment the participant first responded,
// per data-dictionary.md's "empty means shown but not answered."
function markAnswered(answer) {
  answer.answer_order = surveyAnswerCounter++;
  answer.answered_utc = new Date().toISOString();
  answer.time_to_answer_ms = Date.parse(answer.answered_utc) - Date.parse(surveyDraft.survey_opened_utc);
}
function markEdited(answer) {
  answer.edited_utc = new Date().toISOString();
  answer.edit_count = (answer.edit_count || 0) + 1;
}

// ----- building a fresh draft -----

// identity: {study_id, participant_id, tz} (event.js's shape, not the vault session's). A
// resumed survey_id (history.js's completion entry point) always starts from a fresh, empty
// draft: history.js only offers resuming a record that is not locked, and an unlocked
// skipped/abandoned record has zero answers by definition (isSurveyLocked), so there is nothing
// to restore -- only the identifier (survey_id) is reused, so the eventual write updates the
// existing Surveys row instead of adding a second one.
function initSurveyDraft(surveyId, sleepDay, identity, sleepEvent, wakeEvent) {
  surveyAnswerCounter = 1;
  surveyDraft = {
    survey_id: surveyId,
    study_id: identity.study_id,
    participant_id: identity.participant_id,
    sleep_day: sleepDay,
    sleep_record_id: sleepEvent ? sleepEvent.record_id : '',
    wake_record_id: wakeEvent ? wakeEvent.record_id : '',
    wake_marker_utc: wakeEvent ? wakeEvent.event_utc : '',
    survey_opened_utc: new Date().toISOString(),
    survey_ended_utc: '',
    end_reason: '',
    event_tz: identity.tz,
    tz_offset_minutes: Math.round(tzOffsetMs(new Date(), identity.tz) / 60000),
    answers: surveyQuestions.map(function (q, i) { return buildAnswerSkeleton(q, i + 1); })
  };
  applyPrefill(sleepEvent, wakeEvent);
}

// Q02/Q06-style questions (prefill_from SLEEP_MARKER/WAKE_MARKER) open already filled in from
// the marker's own local time. The participant may change the answer; the marker itself never
// changes, per architecture.md section 3.4.2.
function applyPrefill(sleepEvent, wakeEvent) {
  surveyDraft.answers.forEach(function (answer) {
    var question = findQuestion(answer.question_id);
    if (!question || !question.prefill_from) return;
    var source = question.prefill_from === 'SLEEP_MARKER' ? sleepEvent
      : question.prefill_from === 'WAKE_MARKER' ? wakeEvent : null;
    if (!source) return;
    answer.value = source.event_local;
    answer.value_number = minutesFromMidnight(source.event_local);
    answer.value_unit = 'hh:mm';
    markAnswered(answer);
  });
}

function minutesFromMidnight(localIso) {
  var m = /T(\d{2}):(\d{2})/.exec(String(localIso || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : '';
}

// ----- rendering -----

// `|| defaultValue` would silently turn a legitimate min_value of 0 into 1 (0 is falsy), so a
// missing value is checked for explicitly rather than relied on to fall through.
function numberOr(value, fallback) {
  return value === '' || value == null ? fallback : Number(value);
}

function optionsForButtons(question) {
  if (question.answer_type === 'boolean') {
    return [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }];
  }
  var opts = [];
  var min = numberOr(question.min_value, 1), max = numberOr(question.max_value, 5);
  for (var v = min; v <= max; v++) {
    opts.push({ value: String(v), label: String(v) });
  }
  return opts;
}

function renderControl(question, answer) {
  var id = 'ctrl-' + question.question_id;
  var label = escapeHtml(question.display_text);

  if (question.input_style === 'slider') {
    var min = Number(question.min_value) || 0, max = Number(question.max_value) || 10;
    var current = answer.answered_utc ? Number(answer.value) : min;
    return '' +
      '<div class="slider-control">' +
        '<input type="range" id="' + id + '" class="' + (answer.answered_utc ? '' : 'untouched') + '" ' +
          'min="' + min + '" max="' + max + '" value="' + current + '" data-qid="' + question.question_id + '" ' +
          'aria-label="' + label + '">' +
        '<div class="slider-row">' +
          '<button type="button" class="step-minus" data-qid="' + question.question_id + '" aria-label="Decrease">&minus;</button>' +
          '<div class="slider-readout"><span>' + escapeHtml(question.min_label || '') + '</span>' +
            '<span class="slider-value" id="val-' + question.question_id + '">' + (answer.answered_utc ? current : '') + '</span>' +
            '<span>' + escapeHtml(question.max_label || '') + '</span></div>' +
          '<button type="button" class="step-plus" data-qid="' + question.question_id + '" aria-label="Increase">+</button>' +
        '</div>' +
      '</div>';
  }

  if (question.input_style === 'stepper') {
    var smin = Number(question.min_value) || 0, smax = Number(question.max_value) || 999;
    var sval = answer.answered_utc ? answer.value : '';
    var atMax = answer.answered_utc && Number(answer.value) === smax;
    return '' +
      '<div class="stepper-control">' +
        '<button type="button" class="step-minus" data-qid="' + question.question_id + '" aria-label="Decrease">&minus;</button>' +
        '<input type="number" inputmode="numeric" id="' + id + '" min="' + smin + '" max="' + smax + '" ' +
          'value="' + sval + '" data-qid="' + question.question_id + '" aria-label="' + label + '">' +
        '<button type="button" class="step-plus" data-qid="' + question.question_id + '" aria-label="Increase">+</button>' +
        '<span class="stepper-unit" id="note-' + question.question_id + '">' +
          (atMax ? (smax + ' or more') : escapeHtml(question.unit || '')) + '</span>' +
      '</div>';
  }

  if (question.input_style === 'buttons') {
    var options = optionsForButtons(question);
    return '' +
      '<fieldset class="buttons-control" data-qid="' + question.question_id + '">' +
        '<legend class="visually-hidden">' + label + '</legend>' +
        (question.min_label ? '<span class="button-end-label">' + escapeHtml(question.min_label) + '</span>' : '') +
        '<div class="button-row">' + options.map(function (opt) {
          var checked = answer.answered_utc && String(answer.value) === opt.value ? ' checked' : '';
          return '<label class="button-option"><input type="radio" name="' + id + '" value="' + opt.value + '"' +
            checked + ' data-qid="' + question.question_id + '"><span>' + escapeHtml(opt.label) + '</span></label>';
        }).join('') + '</div>' +
        (question.max_label ? '<span class="button-end-label">' + escapeHtml(question.max_label) + '</span>' : '') +
      '</fieldset>';
  }

  if (question.answer_type === 'datetime') {
    var dParts = answer.answered_utc ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(answer.value) : null;
    return '' +
      '<div class="datetime-control">' +
        '<input type="date" id="' + id + '-date" data-qid="' + question.question_id + '" data-part="date" ' +
          'value="' + (dParts ? dParts[1] : '') + '" aria-label="' + label + ' date">' +
        '<input type="time" id="' + id + '-time" data-qid="' + question.question_id + '" data-part="time" ' +
          'value="' + (dParts ? dParts[2] : '') + '" aria-label="' + label + ' time">' +
      '</div>';
  }

  // 'time' -- the common case. The participant picks a clock time only; the calendar date
  // follows from sleep_day, per architecture.md section 4.1.
  var tParts = answer.answered_utc ? /T(\d{2}:\d{2})/.exec(answer.value) : null;
  return '<input type="time" id="' + id + '" data-qid="' + question.question_id + '" ' +
    'value="' + (tParts ? tParts[1] : '') + '" aria-label="' + label + '">';
}

function renderSurveyQuestions() {
  var box = document.getElementById('survey-questions');
  box.innerHTML = surveyQuestions.map(function (question) {
    var answer = findAnswer(question.question_id);
    return '' +
      '<div class="question">' +
        '<p class="q-text">' + escapeHtml(question.display_text) +
          (question.required ? ' <span class="required-badge">Required</span>' : '') + '</p>' +
        renderControl(question, answer) +
      '</div>';
  }).join('');
  updateSurveyButtons();
}

function unansweredRequired() {
  return surveyDraft.answers.filter(function (a) { return a.required && !a.answered_utc; });
}
function answeredCount() {
  return surveyDraft.answers.filter(function (a) { return a.answered_utc; }).length;
}

// Skip is only offered while nothing has been answered yet; once anything has, walking away
// would misrepresent engagement, so Cancel (which sends what exists as abandoned) takes its
// place. Submit appears once every visible required question has an answer.
function updateSurveyButtons() {
  var count = answeredCount();
  document.getElementById('btn-survey-skip').classList.toggle('hidden', count > 0);
  document.getElementById('btn-survey-cancel').classList.toggle('hidden', count === 0);
  document.getElementById('btn-survey-submit').disabled = unansweredRequired().length > 0;
  document.getElementById('survey-required-error').textContent = '';
}

// ----- control interaction -----

// Slider dragging and typing into a stepper's number field both fire many 'input' events in a
// row. Rebuilding the whole question list on each one -- survey.js's usual pattern for any
// other change -- would destroy and recreate the very control the participant has a finger or a
// cursor in, losing the drag or the keystroke. Both update the answer and the small pieces of
// their own markup directly instead; every other control (a single discrete tap or a native
// picker committing a finished value) still goes through the full rebuild, which is simpler and
// carries no such cost.
function onSurveyInput(e) {
  var target = e.target;
  var qid = target.getAttribute('data-qid');
  if (!qid) return;
  var answer = findAnswer(qid);
  var question = findQuestion(qid);
  if (!answer || !question) return;
  var wasAnswered = !!answer.answered_utc;

  if (question.input_style === 'slider') {
    if (target.value === '') return;
    setAnswerFromClockOrNumber(question, answer, target.value);
    if (!wasAnswered) markAnswered(answer); else markEdited(answer);
    target.classList.remove('untouched');
    var readout = document.getElementById('val-' + qid);
    if (readout) readout.textContent = answer.value;
    updateSurveyButtons();
    return;
  }

  if (question.input_style === 'stepper') {
    if (target.value === '') return;
    setAnswerFromClockOrNumber(question, answer, target.value);
    if (!wasAnswered) markAnswered(answer); else markEdited(answer);
    updateStepperNote(question, answer);
    updateSurveyButtons();
    return;
  }

  var set;
  if (question.answer_type === 'time') {
    if (target.value === '') return;
    set = setAnswerFromClockOrNumber(question, answer, target.value);
  } else if (question.answer_type === 'datetime') {
    // Only one of the date/time pair may have a value yet; wait for both before recording an
    // answer, so half a datetime is never marked as though the participant had finished it.
    set = setAnswerFromDatetimeParts(question, answer);
  } else {
    return; // radios are handled on 'change' below
  }
  if (!set) return;
  if (!wasAnswered) markAnswered(answer); else markEdited(answer);
  // A native time/date picker's own display already shows what was just chosen; only the
  // Submit/Skip/Cancel state can change here, not anything the question list itself renders.
  updateSurveyButtons();
}

function updateStepperNote(question, answer) {
  var note = document.getElementById('note-' + question.question_id);
  if (!note) return;
  var max = Number(question.max_value) || 999;
  note.textContent = Number(answer.value) === max ? (max + ' or more') : (question.unit || '');
}

function onSurveyChange(e) {
  var target = e.target;
  if (target.type !== 'radio') return;
  var qid = target.getAttribute('data-qid');
  var answer = findAnswer(qid);
  var question = findQuestion(qid);
  if (!answer || !question || !target.checked) return;
  var wasAnswered = !!answer.answered_utc;

  if (question.answer_type === 'boolean') {
    answer.value = target.value;
    answer.value_number = target.value === 'Yes' ? 1 : 0;
    answer.value_unit = '';
  } else {
    answer.value = target.value;
    answer.value_number = Number(target.value);
    answer.value_unit = 'points';
  }
  if (!wasAnswered) markAnswered(answer); else markEdited(answer);
  renderSurveyQuestions();
}

// @return {boolean} True if the answer was actually set.
function setAnswerFromClockOrNumber(question, answer, rawValue) {
  if (question.answer_type === 'time') {
    var iso = localIsoForTimeAnswer(surveyDraft.sleep_day, rawValue, surveyDraft.event_tz);
    answer.value = iso;
    answer.value_number = minutesFromMidnight(iso);
    answer.value_unit = 'hh:mm';
    return true;
  }
  // stepper (duration_minutes, count) or a slider (scale, ordinal, count, duration_minutes)
  var num = Number(rawValue);
  answer.value = num;
  answer.value_number = num;
  answer.value_unit = question.answer_type === 'duration_minutes' ? 'minutes'
    : (question.answer_type === 'scale' || question.answer_type === 'ordinal') ? 'points'
    : (question.unit || '');
  return true;
}

// @return {boolean} True only once both the date and the time sub-field carry a value.
function setAnswerFromDatetimeParts(question, answer) {
  var dateEl = document.getElementById('ctrl-' + question.question_id + '-date');
  var timeEl = document.getElementById('ctrl-' + question.question_id + '-time');
  if (!dateEl.value || !timeEl.value) return false;
  var iso = localIsoForDatetimeAnswer(dateEl.value, timeEl.value, surveyDraft.event_tz);
  answer.value = iso;
  answer.value_number = minutesFromMidnight(iso);
  answer.value_unit = 'hh:mm';
  return true;
}

function onSurveyStep(e) {
  var btn = e.target.closest('.step-minus, .step-plus');
  if (!btn) return;
  var qid = btn.getAttribute('data-qid');
  var question = findQuestion(qid);
  var answer = findAnswer(qid);
  if (!question || !answer) return;
  var min = Number(question.min_value) || 0, max = Number(question.max_value) || 999;
  var current = answer.answered_utc ? Number(answer.value) : min;
  var next = btn.classList.contains('step-minus') ? current - 1 : current + 1;
  next = Math.max(min, Math.min(max, next));
  var wasAnswered = !!answer.answered_utc;
  answer.value = next;
  answer.value_number = next;
  answer.value_unit = question.answer_type === 'duration_minutes' ? 'minutes'
    : question.answer_type === 'scale' || question.answer_type === 'ordinal' ? 'points'
    : (question.unit || '');
  if (!wasAnswered) markAnswered(answer); else markEdited(answer);
  renderSurveyQuestions();
}

// ----- opening the screen -----

async function openSurveyScreen(title) {
  document.getElementById('survey-title').textContent = title;
  renderSurveyQuestions();
  show('screen-survey');
}

// Entry point 1: right after waking, for tonight's own survey.
async function openSurveyForNight(sleepEvent, wakeEvent) {
  var identity = getSessionIdentity();
  if (!identity) return;
  var sleepDay = sleepEvent ? sleepDayFromLocal(sleepEvent.event_local)
    : findPrecedingSleepDayLocal(await getHistory(), wakeEvent.event_epoch_ms, wakeEvent.event_local);
  await loadSurveyQuestions();
  initSurveyDraft(uuid(), sleepDay, sessionForBuildEvent(identity), sleepEvent, wakeEvent);
  await openSurveyScreen('Morning diary');
}

// Entry point 2: completing a skipped or missing survey from history, within edit_window_days of
// the night itself (architecture.md section 10). night is {sleepDay, sleepEvent, wakeEvent,
// existingRecord}, where existingRecord is the local surveys-collection entry if one already
// exists (reused rather than starting a new survey_id) or null (a night with a marker and no
// locally known survey at all).
async function openSurveyForCompletion(night) {
  var identity = getSessionIdentity();
  if (!identity) return;
  await loadSurveyQuestions();
  var surveyId = night.existingRecord ? night.existingRecord.survey_id : uuid();
  initSurveyDraft(surveyId, night.sleepDay, sessionForBuildEvent(identity), night.sleepEvent, night.wakeEvent);
  await openSurveyScreen('Complete diary for ' + night.sleepDay);
}

function closeSurveyScreen() {
  surveyDraft = null;
  show('screen-home');
  applyHomeState();
}

// ----- finishing: submit, skip, cancel -----

async function persistAndSend(endReason) {
  surveyDraft.survey_ended_utc = new Date().toISOString();
  surveyDraft.end_reason = endReason;
  var record = Object.assign({}, surveyDraft);
  await updateSurveys(function (list) {
    var i = list.findIndex(function (s) { return s.survey_id === record.survey_id; });
    if (i === -1) list.push(record); else list[i] = record;
    return list;
  });
  await enqueue('survey', record);
  flushQueue();
}

async function doSurveySubmit() {
  var missing = unansweredRequired();
  if (missing.length) {
    document.getElementById('survey-required-error').textContent =
      'Please answer every required question before submitting.';
    return;
  }
  await persistAndSend('submitted');
  toast('Diary submitted');
  closeSurveyScreen();
}

// Only reachable with zero answers so far (updateSurveyButtons hides the button otherwise).
async function doSurveySkip() {
  await persistAndSend('skipped');
  toast('Diary skipped');
  closeSurveyScreen();
}

// Only reachable with at least one answer already given; sends what exists immediately rather
// than waiting for a later sweep to infer abandonment.
async function doSurveyCancel() {
  await persistAndSend('abandoned');
  toast('Diary saved as abandoned');
  closeSurveyScreen();
}

// ----- wire payload for the offline queue (state.js calls this by name) -----

function toLogSurveyPayload(draft) {
  return {
    study_id: draft.study_id,
    participant_id: draft.participant_id,
    device_token: getSessionToken(),
    survey_id: draft.survey_id,
    target_sleep_day: draft.sleep_day,
    sleep_record_id: draft.sleep_record_id || '',
    wake_record_id: draft.wake_record_id || '',
    wake_marker_utc: draft.wake_marker_utc || '',
    survey_opened_utc: draft.survey_opened_utc,
    survey_ended_utc: draft.survey_ended_utc || '',
    end_reason: draft.end_reason,
    event_tz: draft.event_tz || '',
    tz_offset_minutes: draft.tz_offset_minutes || 0,
    source: 'web',
    app_version: APP_VERSION,
    answers: draft.answers.map(function (a) {
      return {
        record_id: a.record_id, question_id: a.question_id, question_source: a.question_source,
        answer_type: a.answer_type, question_text_shown: a.question_text_shown,
        required: a.required, display_order: a.display_order, answer_order: a.answer_order,
        value: a.value, value_number: a.value_number, value_unit: a.value_unit,
        answered_utc: a.answered_utc, edited_utc: a.edited_utc, edit_count: a.edit_count,
        time_to_answer_ms: a.time_to_answer_ms
      };
    })
  };
}

// Whether a locally-known survey record is locked -- submitted outright, or ended with at least
// one answer given -- mirroring logSurvey's own guard so history.js never offers a completion
// entry point the server would refuse anyway.
function isSurveyLocked(record) {
  if (!record) return false;
  if (record.end_reason === 'submitted') return true;
  return (record.end_reason === 'skipped' || record.end_reason === 'abandoned')
    && record.answers.some(function (a) { return a.answered_utc; });
}
