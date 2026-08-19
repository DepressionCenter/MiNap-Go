// This file is part of MiNap Go
// Code.gs
// Author(s): Gabriel Mongefranco
// Created: 2026-07-09
// Last Modified: 2026-08-18
// Summary: Server-side Apps Script; declares the workbook layout, creates whatever part of it is
//   missing including the Dashboard charts, serves the web app, checks participant logins and
//   PINs, and records sleep and wake markers and survey answers.
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

/*
 * ### Workbook Declaration ###
 *
 * The whole layout of the researcher's spreadsheet, as data rather than as steps inside a
 * function. Provisioning walks this structure and creates whatever is missing; nothing else
 * in the code knows a column position, so adding a column is a single edit here.
 *
 * Every tab is a plain table: one header row, and rows of values under it. Nothing is
 * arranged as a form, and no tab mixes two shapes, so any tab can be read, sorted, filtered,
 * or exported without knowing anything special about it.
 *
 * The shape of every entry:
 *
 *   schemaVersion  Stamped into StudySettings when the workbook is created, and checked on
 *                  every later open. A workbook built by an older version is refused, not
 *                  upgraded: a deployed copy of the app never updates itself, so there is no
 *                  migration path, and pretending otherwise would corrupt data.
 *   tabs[]         One entry per worksheet, in the order they should appear.
 *     name         Worksheet name, exactly as it appears on the tab.
 *     purpose      One sentence for a maintainer reading this file cold.
 *     hidden       True for helper tabs the researcher never opens.
 *     frozenRows   Rows locked at the top of the worksheet.
 *     appendOnly   True where the app adds rows over time, so the tab starts empty.
 *     providedByTemplate  True for a tab the template workbook already ships. The app never
 *                  creates it and never writes prose into it; whatever it writes there is
 *                  named separately in the entry.
 *     columns[]    Left to right, starting at column A.
 *       header     The literal text of the header cell. This is the stored column name, and
 *                  it must never change once a study exists.
 *       width      Column width in pixels.
 *       note       Cell note attached to the header, written for the researcher.
 *     defaultRows[]  Rows written underneath the header when the tab is first created, each
 *                  an array of values in the same order as `columns`. Written on creation
 *                  only; provisioning never rewrites them, because a researcher may have
 *                  changed them on purpose.
 *     blocks[]     Only on `_calc`: the fixed working tables the charts read. See there.
 *
 * QuestionsSetup is deliberately over-provisioned: it always holds twenty rows, even though
 * version 1 ships eight questions. Survey answers are stored as rows on SurveyAnswers rather
 * than as columns, so a new question changes no tab's shape and costs nothing. What twenty
 * limits is charting, because the questions table on `_calc` reserves one row per slot and a
 * chart range has to be a constant.
 */

/** Layout version stamped into StudySettings. Raise it only for a change that makes an
 *  existing workbook unreadable, because raising it locks every workbook built before it. */
const SCHEMA_VERSION = 1;

/** How the workbook spells a yes-or-no value. One spelling everywhere, so a researcher never
 *  has to remember which tab wanted TRUE and which wanted YES.
 *
 *  Written strictly, read loosely. Everything this code writes uses exactly these two
 *  strings, but anything reading a yes-or-no cell also accepts what a person or a spreadsheet
 *  is likely to put there instead: 0 and 1, the booleans TRUE and FALSE, and any casing of
 *  the words. A researcher typing "yes" into a cell must not silently mean "no". */
const BOOL_YES = 'Yes';
const BOOL_NO = 'No';

/** How many question rows QuestionsSetup always holds, and how many rows the questions table
 *  on the `_calc` tab reserves for charting. The two are the same number by design: one chart
 *  row per possible question, so a spare question can be put to use without any tab changing
 *  shape. */
const QUESTION_SLOT_COUNT = 20;

/** Where the participant filter sits on the Dashboard tab, and what it holds. The filter is
 *  a control, not a setting: it changes what you are looking at right now, and it belongs
 *  beside the charts it drives rather than on a tab a researcher fills in once. The charts
 *  start below it, so there is room to add more controls without moving them. */
const DASHBOARD_FILTER_LABEL_CELL = { row: 1, column: 1 };
const DASHBOARD_FILTER_CELL = { row: 1, column: 2 };
const DASHBOARD_FILTER_LABEL = 'Show data for:';
const DASHBOARD_FILTER_ALL = 'ALL';
const DASHBOARD_FIRST_CHART_ROW = 3;

/** Where the live web app link is written on the README tab, and how it is picked out. The
 *  link is an output rather than a setting, so it does not belong on a tab a researcher fills
 *  in; it goes into the one cell the README reserves for it, and the app touches nothing else
 *  on that tab. Bold on a pale yellow ground because this is the one thing on the page a
 *  researcher comes back to look for. The tint is light enough to leave black text on it far
 *  above the contrast the text needs. */
const README_URL_ROW = 10;
const README_URL_COLUMN = 1;
const README_URL_BACKGROUND = '#fff8e1';

/** Script properties recording what has already been done, so that opening the app does not
 *  repeat work that only needs doing once. Provisioning walks nine tabs and costs dozens of
 *  round trips to the spreadsheet; participants should not pay that on every page load. */
const PROVISIONED_PROPERTY = 'workbook_provisioned_schema_version';
const WEBAPP_URL_PROPERTY = 'webapp_url_recorded';

/** Fixed dimensions of the hidden `_calc` tab. Chart ranges are constants written once
 *  because these never change: fourteen nights of history, seven days of the week, and one
 *  row per question slot. A chart that worked out its own range would break the first time a
 *  study had fewer than fourteen nights of data. */
const CALC_DAY_ROWS = 14;
const CALC_WEEKDAY_ROWS = 7;
const CALC_QUESTION_ROWS = QUESTION_SLOT_COUNT;

/** Answer types a question may use. How each is stored is in the architecture specification,
 *  section 3.4: `time` and `datetime` are ISO 8601 local times with an offset, `boolean` is
 *  written as Yes or No, and every other type is a whole number. There is no free-text type,
 *  and there never will be: open text invites a participant to type names, appointments, or
 *  diagnoses, and every one of those would land in the researcher's workbook. */
const ANSWER_TYPES =
  ['time', 'datetime', 'duration_minutes', 'count', 'ordinal', 'scale', 'boolean'];

/** How a rating question is presented: `slider` for wide rating scales, `buttons` where every
 *  option is worth showing, `stepper` for counts and durations. Empty for a time question,
 *  which uses the time picker built into the device. */
const INPUT_STYLES = ['slider', 'buttons', 'stepper'];

/** Which marker, if any, pre-fills a question's answer. A pre-filled value is a suggestion
 *  the participant may change; the marker itself is never overwritten from the answer. */
const PREFILL_SOURCES = ['SLEEP_MARKER', 'WAKE_MARKER'];

/** How a survey finished. `skipped` means it was shown and declined, which is a real finding
 *  about engagement rather than missing data, and `abandoned` means the app closed part way
 *  through. Without the distinction, both look identical to data loss. */
const END_REASONS = ['submitted', 'skipped', 'abandoned'];

/** Who wrote a question: the shipped default set, the researcher, or, in the standalone build
 *  only, the participant. */
const QUESTION_SOURCES = ['default', 'researcher', 'participant'];

/**
 * Question ID for slot `n`, zero-padded to two digits, as in `Q01`.
 *
 * The numbers match the item numbers of the Consensus Sleep Diary, so `Q03` is item 3 and the
 * workbook can be read without a codebook. They are fixed forever: every stored answer names
 * its question by this ID and by nothing else.
 *
 * @param {number} n Slot number, 1 through QUESTION_SLOT_COUNT.
 * @return {string} The question ID.
 */
function questionId_(n) {
  return 'Q' + (n < 10 ? '0' + n : String(n));
}

/**
 * Builds the default contents of the QuestionsSetup tab.
 *
 * The default set is the Consensus Sleep Diary, Core version (Carney et al., 2012), which is
 * widely treated as the standard daily sleep diary in sleep research. Using a published
 * instrument means results can be compared with other studies instead of being trapped in
 * this tool. Question numbers match the item numbers of the instrument, so `Q03` is item 3
 * and the workbook can be read without a codebook. That numbering is permanent.
 *
 * Items 2 and 6 ask for the same two moments the SLEEP and WAKE buttons already record. Both
 * are kept and both are asked: the button records when it was pressed, the answer records
 * what the participant says happened, and the answer opens pre-filled from the button so the
 * usual case is one tap. Where they disagree, that disagreement is the finding, not an error.
 *
 * The free-text comments item of the published instrument is left out on purpose. Open text
 * invites a participant to type names, appointments, places, or diagnoses, and every one of
 * those would land in the researcher's spreadsheet as identifiable health information.
 * Leaving the field out removes that risk rather than managing it. Participants who want to
 * write things down use the private notes feature, which never leaves their device.
 *
 * Every shipped question is optional. A participant who cannot remember one answer should be
 * able to submit the rest of the night rather than guess, and a researcher who needs a
 * particular item answered marks it required themselves.
 *
 * TODO: The wording below is provisional and must be settled before any study starts, because
 * a deployed copy never updates. Permission to redistribute the Consensus Sleep Diary wording
 * inside a GPL-licensed tool is not yet confirmed with its authors, and it is not yet settled
 * whether the Core version or an expanded version is wanted. The IDs, answer types, ranges,
 * and pre-fill sources are final; only `display_text` is open.
 *
 * @return {Array<Array<string|number>>} One array per question, values in the same order as
 *     the columns of the QuestionsSetup tab.
 */
function buildQuestionDefaultRows_() {
  const rows = [
    ['Q01', 'What time did you get into bed?',
      'time', '', '', '', '', '', '', '', BOOL_NO, BOOL_YES, 1],
    ['Q02', 'What time did you try to go to sleep?',
      'time', '', '', '', '', '', '', 'SLEEP_MARKER', BOOL_NO, BOOL_YES, 2],
    ['Q03', 'How long did it take you to fall asleep?',
      'duration_minutes', 0, 600, 'stepper', '', '', 'minutes', '', BOOL_NO, BOOL_YES, 3],
    // Zero is a real and common answer, and it is what makes a night with no awakenings
    // distinguishable from a night nobody answered for. The top of the range is a clinical
    // judgement rather than a true ceiling: past about ten awakenings, what matters is that
    // the night was badly broken, not the exact count, so the app offers the top value as
    // "10 or more".
    ['Q04', 'How many times did you wake up, not counting your final awakening?',
      'count', 0, 10, 'stepper', '', '', 'times', '', BOOL_NO, BOOL_YES, 4],
    ['Q05', 'In total, how long did these awakenings last?',
      'duration_minutes', 0, 600, 'stepper', '', '', 'minutes', '', BOOL_NO, BOOL_YES, 5],
    ['Q06', 'What time was your final awakening?',
      'time', '', '', '', '', '', '', 'WAKE_MARKER', BOOL_NO, BOOL_YES, 6],
    ['Q07', 'What time did you get out of bed for the day?',
      'time', '', '', '', '', '', '', '', BOOL_NO, BOOL_YES, 7],
    ['Q08', 'How would you rate the quality of your sleep?',
      'ordinal', 1, 5, 'buttons', 'Very poor', 'Very good', '', '', BOOL_NO, BOOL_YES, 8]
  ];

  // The remaining slots ship empty and hidden. They exist so that a researcher can add a
  // question by filling in a row, rather than by adding a column to a workbook already in use.
  for (let n = rows.length + 1; n <= QUESTION_SLOT_COUNT; n++) {
    rows.push([questionId_(n), '', '', '', '', '', '', '', '', '', BOOL_NO, BOOL_NO, n]);
  }
  return rows;
}

const WORKBOOK = {
  schemaVersion: SCHEMA_VERSION,
  tabs: [
    {
      name: 'README',
      purpose: 'How to deploy, and where to go next. The only tab the template workbook ships '
        + 'with. The app writes the live link into one cell and changes nothing else.',
      hidden: false,
      frozenRows: 0,
      appendOnly: false,
      providedByTemplate: true,
      columns: [],
      defaultRows: [],

      /*
       * The one cell the app writes on this tab: the live web app link. Everything else here
       * is prose maintained by hand in the template, which is why the app neither creates this
       * tab nor writes anything else onto it.
       */
      webAppUrlCell: { row: README_URL_ROW, column: README_URL_COLUMN },
      webAppUrlBackground: README_URL_BACKGROUND
    },

    {
      name: 'StudySettings',
      purpose: 'Settings that apply to the whole workbook: one header row, and one row of '
        + 'values under it.',
      hidden: false,
      frozenRows: 1,
      appendOnly: false,
      columns: [
        { header: 'schema_version', width: 120,
          note: 'Which workbook layout this is, set by the app. Do not change it. If it does '
            + 'not match the app, the app stops instead of writing into a layout it does not '
            + 'know.' },
        { header: 'questions_locked', width: 130,
          note: 'Yes once a participant has submitted a survey, set by the app. After that, '
            + 'changing the wording of a question makes two different questions share one '
            + 'ID, and nothing in the data can tell those answers apart later.' },
        { header: 'questions_locked_at', width: 170,
          note: 'When the questions were locked, in UTC. Set by the app.' },
        { header: 'edit_window_days', width: 140,
          note: 'How many days a participant may go back and correct a sleep or wake time. '
            + 'Counted from the time already stored, not from the new one. Default 7.' },
        { header: 'backup_reminder_days', width: 170,
          note: 'How often the app reminds a participant to export a backup, in days. '
            + 'Default 15.' }
      ],
      defaultRows: [
        [SCHEMA_VERSION, BOOL_NO, '', 7, 15]
      ]
    },

    {
      name: 'QuestionsSetup',
      purpose: 'The daily survey: always twenty rows, eight in use and twelve spare.',
      hidden: false,
      frozenRows: 1,
      appendOnly: false,
      columns: [
        { header: 'question_id', width: 100,
          note: 'Fixed forever. Every stored answer names its question by this ID and by '
            + 'nothing else, so changing one would orphan the answers already given.' },
        { header: 'display_text', width: 420,
          note: 'The wording the participant reads. Settle it before your study starts: once '
            + 'anyone has answered, changing the wording puts two different questions under '
            + 'one ID.' },
        { header: 'answer_type', width: 140,
          note: 'One of: ' + ANSWER_TYPES.join(', ') + '.' },
        { header: 'min_value', width: 90,
          note: 'Lowest value allowed, for scale, ordinal, count, and duration_minutes.' },
        { header: 'max_value', width: 90,
          note: 'Highest value allowed, for scale, ordinal, count, and duration_minutes.' },
        { header: 'input_style', width: 110,
          note: 'How the question is shown: ' + INPUT_STYLES.join(', ') + '. Leave it empty '
            + 'for a time question, which uses the time picker built into the device.' },
        { header: 'min_label', width: 140,
          note: 'What the low end means, for example "Not at all".' },
        { header: 'max_label', width: 140,
          note: 'What the high end means, for example "Extremely".' },
        { header: 'unit', width: 90,
          note: 'The unit the answer is stored in, for anyone reading the raw data.' },
        { header: 'prefill_from', width: 130,
          note: 'Fills the answer in from a marker the participant already tapped: '
            + PREFILL_SOURCES.join(' or ') + '. Leave it empty for every other question. The '
            + 'participant can change a pre-filled answer, and the marker stays as it was.' },
        { header: 'required', width: 90,
          note: 'Yes or No. A required question must be answered before the survey can be '
            + 'submitted, and cannot be hidden. Every question ships as No, so that somebody '
            + 'who cannot remember one answer can still submit the rest of the night.' },
        { header: 'visible', width: 90,
          note: 'Yes to ask this question, No to leave it out.' },
        { header: 'sort_order', width: 100,
          note: 'The order questions are asked in, lowest first.' }
      ],
      defaultRows: buildQuestionDefaultRows_()
    },

    {
      name: 'ParticipantsSetup',
      purpose: 'Who may log in: one row per participant per study. The researcher adds the '
        + 'rows; the app fills in the PIN columns.',
      hidden: false,
      frozenRows: 1,
      appendOnly: false,
      columns: [
        { header: 'study_id', width: 110,
          note: 'Your study ID. Give it to participants at enrollment. Several studies can '
            + 'share one workbook, because login checks the study and the participant '
            + 'together, so an ID from one study will not work in another.' },
        { header: 'participant_id', width: 130,
          note: 'A randomly assigned ID. Never a name, a set of initials, a date of birth, or '
            + 'a medical record number.' },
        { header: 'enabled', width: 90,
          note: 'Type Yes to let this person log in, or No to end their access while keeping '
            + 'their data. A row with this cell left empty cannot log in: access is granted '
            + 'only where somebody has said so.' },
        { header: 'pin_hash', width: 260,
          note: 'Written by the app when the participant first sets a PIN. To reset a '
            + 'forgotten or locked PIN, clear this cell, pin_salt, and failed_attempts. The '
            + 'participant is then asked to choose a new PIN at the next login, and the copy '
            + 'of their history on their own device becomes unreadable. The workbook keeps '
            + 'the record, so nothing is lost to the study.' },
        { header: 'pin_salt', width: 200,
          note: 'A random value for this participant alone, written with the PIN. Clear it as '
            + 'part of a PIN reset.' },
        { header: 'pin_set_at', width: 170,
          note: 'When the PIN was set, in UTC. Written by the app.' },
        { header: 'failed_attempts', width: 130,
          note: 'How many wrong PINs in a row. Back to zero after a correct one. Clear it as '
            + 'part of a PIN reset.' },
        { header: 'locked', width: 90,
          note: 'Yes once there have been too many wrong PINs in a row. To unlock, clear '
            + 'pin_hash, pin_salt, and failed_attempts, which starts PIN setup again.' }
      ],
      defaultRows: []
    },

    {
      name: 'SleepDiary',
      purpose: 'Sleep and wake markers, one row per marker, written by the app.',
      hidden: false,
      frozenRows: 1,
      appendOnly: true,
      columns: [
        { header: 'record_id', width: 240,
          note: 'The ID the device gave this marker. The app resends anything it is not sure '
            + 'arrived, and this is what stops a resend becoming a second row.' },
        { header: 'study_id', width: 100,
          note: 'The study this marker belongs to.' },
        { header: 'participant_id', width: 130,
          note: 'Who recorded it.' },
        { header: 'marker', width: 90,
          note: 'SLEEP means "I am trying to go to sleep now". WAKE means "I woke up for the '
            + 'last time". Getting out of bed is a separate, later moment, asked as a survey '
            + 'question instead.' },
        { header: 'event_local', width: 200,
          note: 'What the clock said where the participant was, with the offset from UTC, for '
            + 'example 2026-08-16T23:30-04:00.' },
        { header: 'event_tz', width: 170,
          note: 'Which time zone that clock was in, for example America/Detroit.' },
        { header: 'event_utc', width: 200,
          note: 'The same moment in UTC. This is the one reading that is never ambiguous, so '
            + 'use it when comparing times across a daylight saving change or travel.' },
        { header: 'sleep_day', width: 110,
          note: 'Which night this marker belongs to, filled in by the app. A night that starts '
            + 'after midnight counts as the previous day, so a 01:30 bedtime and the 07:00 '
            + 'wake that follows it share one value. Join to the Surveys tab on this column.' },
        { header: 'edited', width: 80,
          note: 'Yes if the participant corrected the time after first recording it.' },
        { header: 'modified_utc', width: 200,
          note: 'When the participant last changed the time, in UTC. Empty if never changed.' },
        { header: 'received_utc', width: 200,
          note: 'When this row reached the workbook, in UTC. It is later than event_utc when '
            + 'the entry was recorded with no signal and sent once the app was online again, '
            + 'which is how you tell those entries apart in a data-quality check.' },
        { header: 'source', width: 90,
          note: 'How the row arrived, for example web.' },
        { header: 'app_version', width: 110,
          note: 'Which version of the app sent it.' }
      ],
      defaultRows: []
    },

    {
      name: 'Surveys',
      purpose: 'One row per survey shown, whether or not anything was answered, written by the '
        + 'app. The answers themselves are on the SurveyAnswers tab, joined on survey_id.',
      hidden: false,
      frozenRows: 1,
      appendOnly: true,
      columns: [
        { header: 'survey_id', width: 240,
          note: 'The ID the device gave this survey when it opened. Join to the SurveyAnswers '
            + 'tab on this column.' },
        { header: 'study_id', width: 100,
          note: 'The study this survey belongs to.' },
        { header: 'participant_id', width: 130,
          note: 'Who answered.' },
        { header: 'sleep_day', width: 110,
          note: 'Which night this survey describes. Join to the SleepDiary tab on this column. '
            + 'It is not the day the survey was answered: a survey filled in on Tuesday '
            + 'morning describes Monday night.' },
        { header: 'sleep_record_id', width: 240,
          note: 'The SLEEP marker for that night, if there was one.' },
        { header: 'wake_record_id', width: 240,
          note: 'The WAKE marker that opened the survey.' },
        { header: 'wake_marker_utc', width: 200,
          note: 'When WAKE was tapped, in UTC.' },
        { header: 'survey_opened_utc', width: 200,
          note: 'When the first question appeared, in UTC.' },
        { header: 'survey_ended_utc', width: 200,
          note: 'When the participant submitted or skipped, in UTC. Empty if the survey was '
            + 'abandoned part way through.' },
        { header: 'survey_duration_ms', width: 150,
          note: 'Ended minus opened, in milliseconds. Stored so the tab reads without a '
            + 'formula.' },
        { header: 'end_reason', width: 120,
          note: 'How the survey finished: ' + END_REASONS.join(', ') + '. Skipped means it was '
            + 'shown and declined, which is a real finding about engagement; abandoned means '
            + 'the app closed part way through. Without these, both look like missing data.' },
        { header: 'question_count', width: 130,
          note: 'How many questions were shown. This is how many SurveyAnswers rows to expect '
            + 'for this survey.' },
        { header: 'answered_count', width: 130,
          note: 'How many of those questions were answered.' },
        { header: 'skipped_count', width: 120,
          note: 'question_count minus answered_count.' },
        { header: 'edit_count_total', width: 140,
          note: 'How many answers were changed before the survey was submitted.' },
        { header: 'question_set_hash', width: 150,
          note: 'A short fingerprint of the questions as they were worded when this survey was '
            + 'answered. If wording ever does change, this is how you tell the affected rows '
            + 'apart instead of mixing them together.' },
        { header: 'event_tz', width: 170,
          note: 'The time zone the participant was in at the time, for example '
            + 'America/Detroit.' },
        { header: 'tz_offset_minutes', width: 150,
          note: 'The offset from UTC in force when the survey opened. Stored as well as the '
            + 'zone name because daylight saving edges and later revisions to the time zone '
            + 'database both reinterpret history; this pins what the offset actually was.' },
        { header: 'record_id', width: 240,
          note: 'The same value as survey_id, so that a resend updates this row instead of '
            + 'adding a second one.' },
        { header: 'received_utc', width: 200,
          note: 'When this row reached the workbook, in UTC.' },
        { header: 'source', width: 90,
          note: 'How the row arrived, for example web.' },
        { header: 'app_version', width: 110,
          note: 'Which version of the app sent it.' }
      ],
      defaultRows: []
    },

    {
      name: 'SurveyAnswers',
      purpose: 'One row per question shown, per survey, written by the app. Answers are rows '
        + 'rather than one column per question, so that a question can be added without any '
        + 'tab changing shape, and so that a question shown but not answered stays '
        + 'distinguishable from one nobody was asked.',
      hidden: false,
      frozenRows: 1,
      appendOnly: true,
      columns: [
        { header: 'record_id', width: 240,
          note: 'The ID the device gave this answer.' },
        { header: 'survey_id', width: 240,
          note: 'Join to the Surveys tab on this column.' },
        { header: 'study_id', width: 100,
          note: 'Repeated here so that this tab can be filtered on its own.' },
        { header: 'participant_id', width: 130,
          note: 'Repeated here for the same reason.' },
        { header: 'sleep_day', width: 110,
          note: 'Which night the survey this answer belongs to describes, copied from the '
            + 'Surveys tab. Repeated here, rather than looked up through survey_id, so the '
            + '_calc tab can average one question over a date range with AVERAGEIFS alone.' },
        { header: 'question_id', width: 100,
          note: 'Which question this answers. Join to the QuestionsSetup tab on this column.' },
        { header: 'question_source', width: 140,
          note: 'Who wrote the question: ' + QUESTION_SOURCES.join(', ') + '.' },
        { header: 'answer_type', width: 140,
          note: 'The answer type as it was shown, one of: ' + ANSWER_TYPES.join(', ') + '.' },
        { header: 'question_text_shown', width: 420,
          note: 'The wording the participant actually read, copied in at the time. Use this '
            + 'rather than display_text on the QuestionsSetup tab: if a question was reworded '
            + 'part way through a study, this is the only record of what each person read.' },
        { header: 'required', width: 90,
          note: 'Whether the question was required at the moment it was shown.' },
        { header: 'display_order', width: 130,
          note: 'Where the question appeared in the survey.' },
        { header: 'answer_order', width: 130,
          note: 'The order the question was actually answered in. Empty if it was not '
            + 'answered. A survey answered strictly bottom to top looks different from one '
            + 'filled in carefully, and nothing else records that.' },
        { header: 'value', width: 200,
          note: 'The answer as a person reads it: a clock time with its offset, a whole '
            + 'number, or Yes or No.' },
        { header: 'value_number', width: 130,
          note: 'The same answer as a single number, so that every question type can be '
            + 'analysed the same way. A time is minutes from local midnight.' },
        { header: 'value_unit', width: 110,
          note: 'What value_number counts: hh:mm, minutes, points, the unit set for the '
            + 'question, or empty.' },
        { header: 'answered_utc', width: 200,
          note: 'When the answer was first given, in UTC. Empty means the question was shown '
            + 'and not answered, which is not the same as a question nobody was asked: that '
            + 'one has no row at all.' },
        { header: 'edited_utc', width: 200,
          note: 'When the answer was last changed before the survey was submitted, in UTC. '
            + 'Empty if it was never changed.' },
        { header: 'edit_count', width: 110,
          note: 'How many times the answer was changed.' },
        { header: 'time_to_answer_ms', width: 160,
          note: 'From the question appearing to the first answer, in milliseconds. A survey '
            + 'answered in eight seconds looks different from one filled in carefully, and '
            + 'this cannot be worked out after the fact.' },
        { header: 'received_utc', width: 200,
          note: 'When this row reached the workbook, in UTC.' },
        { header: 'source', width: 90,
          note: 'How the row arrived, for example web.' },
        { header: 'app_version', width: 110,
          note: 'Which version of the app sent it.' }
      ],
      defaultRows: []
    },

    {
      name: 'Dashboard',
      purpose: 'Four charts covering the last fourteen nights, drawn from the _calc tab, and '
        + 'the filter that decides whose nights they show. No tables, and no working data.',
      hidden: false,
      frozenRows: 0,
      appendOnly: false,
      columns: [],
      defaultRows: [],

      /*
       * The filter is a control the researcher changes while reading the charts, so it sits
       * on top of them rather than on a setup tab. Charts begin below it, leaving room for
       * further controls without any chart having to move.
       */
      filterLabelCell: DASHBOARD_FILTER_LABEL_CELL,
      filterLabel: DASHBOARD_FILTER_LABEL,
      filterCell: DASHBOARD_FILTER_CELL,
      filterDefault: DASHBOARD_FILTER_ALL,
      filterNote: 'Type ALL to chart everyone, or one Participant ID to chart a single '
        + 'person. The charts update themselves.',
      firstChartRow: DASHBOARD_FIRST_CHART_ROW
    },

    {
      name: '_calc',
      purpose: 'The working tables behind the Dashboard charts. Hidden, because nothing here '
        + 'is meant to be read directly and every value is worked out from the other tabs.',
      hidden: true,
      frozenRows: 0,
      appendOnly: false,
      columns: [],
      defaultRows: [],

      /*
       * One table per chart, each starting on a known row and holding a known number of rows,
       * so a chart points at a range that is written once and never worked out again. Each
       * table also gets a named range, so a formula or a chart reads `calcDaily` rather than
       * a row number, and so the names survive a download to Excel. Moving any number here
       * moves a chart range: treat the whole set as fixed.
       */
      blocks: [
        {
          name: 'criteria',
          namedRange: 'calcCriteria',
          purpose: 'Turns the filter cell on the Dashboard tab into values the tables below '
            + 'use directly, so that no formula has to test whether the filter says ALL.',
          headerRow: 1,
          firstDataRow: 2,
          rowCount: 1,
          columns: [
            { header: 'participant_criterion',
              note: 'The Dashboard filter, or a match-anything wildcard when it says ALL.' },
            { header: 'window_start_sleep_day',
              note: 'The first night the charts cover: thirteen days before the last one.' },
            { header: 'window_end_sleep_day',
              note: 'The last night the charts cover.' }
          ]
        },
        {
          name: 'daily',
          namedRange: 'calcDaily',
          purpose: 'One row per night for the last fourteen nights, oldest first. Feeds the '
            + 'total sleep chart and the data coverage chart.',
          headerRow: 4,
          firstDataRow: 5,
          rowCount: CALC_DAY_ROWS,
          columns: [
            { header: 'sleep_day',
              note: 'The night this row describes.' },
            { header: 'total_sleep_minutes',
              note: 'Time asleep: final awakening minus the time sleep was attempted, less how '
                + 'long it took to fall asleep and how long the awakenings lasted.' },
            { header: 'time_in_bed_minutes',
              note: 'Getting out of bed minus getting into bed.' },
            { header: 'sleep_onset_latency_minutes',
              note: 'How long it took to fall asleep.' },
            { header: 'wake_after_sleep_onset_minutes',
              note: 'How long the awakenings during the night lasted altogether.' },
            { header: 'sleep_efficiency_percent',
              note: 'Time asleep as a percentage of time in bed. This is the measure most '
                + 'sleep studies report.' },
            { header: 'has_sleep_data',
              note: '1 if a sleep or wake marker exists for this night, 0 if not.' },
            { header: 'has_survey_data',
              note: '1 if a survey was submitted for this night, 0 if not.' },
            { header: 'sleep_minutes_from_noon',
              note: 'Internal only, read by the weekday block below. This night\'s Q02 answer '
                + 'as minutes after noon, so a day-of-week average does not average raw clock '
                + 'times across midnight.' },
            { header: 'wake_minutes_from_midnight',
              note: 'Internal only, read by the weekday block below. This night\'s Q06 answer, '
                + 'already anchored on midnight.' },
            { header: 'weekday_number',
              note: 'Internal only, read by the weekday block below. WEEKDAY() of sleep_day, 1 '
                + 'for Sunday through 7 for Saturday.' }
          ]
        },
        {
          name: 'weekday',
          namedRange: 'calcWeekday',
          purpose: 'One row per day of the week, averaged over the same fourteen nights. Clock '
            + 'times are held here as minutes counted from an anchor, because averaging clock '
            + 'times directly puts the average of 23:50 and 00:10 in the middle of the day. '
            + 'Bedtimes count from noon and wake times from midnight, and both are turned back '
            + 'into clock times for the chart labels.',
          headerRow: 20,
          firstDataRow: 21,
          rowCount: CALC_WEEKDAY_ROWS,
          columns: [
            { header: 'day_of_week',
              note: 'Sunday through Saturday.' },
            { header: 'avg_sleep_minutes_from_noon',
              note: 'Average bedtime, as minutes after noon.' },
            { header: 'earliest_sleep_minutes_from_noon',
              note: 'Earliest bedtime, as minutes after noon.' },
            { header: 'latest_sleep_minutes_from_noon',
              note: 'Latest bedtime, as minutes after noon.' },
            { header: 'avg_wake_minutes_from_midnight',
              note: 'Average wake time, as minutes after midnight.' },
            { header: 'earliest_wake_minutes_from_midnight',
              note: 'Earliest wake time, as minutes after midnight.' },
            { header: 'latest_wake_minutes_from_midnight',
              note: 'Latest wake time, as minutes after midnight.' },
            { header: 'avg_sleep_clock',
              note: 'Average bedtime as a clock time, for the chart label.' },
            { header: 'avg_wake_clock',
              note: 'Average wake time as a clock time, for the chart label.' }
          ]
        },
        {
          name: 'questions',
          namedRange: 'calcQuestions',
          purpose: 'One row per question slot, averaged over the same fourteen nights. Built '
            + 'from the SurveyAnswers tab with AVERAGEIFS and COUNTIFS over question_id, so a '
            + 'question nobody was asked simply has no answer rows to average. Feeds the '
            + 'survey answer chart.',
          headerRow: 29,
          firstDataRow: 30,
          rowCount: CALC_QUESTION_ROWS,
          columns: [
            { header: 'question_id',
              note: questionId_(1) + ' through ' + questionId_(QUESTION_SLOT_COUNT)
                + ', in order.' },
            { header: 'display_text',
              note: 'The wording, copied from QuestionsSetup for the chart labels.' },
            { header: 'visible',
              note: 'Yes or No, copied from QuestionsSetup. Hidden questions are not charted.' },
            { header: 'average_value',
              note: 'Average of value_number on the SurveyAnswers tab over the fourteen '
                + 'nights, worked out with AVERAGEIFS over question_id. Empty for a time '
                + 'question, which is not averaged this way: clock time runs on a circle, so '
                + 'an ordinary average of 23:50 and 00:10 lands at midday.' },
            { header: 'response_count',
              note: 'How many surveys answered this question, counted with COUNTIFS over the '
                + 'same column.' }
          ]
        }
      ]
    }
  ]
};

const APP_VERSION = '1.0.0';
const EDIT_WINDOW_DAYS = 7; // How far back in history is the user allowed to edit entries

/*
 * ### Serving the App ###
 */

/**
 * Entry point for the published web app.
 *
 * The workbook is brought up to the declared layout before the page is served, so the app is
 * never handed to a participant over a spreadsheet it cannot write to safely.
 *
 * @param {Object} e The Apps Script event object for this request.
 * @return {HtmlOutput} The app page, or a short explanation if the workbook was not recognised.
 */
function doGet(e) {
  let provisioned;
  try {
    provisioned = ensureWorkbook_();
  } catch (err) {
    // The message names a tab and a column, never participant data. The researcher has to read
    // it to put the workbook right, so it is shown as well as logged.
    console.error('MiNap Go provisioning stopped: ' + (err && err.message));
    return workbookProblemPage_(err);
  }

  recordWebAppUrl_(); // save the shareable link into the Sheet on first open

  // The open that builds the workbook is the researcher's own, moments after deploying. They
  // need the spreadsheet next, to add participants, so that open gets a way there instead of
  // a login screen they have nobody to log in as yet.
  if (provisioned) return setupCompletePage_();

  var output = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('MiNap Go')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');

  // Only relax framing protection when the request opts in. This flag isn't a secret (it's
  // public in source control), so anyone who wants to frame the bare URL can just add it --
  // it stops nobody determined. Its only real effect is that the bare URL is not framable
  // by default; embedding is not otherwise restricted to any particular page.
  var allowEmbed = e && e.parameter && e.parameter.allowEmbed === 'true';
  if (allowEmbed) {
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return output;
}

/**
 * Includes one of this project's HTML files inside another. The trailing underscore keeps it
 * off the public interface: every function without one can be called from any browser, and
 * this one returns file contents.
 *
 * @param {string} filename Name of the HTML file in this Apps Script project.
 * @return {string} The file's contents.
 */
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * The page shown instead of the app when the workbook is not laid out the way this code
 * expects. It says what to do and nothing else: no stack trace, no internal paths, no data.
 *
 * @param {Error} err The problem provisioning reported.
 * @return {HtmlOutput} A short page for whoever opened the link.
 */
function workbookProblemPage_(err) {
  const detail = escapeHtml_(String((err && err.message) || 'The workbook could not be read.'));
  const page =
    '<div lang="en" style="font-family: system-ui, Verdana, sans-serif; font-size: 1rem; '
    + 'line-height: 1.6; max-width: 40em; margin: 2rem auto; padding: 0 1rem;">'
    + '<h1 style="font-size: 1.4rem;">This sleep diary is not ready yet</h1>'
    + '<p>Nothing has been changed, and no entries have been lost. Please tell your study team '
    + 'what this page says.</p>'
    + '<p>' + detail + '</p>'
    + '</div>';
  return HtmlService.createHtmlOutput(page)
    .setTitle('MiNap Go')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * The page shown on the one open that builds the workbook, in place of the login screen.
 *
 * It offers a link rather than sending the browser onwards by itself. An Apps Script page runs
 * inside a sandboxed frame on another origin, so it cannot navigate the window it sits in, and
 * a pop-up opened without a click is what a pop-up blocker exists to stop. A link also fails
 * safely: nothing tells this code who is looking, so if somebody other than the researcher
 * opens the deployment first, they get a link they cannot follow rather than being sent to a
 * permission error on a spreadsheet that is not theirs.
 *
 * @return {HtmlOutput} A short page pointing at the spreadsheet.
 */
function setupCompletePage_() {
  let spreadsheetUrl = '';
  try {
    spreadsheetUrl = getSpreadsheet_().getUrl();
  } catch (e) {
    console.warn('MiNap Go could not read the spreadsheet URL: ' + (e && e.message));
  }

  let webAppUrl = '';
  try {
    webAppUrl = ScriptApp.getService().getUrl();
  } catch (e) {
    console.warn('MiNap Go could not read the published web app URL: ' + (e && e.message));
  }

  // A solid colour rather than the app's gradient button: white on the gradient's light end
  // measures below the 4.5:1 needed for text this size, and this label is normal text.
  const action = spreadsheetUrl
    ? '<p><a href="' + escapeHtml_(spreadsheetUrl) + '" target="_blank" rel="noopener" '
      + 'style="display: inline-block; background: #4c4b8a; color: #fff; font-weight: 700; '
      + 'text-decoration: none; padding: 14px 22px; min-height: 44px; border-radius: 14px;">'
      + 'Open the spreadsheet to add participants</a></p>'
    : '<p>Open your MiNap Go spreadsheet to add your participants.</p>';

  // The address is set out on its own line rather than run into the sentence, because it is
  // meant to be copied. Long addresses wrap inside the box instead of pushing the page wider,
  // which is what would otherwise force a phone to scroll sideways.
  const share = webAppUrl
    ? '<p style="margin-top: 2.5rem;">Share the following address with your participants once '
      + 'that is done. They will see the sleep diary, not this message, which appears only on '
      + 'the open that builds the workbook.</p>'
      + '<p style="font-weight: 700; overflow-wrap: anywhere;">'
      + escapeHtml_(webAppUrl) + '</p>'
    : '<p style="margin-top: 2.5rem;">Share the address of this page with your participants '
      + 'once that is done. They will see the sleep diary, not this message, which appears '
      + 'only on the open that builds the workbook.</p>';

  const page =
    '<div lang="en" style="font-family: system-ui, Verdana, sans-serif; font-size: 1rem; '
    + 'line-height: 1.6; max-width: 40em; margin: 2rem auto; padding: 0 1rem;">'
    + '<h1 style="font-size: 1.4rem;">Your app was deployed successfully</h1>'
    + '<p>The spreadsheet now has every tab MiNap Go needs. The next step is to add your '
    + 'participants, one row each on the ParticipantsSetup tab, with <strong>Yes</strong> in '
    + 'the <strong>enabled</strong> column.</p>'
    + action
    + share
    + '</div>';

  return HtmlService.createHtmlOutput(page)
    .setTitle('MiNap Go')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Writes the live web app URL into the cell the README tab reserves for it, so that the
 * researcher never has to go looking for the link. The URL is only knowable in web app
 * context, which is why this runs when the app is opened rather than when it is deployed.
 *
 * It writes once. The URL that was last written is remembered in a script property, so a page
 * load that has nothing to say costs one property read and no work in the spreadsheet at all.
 * Redeploying produces a new URL, which no longer matches what was remembered, and is written.
 *
 * The README tab belongs to the template and is maintained by hand. If it is absent, as it is
 * in a workbook a developer built from scratch, there is nowhere to put the link and this does
 * nothing. Failing here never blocks the app either: whoever opened the deployment already has
 * the URL, so refusing to serve the page over it would be worse than the problem.
 */
function recordWebAppUrl_() {
  let url;
  try {
    url = ScriptApp.getService().getUrl();
  } catch (e) {
    console.warn('MiNap Go could not read the published web app URL: ' + (e && e.message));
    return;
  }
  if (!url) return; // not running as a published web app

  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(WEBAPP_URL_PROPERTY) === url) return; // already written

  const tab = tabDeclaration_('README');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // busy; a later open will record it
  try {
    const sh = getSpreadsheet_().getSheetByName(tab.name);
    if (!sh) return; // no README tab in this workbook; nothing to write into
    const cell = sh.getRange(tab.webAppUrlCell.row, tab.webAppUrlCell.column);
    if (cell.getValue() !== url) {
      cell.setValue(url).setFontWeight('bold').setBackground(tab.webAppUrlBackground);
    }
    properties.setProperty(WEBAPP_URL_PROPERTY, url);
  } catch (e) {
    // non-fatal; never block the app over URL bookkeeping
  } finally {
    lock.releaseLock();
  }
}

/*
 * ### Provisioning The Workbook ###
 *
 * Creating what is missing, and nothing else. Provisioning never clears a tab, never deletes a
 * row, and never moves a column. A researcher's participant list and their charts cannot be
 * recovered once they are gone, so a shape this code does not recognise is a reason to stop
 * and say so, never a reason to repair by deletion.
 */

/**
 * Brings the workbook up to the declared layout. It creates what is missing and leaves
 * everything else exactly as it was.
 *
 * This runs once per layout version, not once per page load. Walking nine tabs costs dozens of
 * round trips to the spreadsheet, and a participant opening the app should not wait for work
 * that has already been done. A script property remembers which layout version was built; a
 * later release that raises the version does not match it and walks the workbook again.
 *
 * The property is set only after a walk finishes, so a workbook that stopped part way through
 * is retried on the next open rather than left half built.
 *
 * To rebuild a tab somebody deleted, run this function from the Apps Script editor. The
 * trailing underscore keeps it away from browsers, not away from the Run menu.
 *
 * Nothing checks the layout again between one open and the next, so logMarker, logSurvey,
 * updateMarker, setPin, and verifyPin all resolve their columns from each sheet's live header
 * row (sheetHeaderMap_ and columnOf_) rather than from the positions declared here, in case a
 * column is moved or renamed by hand after this function has already run once.
 *
 * @return {boolean} True if this call walked the workbook, which happens on one open per
 *     layout version. False when the work was already done, or when another request holds the
 *     lock and is doing it instead.
 * @throws {Error} If a tab exists in a shape the declaration does not describe, or if the
 *     workbook was built to a different layout version.
 */
function ensureWorkbook_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(PROVISIONED_PROPERTY) === String(SCHEMA_VERSION)) return false;

  const ss = getSpreadsheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    // Another open is already provisioning. Two passes at once is the only real hazard here,
    // so standing aside is the correct answer rather than merely the convenient one.
    console.warn('MiNap Go provisioning skipped: another request holds the lock.');
    return false;
  }
  try {
    assertSchemaVersion_(ss);
    WORKBOOK.tabs.forEach(function (tab, position) {
      // A tab the template ships is the researcher's to lay out. Anything the app puts on one
      // is written by the code that owns that value, not by provisioning.
      if (tab.providedByTemplate) return;
      ensureTab_(ss, tab, position);
    });
    // Charts read _calc's named ranges, and Dashboard is declared before _calc in WORKBOOK.tabs
    // (section 3.1), so they are built here rather than while Dashboard itself is provisioned.
    ensureCharts_(ss, ss.getSheetByName('Dashboard'), DASHBOARD_FIRST_CHART_ROW);
    properties.setProperty(PROVISIONED_PROPERTY, String(SCHEMA_VERSION));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Stops if the workbook was built to a different layout version. A deployed copy of the app
 * never updates itself, so there is no migration path: writing rows of one layout into a
 * workbook built for another would put two layouts in one file, which is exactly the failure
 * the version stamp exists to prevent.
 *
 * A workbook with no StudySettings tab yet, or an empty version cell, is a new one.
 *
 * @param {Spreadsheet} ss The workbook.
 * @throws {Error} If the stored version is neither empty nor the version this code writes.
 */
function assertSchemaVersion_(ss) {
  const tab = tabDeclaration_('StudySettings');
  const sh = ss.getSheetByName(tab.name);
  if (!sh || sh.getLastRow() < 2) return;

  const column = headerPosition_(tab, 'schema_version');
  if (String(sh.getRange(1, column).getValue() || '').trim() !== 'schema_version') {
    return; // the header pass reports a mislaid column, and does it with more detail
  }

  const stored = String(sh.getRange(2, column).getValue() || '').trim();
  if (!stored || Number(stored) === SCHEMA_VERSION) return;

  throw new Error('This workbook uses MiNap Go layout ' + stored + ', and this copy of the app '
    + 'writes layout ' + SCHEMA_VERSION + '. Nothing has been changed. Use the copy of the app '
    + 'that matches your workbook, or start a new study from a fresh copy of the template.');
}

/**
 * Creates one tab if it is missing, and brings whatever is on it up to the declaration.
 *
 * @param {Spreadsheet} ss The workbook.
 * @param {Object} tab One entry from WORKBOOK.tabs.
 * @param {number} position Zero-based position the tab should take, from the declared order.
 * @throws {Error} If the tab exists in a shape the declaration does not describe.
 */
function ensureTab_(ss, tab, position) {
  let sh = ss.getSheetByName(tab.name);
  if (!sh) {
    sh = ss.insertSheet(tab.name, Math.min(position, ss.getNumSheets()));
    // Hidden at creation only. A researcher who unhides _calc to read a formula should not
    // find it hidden again the next time the app is opened.
    if (tab.hidden) sh.hideSheet();
  }
  if (tab.frozenRows && sh.getFrozenRows() !== tab.frozenRows) sh.setFrozenRows(tab.frozenRows);

  if (tab.columns && tab.columns.length) ensureTable_(sh, tab);
  if (tab.blocks) { ensureCalcBlocks_(ss, sh, tab); ensureCalcFormulas_(sh); }
  if (tab.filterCell) ensureDashboardControls_(sh, tab);
}

/**
 * Writes any missing headers on an ordinary tab, and its default rows if the tab is new.
 *
 * @param {Sheet} sh The worksheet.
 * @param {Object} tab One entry from WORKBOOK.tabs.
 * @throws {Error} If the header row holds something the declaration does not describe.
 */
function ensureTable_(sh, tab) {
  const wasEmpty = sh.getLastRow() === 0;
  const matched = ensureHeaderRow_(sh, tab.name, 1, tab.columns);

  for (let i = matched; i < tab.columns.length; i++) {
    if (tab.columns[i].width) sh.setColumnWidth(i + 1, tab.columns[i].width);
  }

  // Default rows are a starting point rather than a setting the app owns. A researcher may
  // have changed or deleted one deliberately, so they are written once and never restored.
  if (wasEmpty && tab.defaultRows && tab.defaultRows.length) {
    sh.getRange(2, 1, tab.defaultRows.length, tab.columns.length).setValues(tab.defaultRows);
  }
}

/**
 * Compares one header row against its declaration and fills in whatever is missing from the
 * right-hand end.
 *
 * Columns are only ever appended. A declared column missing from the middle is reported
 * instead of inserted, because inserting one would move every value beside it one cell across
 * and quietly put each participant's data under the wrong heading.
 *
 * @param {Sheet} sh The worksheet.
 * @param {string} tabName Worksheet name, used in the message if this stops.
 * @param {number} rowIndex Which row holds the headers.
 * @param {Array<Object>} columns Declared columns, left to right.
 * @return {number} How many columns already matched, so the caller can format the new ones.
 * @throws {Error} If any cell holds something other than the header declared for it.
 */
function ensureHeaderRow_(sh, tabName, rowIndex, columns) {
  const width = Math.max(columns.length, sh.getLastColumn());
  const existing = sh.getRange(rowIndex, 1, 1, width).getValues()[0]
    .map(function (v) { return String(v == null ? '' : v).trim(); });

  // Nothing may sit to the right of the declared columns. A header there means this is not
  // the table this code thinks it is.
  for (let i = columns.length; i < existing.length; i++) {
    if (existing[i] !== '') throw shapeError_(tabName, rowIndex, i + 1, '(empty)', existing[i]);
  }

  let matched = 0;
  while (matched < columns.length && existing[matched] === columns[matched].header) matched++;
  if (matched === columns.length) return matched;

  // Everything from the first unmatched column onwards has to be free. A cell holding some
  // other header means a column was renamed, reordered, or taken out of the middle.
  for (let i = matched; i < columns.length; i++) {
    if (existing[i] !== '') {
      throw shapeError_(tabName, rowIndex, i + 1, columns[i].header, existing[i]);
    }
  }

  const headers = [];
  for (let i = matched; i < columns.length; i++) headers.push(columns[i].header);
  sh.getRange(rowIndex, matched + 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold');
  for (let i = matched; i < columns.length; i++) {
    if (columns[i].note) sh.getRange(rowIndex, i + 1).setNote(columns[i].note);
  }
  return matched;
}

/**
 * Writes the header row of each working table on the `_calc` tab, and names the range each
 * chart reads. The rows a block occupies are fixed in the declaration so that a chart range is
 * a constant; a chart that worked out its own range would break in a study's first week, when
 * there are fewer than fourteen nights to draw.
 *
 * @param {Spreadsheet} ss The workbook, which is what owns a named range.
 * @param {Sheet} sh The `_calc` worksheet.
 * @param {Object} tab The `_calc` entry from WORKBOOK.tabs.
 * @throws {Error} If a block's header row holds something the declaration does not describe.
 */
function ensureCalcBlocks_(ss, sh, tab) {
  const taken = {};
  ss.getNamedRanges().forEach(function (nr) { taken[nr.getName()] = true; });

  tab.blocks.forEach(function (block) {
    ensureHeaderRow_(sh, tab.name + ' (' + block.name + ')', block.headerRow, block.columns);
    if (!taken[block.namedRange]) {
      ss.setNamedRange(block.namedRange,
        sh.getRange(block.headerRow, 1, 1 + block.rowCount, block.columns.length));
    }
  });
}

/**
 * A whole-column absolute reference to a declared column, as Sheets and Excel formulas both
 * write it, for example 'SleepDiary!$G:$G'. Only for writing the `_calc` formulas during
 * provisioning, when WORKBOOK's declared order is exactly what was just written to the sheet.
 *
 * @param {string} tabName Worksheet name.
 * @param {string} header The column's header text.
 * @return {string} A whole-column A1 reference.
 */
function columnRef_(tabName, header) {
  const letter = columnLetter_(headerPosition_(tabDeclaration_(tabName), header));
  return tabName + '!$' + letter + ':$' + letter;
}

/**
 * An AVERAGEIFS formula fragment reading one question's value_number for one exact sleep_day on
 * SurveyAnswers, scoped to the Dashboard's participant filter in $A$2. Builds the sleep_onset
 * and other derived measures in section 4.2 of the architecture specification, which are worked
 * out here and never stored.
 *
 * @param {string} questionId Which question to average, for example 'Q02'.
 * @param {string} sleepDayCellA1 A1 reference to the cell holding this row's sleep_day.
 * @return {string} A formula fragment, without a leading '='.
 */
function avgAnswerFormula_(questionId, sleepDayCellA1) {
  return 'AVERAGEIFS(' + columnRef_('SurveyAnswers', 'value_number') + ','
    + columnRef_('SurveyAnswers', 'question_id') + ',"' + questionId + '",'
    + columnRef_('SurveyAnswers', 'sleep_day') + ',' + sleepDayCellA1 + ','
    + columnRef_('SurveyAnswers', 'participant_id') + ',$A$2)';
}

/**
 * Writes every formula behind the Dashboard charts into the `_calc` tab: the filter turned into
 * window bounds, one row of derived sleep measures per night, the same measures grouped by day
 * of week, and one row of survey-question averages per question slot.
 *
 * Restricted throughout to SUMIFS, AVERAGEIFS, COUNTIFS, MINIFS, MAXIFS, INDEX, MATCH, IFERROR,
 * TEXT, and WEEKDAY, per section 11 of the architecture specification, so the workbook still
 * calculates correctly after a researcher downloads it as .xlsx.
 *
 * A limitation worth stating plainly: when the Dashboard filter is ALL, a night's derived
 * measures average each question across every participant who answered that night before
 * combining them -- for example, total sleep time is built from the average wake time minus the
 * average bedtime across the group, not from each participant's own wake minus their own
 * bedtime, averaged afterwards. AVERAGEIFS can only average a stored column as it stands;
 * correcting this would need one helper row per participant per night, which conflicts with
 * `_calc`'s fixed row count (section 3.7). For a single participant, which is the dashboard's
 * main per-participant use, the two are identical. Verify the ALL view against a real
 * multi-participant study before relying on it.
 *
 * @param {Sheet} sh The `_calc` worksheet.
 */
function ensureCalcFormulas_(sh) {
  sh.getRange(2, 1).setFormula('=IF(TRIM(Dashboard!$B$1)="ALL","*",Dashboard!$B$1)');
  sh.getRange(2, 2).setFormula('=TODAY()-13').setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, 3).setFormula('=TODAY()').setNumberFormat('yyyy-mm-dd');
  const windowStart = '$B$2';
  const windowEnd = '$C$2';

  const dailyFirstRow = 5;
  for (let i = 0; i < CALC_DAY_ROWS; i++) {
    const r = dailyFirstRow + i;
    const dayCell = '$A' + r;
    sh.getRange(r, 1).setFormula('=' + windowStart + '+' + i).setNumberFormat('yyyy-mm-dd');

    const avgQ01 = avgAnswerFormula_('Q01', dayCell);
    const avgQ02 = avgAnswerFormula_('Q02', dayCell);
    const avgQ03 = avgAnswerFormula_('Q03', dayCell);
    const avgQ05 = avgAnswerFormula_('Q05', dayCell);
    const avgQ06 = avgAnswerFormula_('Q06', dayCell);
    const avgQ07 = avgAnswerFormula_('Q07', dayCell);

    sh.getRange(r, 2).setFormula(
      '=IFERROR(MOD(' + avgQ06 + '-' + avgQ02 + ',1440)-' + avgQ03 + '-' + avgQ05 + ',"")');
    sh.getRange(r, 3).setFormula('=IFERROR(MOD(' + avgQ07 + '-' + avgQ01 + ',1440),"")');
    sh.getRange(r, 4).setFormula('=IFERROR(' + avgQ03 + ',"")');
    sh.getRange(r, 5).setFormula('=IFERROR(' + avgQ05 + ',"")');
    sh.getRange(r, 6).setFormula('=IFERROR(B' + r + '/C' + r + '*100,"")');
    sh.getRange(r, 7).setFormula('=IF(COUNTIFS(' + columnRef_('SleepDiary', 'sleep_day') + ','
      + dayCell + ',' + columnRef_('SleepDiary', 'participant_id') + ',$A$2)>0,1,0)');
    sh.getRange(r, 8).setFormula('=IF(COUNTIFS(' + columnRef_('Surveys', 'sleep_day') + ','
      + dayCell + ',' + columnRef_('Surveys', 'participant_id') + ',$A$2,'
      + columnRef_('Surveys', 'end_reason') + ',"submitted")>0,1,0)');
    sh.getRange(r, 9).setFormula('=IFERROR(MOD(' + avgQ02 + '-720,1440),"")');
    sh.getRange(r, 10).setFormula('=IFERROR(' + avgQ06 + ',"")');
    sh.getRange(r, 11).setFormula('=WEEKDAY($A' + r + ')');
  }
  const dailyLastRow = dailyFirstRow + CALC_DAY_ROWS - 1;

  const weekdayNames =
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdayFirstRow = 21;
  const sleepNoonRange = '$I$' + dailyFirstRow + ':$I$' + dailyLastRow;
  const wakeMidnightRange = '$J$' + dailyFirstRow + ':$J$' + dailyLastRow;
  const weekdayNumberRange = '$K$' + dailyFirstRow + ':$K$' + dailyLastRow;
  for (let i = 0; i < CALC_WEEKDAY_ROWS; i++) {
    const r = weekdayFirstRow + i;
    const dayIndex = i + 1; // WEEKDAY() returns 1 for Sunday by default
    sh.getRange(r, 1).setValue(weekdayNames[i]);
    sh.getRange(r, 2).setFormula(
      '=IFERROR(AVERAGEIFS(' + sleepNoonRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 3).setFormula(
      '=IFERROR(MINIFS(' + sleepNoonRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 4).setFormula(
      '=IFERROR(MAXIFS(' + sleepNoonRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 5).setFormula(
      '=IFERROR(AVERAGEIFS(' + wakeMidnightRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 6).setFormula(
      '=IFERROR(MINIFS(' + wakeMidnightRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 7).setFormula(
      '=IFERROR(MAXIFS(' + wakeMidnightRange + ',' + weekdayNumberRange + ',' + dayIndex + '),"")');
    sh.getRange(r, 8).setFormula('=IFERROR(TEXT(MOD(720+B' + r + ',1440)/1440,"h:mm AM/PM"),"")');
    sh.getRange(r, 9).setFormula('=IFERROR(TEXT(MOD(E' + r + ',1440)/1440,"h:mm AM/PM"),"")');
  }

  const questionsFirstRow = 30;
  const idColumn = columnRef_('QuestionsSetup', 'question_id');
  const textColumn = columnRef_('QuestionsSetup', 'display_text');
  const visibleColumn = columnRef_('QuestionsSetup', 'visible');
  const typeColumn = columnRef_('QuestionsSetup', 'answer_type');
  for (let n = 1; n <= QUESTION_SLOT_COUNT; n++) {
    const r = questionsFirstRow + n - 1;
    const qCell = '$A' + r;
    sh.getRange(r, 1).setValue(questionId_(n));
    sh.getRange(r, 2).setFormula(
      '=IFERROR(INDEX(' + textColumn + ',MATCH(' + qCell + ',' + idColumn + ',0)),"")');
    sh.getRange(r, 3).setFormula(
      '=IFERROR(INDEX(' + visibleColumn + ',MATCH(' + qCell + ',' + idColumn + ',0)),"")');

    const answerType = 'INDEX(' + typeColumn + ',MATCH(' + qCell + ',' + idColumn + ',0))';
    const average = 'AVERAGEIFS(' + columnRef_('SurveyAnswers', 'value_number') + ','
      + columnRef_('SurveyAnswers', 'question_id') + ',' + qCell + ','
      + columnRef_('SurveyAnswers', 'sleep_day') + ',">="&' + windowStart + ','
      + columnRef_('SurveyAnswers', 'sleep_day') + ',"<="&' + windowEnd + ','
      + columnRef_('SurveyAnswers', 'participant_id') + ',$A$2)';
    sh.getRange(r, 4).setFormula(
      '=IFERROR(IF(OR(' + answerType + '="time",' + answerType + '="datetime"),"",' + average + '),"")');

    sh.getRange(r, 5).setFormula('=IFERROR(COUNTIFS(' + columnRef_('SurveyAnswers', 'question_id')
      + ',' + qCell + ',' + columnRef_('SurveyAnswers', 'sleep_day') + ',">="&' + windowStart + ','
      + columnRef_('SurveyAnswers', 'sleep_day') + ',"<="&' + windowEnd + ','
      + columnRef_('SurveyAnswers', 'participant_id') + ',$A$2,'
      + columnRef_('SurveyAnswers', 'answered_utc') + ',"<>"),0)');
  }
}

/**
 * Creates the four researcher charts on the Dashboard tab, if they are not there already, from
 * the named ranges ensureCalcBlocks_ set up on `_calc`. Every chart uses a built-in Sheets chart
 * type so it survives a download to Excel, per section 11 of the architecture specification.
 *
 * Runs after every tab has been created, not while Dashboard itself is being provisioned,
 * because the named ranges this reads live on `_calc`, and WORKBOOK declares Dashboard first.
 *
 * @param {Spreadsheet} ss The workbook, which is what owns a named range.
 * @param {?Sheet} dashboardSheet The Dashboard worksheet. Does nothing if null.
 * @param {number} firstChartRow The row charts should start below.
 */
function ensureCharts_(ss, dashboardSheet, firstChartRow) {
  if (!dashboardSheet || dashboardSheet.getCharts().length > 0) return; // built once

  const daily = ss.getRangeByName('calcDaily');
  const weekday = ss.getRangeByName('calcWeekday');
  const questions = ss.getRangeByName('calcQuestions');
  if (!daily || !weekday || !questions) return; // _calc not ready; a later open will retry

  const col = function (namedRange, offset, width) {
    return namedRange.offset(0, offset, namedRange.getNumRows(), width);
  };

  const totalSleepChart = dashboardSheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(col(daily, 0, 1)) // sleep_day
    .addRange(col(daily, 1, 1)) // total_sleep_minutes
    .setOption('title', 'Total sleep per night, last 14 nights')
    .setOption('vAxis.title', 'Minutes asleep')
    .setPosition(firstChartRow, 1, 0, 0)
    .build();

  const weekdayChart = dashboardSheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(col(weekday, 0, 1)) // day_of_week
    .addRange(col(weekday, 1, 1)) // avg_sleep_minutes_from_noon
    .addRange(col(weekday, 4, 1)) // avg_wake_minutes_from_midnight
    .setOption('title', 'Average sleep and wake time by day of week')
    .setOption('vAxis.title', 'Minutes from anchor (sleep: noon, wake: midnight)')
    .setPosition(firstChartRow + 18, 1, 0, 0)
    .build();

  const coverageChart = dashboardSheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(col(daily, 0, 1)) // sleep_day
    .addRange(col(daily, 6, 1)) // has_sleep_data
    .addRange(col(daily, 7, 1)) // has_survey_data
    .setOption('title', 'Nights with sleep and survey data, last 14 nights')
    .setOption('vAxis.viewWindow.min', 0)
    .setOption('vAxis.viewWindow.max', 1)
    .setPosition(firstChartRow + 36, 1, 0, 0)
    .build();

  const questionsChart = dashboardSheet.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(col(questions, 1, 1)) // display_text
    .addRange(col(questions, 3, 1)) // average_value
    .setOption('title', 'Average answer per question, last 14 nights')
    .setOption('hAxis.title', 'Average value_number (see the data dictionary for units)')
    .setPosition(firstChartRow + 54, 1, 0, 0)
    .build();

  [totalSleepChart, weekdayChart, coverageChart, questionsChart]
    .forEach(function (chart) { dashboardSheet.insertChart(chart); });
}

/**
 * Puts the participant filter on the Dashboard tab. Written only into cells that are empty, so
 * that a researcher's own filter value survives every later open.
 *
 * @param {Sheet} sh The Dashboard worksheet.
 * @param {Object} tab The Dashboard entry from WORKBOOK.tabs.
 */
function ensureDashboardControls_(sh, tab) {
  const label = sh.getRange(tab.filterLabelCell.row, tab.filterLabelCell.column);
  if (String(label.getValue() || '') === '') {
    label.setValue(tab.filterLabel).setFontWeight('bold');
  }

  const filter = sh.getRange(tab.filterCell.row, tab.filterCell.column);
  if (String(filter.getValue() || '') === '') {
    filter.setValue(tab.filterDefault).setNote(tab.filterNote);
  }
}

/*
 * ### Participant Login ###
 */

/**
 * Client-callable: check a Study ID and Participant ID before letting the login screen
 * proceed, and say whether this is a first login that still needs a PIN chosen.
 *
 * Returns a plain value rather than throwing, so that "not on the list" and "could not reach
 * the server" stay distinguishable on the client instead of both arriving as a thrown error.
 * pinSet exists so the client can route to the PIN-setup screen or the PIN-entry screen without
 * calling verifyPin first to find out, which would otherwise cost the participant one of their
 * limited wrong-PIN attempts for a question that has nothing to do with guessing a PIN.
 *
 * @param {string} studyId The Study ID typed by the participant.
 * @param {string} participantId The Participant ID typed by the participant.
 * @return {{valid: boolean, pinSet: boolean}} Whether this pair may log in, and whether a PIN
 *     is already on file for it. pinSet is always false when valid is false.
 */
function validateLogin(studyId, participantId) {
  const participant = findParticipantRow_(studyId, participantId);
  const valid = !!participant && participant.enabled;
  return { valid: valid, pinSet: valid && !!participant.pinHash };
}

/**
 * Client-callable: the settings the interface needs, so that no constant is copied into the
 * client and left to drift.
 *
 * @return {{editWindowDays: number, appVersion: string}} The settings.
 */
function getConfig() {
  return { editWindowDays: readEditWindowDays_(), appVersion: APP_VERSION };
}

/**
 * Finds one participant's row on ParticipantsSetup and reads every column a login or a PIN
 * operation needs. Columns are resolved from the sheet's own live header row rather than from
 * WORKBOOK, so a column a researcher renamed or reordered after the workbook was first built is
 * still found correctly instead of being read from the wrong position.
 *
 * The pair is matched together, never the Participant ID on its own: several studies can share
 * one workbook, and an ID leaked from one study must not work in another. Comparison ignores
 * surrounding spaces and letter case, because somebody typing their ID on a phone should not be
 * turned away over a capital letter.
 *
 * @param {string} studyId The Study ID to look for.
 * @param {string} participantId The Participant ID to look for.
 * @return {?{sheet: Sheet, row: number, columns: Object<string, number>, enabled: boolean,
 *     pinHash: string, pinSalt: string, failedAttempts: number, locked: boolean}} Null if the
 *     pair is not on the tab at all, or if nobody is enrolled yet.
 */
function findParticipantRow_(studyId, participantId) {
  if (!studyId || !participantId) return null;

  const tab = tabDeclaration_('ParticipantsSetup');
  const sh = getSpreadsheet_().getSheetByName(tab.name);
  if (!sh) return null;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null; // header row only: nobody is enrolled yet

  const headerMap = sheetHeaderMap_(sh);
  const columns = {
    study_id: columnOf_(headerMap, 'study_id', tab.name),
    participant_id: columnOf_(headerMap, 'participant_id', tab.name),
    enabled: columnOf_(headerMap, 'enabled', tab.name),
    pin_hash: columnOf_(headerMap, 'pin_hash', tab.name),
    pin_salt: columnOf_(headerMap, 'pin_salt', tab.name),
    pin_set_at: columnOf_(headerMap, 'pin_set_at', tab.name),
    failed_attempts: columnOf_(headerMap, 'failed_attempts', tab.name),
    locked: columnOf_(headerMap, 'locked', tab.name)
  };
  const width = Math.max(
    columns.study_id, columns.participant_id, columns.enabled, columns.pin_hash,
    columns.pin_salt, columns.pin_set_at, columns.failed_attempts, columns.locked);
  const rows = sh.getRange(2, 1, lastRow - 1, width).getValues();

  const wantedStudy = normalizeId_(studyId);
  const wantedParticipant = normalizeId_(participantId);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (normalizeId_(row[columns.study_id - 1]) !== wantedStudy) continue;
    if (normalizeId_(row[columns.participant_id - 1]) !== wantedParticipant) continue;
    // Access is granted only where somebody has written Yes. An empty enabled cell denies the
    // login: an unanswered question about access is not permission.
    return {
      sheet: sh,
      row: i + 2,
      columns: columns,
      enabled: isYes_(row[columns.enabled - 1]),
      pinHash: String(row[columns.pin_hash - 1] || ''),
      pinSalt: String(row[columns.pin_salt - 1] || ''),
      failedAttempts: Number(row[columns.failed_attempts - 1]) || 0,
      locked: isYes_(row[columns.locked - 1])
    };
  }
  return null;
}

/*
 * ### PIN Hashing And Verification ###
 *
 * Apps Script offers SHA hashing but no PBKDF2. A single SHA-256 call is far too fast to resist
 * an offline guess against a stolen pin_hash, so the hash is stretched by chaining it: each
 * round feeds the previous round's digest and the salt back into SHA-256. The round count is
 * tuned to keep one check under about a second, fast enough that a participant never notices it
 * at login. Per section 5.3 of the architecture specification, the lockout below, not this
 * stretching, is what actually stops guessing: the PIN is short, the researcher can read the
 * hashes in their own Sheet, and this endpoint is open to anyone who knows both IDs.
 */

/** Rounds of SHA-256 stretching per PIN check. Apps Script's digest primitive costs roughly
 *  100ms per call under real load, so this keeps one verification under about a second. */
const PIN_HASH_ROUNDS = 10;

/** Shortest PIN this app will store. Longer is always accepted. */
const PIN_MIN_LENGTH = 6;

/** Wrong PINs allowed in a row before an account locks. */
const PIN_MAX_FAILED_ATTEMPTS = 8;

/**
 * A random value for one participant's PIN, encoded as hex so it can sit in a plain
 * spreadsheet cell.
 *
 * Built from Utilities.getUuid(), which Apps Script backs with a cryptographically strong
 * random source rather than Math.random(). Two UUIDs give 256 bits of salt.
 *
 * @return {string} 64 hex characters.
 */
function randomPinSalt_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/**
 * Stretches a PIN and salt into the hash stored on ParticipantsSetup.
 *
 * @param {string} pin The PIN as the participant typed it.
 * @param {string} salt This participant's stored salt.
 * @return {string} The stretched hash, as 64 hex characters.
 */
function hashPin_(pin, salt) {
  const saltBytes = Utilities.newBlob(String(salt)).getBytes();
  let digestBytes = Utilities.newBlob(String(pin) + salt).getBytes();
  for (let round = 0; round < PIN_HASH_ROUNDS; round++) {
    digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digestBytes.concat(saltBytes));
  }
  return bytesToHex_(digestBytes);
}

/**
 * Compares two hex strings the same way regardless of where they first differ, so that a wrong
 * guess and a right one cannot be told apart by how long the comparison took.
 *
 * @param {string} a First value.
 * @param {string} b Second value.
 * @return {boolean} True only if both strings match exactly.
 */
function constantTimeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Client-callable: sets a participant's PIN, or changes it.
 *
 * The two cases are one operation. If no PIN is on file yet, newPin becomes it with no check.
 * If one is already set, oldPin must verify against it first, exactly as changing a PIN is
 * described in section 5.2 of the architecture specification: enter the old one, then the new
 * one.
 *
 * @param {string} studyId The participant's Study ID.
 * @param {string} participantId The participant's Participant ID.
 * @param {string} newPin The PIN to store.
 * @param {string=} oldPin Required, and checked, only when a PIN is already on file.
 * @return {{ok: boolean, reason: (string|undefined)}} reason is one of 'invalid_login',
 *     'locked', 'wrong_pin', or 'pin_too_short' when ok is false.
 */
function setPin(studyId, participantId, newPin, oldPin) {
  const participant = findParticipantRow_(studyId, participantId);
  if (!participant || !participant.enabled) return { ok: false, reason: 'invalid_login' };
  if (participant.locked) return { ok: false, reason: 'locked' };

  if (participant.pinHash) {
    const check = checkPin_(participant, oldPin);
    if (!check.ok) return check;
  }

  if (!newPin || String(newPin).length < PIN_MIN_LENGTH) {
    return { ok: false, reason: 'pin_too_short' };
  }

  writePin_(participant, String(newPin));
  return { ok: true };
}

/**
 * Client-callable: checks a PIN against the one on file, for logging back in on a device that
 * has already set one up.
 *
 * @param {string} studyId The participant's Study ID.
 * @param {string} participantId The participant's Participant ID.
 * @param {string} pin The PIN as typed.
 * @return {{ok: boolean, reason: (string|undefined)}} reason is one of 'invalid_login',
 *     'not_set', 'locked', or 'wrong_pin' when ok is false.
 */
function verifyPin(studyId, participantId, pin) {
  const participant = findParticipantRow_(studyId, participantId);
  if (!participant || !participant.enabled) return { ok: false, reason: 'invalid_login' };
  if (!participant.pinHash) return { ok: false, reason: 'not_set' };
  return checkPin_(participant, pin);
}

/**
 * Confirms a write is allowed before anything is stored: the pair must be enabled, a PIN must
 * already be on file, and the PIN sent with the request must check out. This is what stops
 * someone submitting entries under a Participant ID that is not theirs, per section 5.3 of the
 * architecture specification.
 *
 * @param {string} studyId The Study ID the request claims.
 * @param {string} participantId The Participant ID the request claims.
 * @param {string} pin The PIN sent with the request.
 * @return {{ok: boolean, reason: (string|undefined)}} Same shape as verifyPin.
 */
function authenticateWrite_(studyId, participantId, pin) {
  const participant = findParticipantRow_(studyId, participantId);
  if (!participant || !participant.enabled) return { ok: false, reason: 'invalid_login' };
  if (!participant.pinHash) return { ok: false, reason: 'not_set' };
  return checkPin_(participant, pin);
}

/**
 * Checks one PIN against a participant's stored hash, and updates the lockout counters that
 * checking it affects either way: back to zero on a match, one higher on a miss, locked once
 * that reaches PIN_MAX_FAILED_ATTEMPTS.
 *
 * Runs under the script lock so that two guesses arriving at once cannot both read the same
 * failed_attempts value and both be forgiven for it.
 *
 * @param {Object} participant Result of findParticipantRow_.
 * @param {string} pin The PIN to check.
 * @return {{ok: boolean, reason: (string|undefined)}} reason is 'locked' or 'wrong_pin' when
 *     ok is false.
 */
function checkPin_(participant, pin) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
  try {
    if (participant.locked) return { ok: false, reason: 'locked' };

    const match = !!pin && constantTimeEquals_(hashPin_(pin, participant.pinSalt), participant.pinHash);
    const sh = participant.sheet;
    if (match) {
      if (participant.failedAttempts !== 0) {
        sh.getRange(participant.row, participant.columns.failed_attempts).setValue(0);
      }
      return { ok: true };
    }

    const attempts = participant.failedAttempts + 1;
    const lockedNow = attempts >= PIN_MAX_FAILED_ATTEMPTS;
    sh.getRange(participant.row, participant.columns.failed_attempts).setValue(attempts);
    if (lockedNow) sh.getRange(participant.row, participant.columns.locked).setValue(BOOL_YES);
    return { ok: false, reason: lockedNow ? 'locked' : 'wrong_pin' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Writes a fresh salt and hash for a participant's PIN, and clears any lockout state. Used both
 * the first time a PIN is set and whenever it is changed.
 *
 * @param {Object} participant Result of findParticipantRow_.
 * @param {string} pin The new PIN.
 */
function writePin_(participant, pin) {
  const salt = randomPinSalt_();
  const hash = hashPin_(pin, salt);
  const sh = participant.sheet;
  const c = participant.columns;
  sh.getRange(participant.row, c.pin_hash).setValue(hash);
  sh.getRange(participant.row, c.pin_salt).setValue(salt);
  sh.getRange(participant.row, c.pin_set_at).setValue(nowIso_());
  sh.getRange(participant.row, c.failed_attempts).setValue(0);
  sh.getRange(participant.row, c.locked).setValue(BOOL_NO);
}

/*
 * ### Sleep Day ###
 */

/**
 * Applies the noon rule to a local wall-clock date and hour: a night that starts at or after
 * noon belongs to that calendar date, and one that starts before noon belongs to the day
 * before. Transcribed from the Power Query step the Depression Center's Sleep Data Automation
 * already uses, so sleep_day values from the two tools line up without anyone reconciling them.
 *
 * @param {number} year Wall-clock year.
 * @param {number} month Wall-clock month, 1 through 12.
 * @param {number} day Wall-clock day of month.
 * @param {number} hour Wall-clock hour, 0 through 23.
 * @return {string} The sleep_day, as 'YYYY-MM-DD'.
 */
function sleepDayFromWallClock_(year, month, day, hour) {
  // Built with Date.UTC and read back with getUTC*/toISOString, purely so that adding or
  // subtracting a day is never disturbed by the server's own time zone or a daylight saving
  // transition; nothing here is actually a UTC instant, it is calendar-date arithmetic.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (hour < 12) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The sleep_day for a marker or an answer given as a local ISO time with offset. Reads the
 * wall-clock date and hour directly out of the string rather than through a JavaScript Date,
 * because the noon rule is defined on local time and a Date built from an offset-bearing ISO
 * string is reinterpreted in whatever time zone the server happens to run in.
 *
 * @param {string} localIso Local time with offset, for example '2026-08-16T23:30-04:00'.
 * @return {string} The sleep_day, as 'YYYY-MM-DD'.
 * @throws {Error} If localIso is not in the expected shape.
 */
function sleepDayFromLocal_(localIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localIso || ''));
  if (!m) throw new Error('Not a local ISO time with an offset: ' + localIso);
  return sleepDayFromWallClock_(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
}

/**
 * The sleep_day for an instant given as UTC plus the offset in force at the time, used for
 * Surveys rows, which carry only survey_opened_utc and tz_offset_minutes. The Surveys tab needs
 * no SLEEP lookup: a morning diary is filled in after waking, so the noon rule applied to when
 * it opened already names the night being reported.
 *
 * @param {string} utcIso An instant in UTC.
 * @param {number} offsetMinutes Minutes to add to UTC to reach local time.
 * @return {string} The sleep_day, as 'YYYY-MM-DD'.
 */
function sleepDayFromUtcAndOffset_(utcIso, offsetMinutes) {
  const local = new Date(toEpochMs_(utcIso) + Number(offsetMinutes) * 60000);
  return sleepDayFromWallClock_(
    local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours());
}

/** How many SleepDiary rows a WAKE's paired-SLEEP lookup scans backward before giving up and
 *  falling back to the noon rule on the WAKE's own time. Bounds the cost of the lookup so it
 *  does not grow with the size of the study; a real gap this wide means the pairing was already
 *  broken by a missing SLEEP tap, not by a search that gave up too soon. */
const SLEEP_LOOKUP_SCAN_LIMIT = 2000;

/**
 * Finds the sleep_day a WAKE marker should carry: the sleep_day of the most recent SLEEP marker
 * for the same study and participant at or before the WAKE's instant, per section 3.5.1 of the
 * architecture specification.
 *
 * Scans backward from the bottom of the SleepDiary tab in chunks, so a study with years of
 * history costs the same as one with a week, and stops once it passes SLEEP_LOOKUP_SCAN_LIMIT
 * rows without a match. A WAKE with no SLEEP before it at all -- the first night of a study, or
 * a missed tap -- is expected, not an error; the caller falls back to the noon rule.
 *
 * @param {Sheet} sh The SleepDiary worksheet.
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_(sh).
 * @param {string} studyId The study to match.
 * @param {string} participantId The participant to match.
 * @param {number} wakeUtcMs The WAKE's instant, as epoch milliseconds.
 * @return {?string} The preceding SLEEP's sleep_day, or null if none was found within the scan
 *     limit.
 */
function findPrecedingSleepDay_(sh, headerMap, studyId, participantId, wakeUtcMs) {
  const c = {
    study_id: columnOf_(headerMap, 'study_id', 'SleepDiary'),
    participant_id: columnOf_(headerMap, 'participant_id', 'SleepDiary'),
    marker: columnOf_(headerMap, 'marker', 'SleepDiary'),
    event_utc: columnOf_(headerMap, 'event_utc', 'SleepDiary'),
    sleep_day: columnOf_(headerMap, 'sleep_day', 'SleepDiary')
  };
  const width = Math.max(c.study_id, c.participant_id, c.marker, c.event_utc, c.sleep_day);
  const wantedStudy = normalizeId_(studyId);
  const wantedParticipant = normalizeId_(participantId);

  let bottom = sh.getLastRow();
  let scanned = 0;
  while (bottom >= 2 && scanned < SLEEP_LOOKUP_SCAN_LIMIT) {
    const chunkSize = Math.min(200, bottom - 1);
    const top = bottom - chunkSize + 1;
    const rows = sh.getRange(top, 1, chunkSize, width).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      scanned++;
      const row = rows[i];
      if (normalizeId_(row[c.study_id - 1]) !== wantedStudy) continue;
      if (normalizeId_(row[c.participant_id - 1]) !== wantedParticipant) continue;
      if (row[c.marker - 1] !== 'SLEEP') continue;
      if (toEpochMs_(row[c.event_utc - 1]) <= wakeUtcMs) return String(row[c.sleep_day - 1]);
    }
    bottom = top - 1;
  }
  return null;
}

/**
 * Works out which night a marker belongs to, per section 3.5.1 of the architecture
 * specification. A SLEEP marker only ever needs the noon rule applied to its own local time. A
 * WAKE marker inherits the sleep_day of the most recent SLEEP at or before it, so that a
 * participant who logs SLEEP on one device and WAKE on another still gets one paired night; a
 * WAKE with nothing before it falls back to the noon rule on its own time, which is what keeps
 * the column from ever being empty.
 *
 * @param {Sheet} sh The SleepDiary worksheet.
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_(sh).
 * @param {string} marker 'SLEEP' or 'WAKE'.
 * @param {string} studyId The study this marker belongs to.
 * @param {string} participantId Who recorded it.
 * @param {string} eventLocal The marker's local time with offset.
 * @param {string} eventUtc The marker's UTC time.
 * @return {string} The sleep_day, as 'YYYY-MM-DD'.
 */
function assignSleepDay_(sh, headerMap, marker, studyId, participantId, eventLocal, eventUtc) {
  if (marker === 'SLEEP') return sleepDayFromLocal_(eventLocal);
  const precedingSleepDay =
    findPrecedingSleepDay_(sh, headerMap, studyId, participantId, toEpochMs_(eventUtc));
  return precedingSleepDay != null ? precedingSleepDay : sleepDayFromLocal_(eventLocal);
}

/**
 * After a SLEEP marker's time changes, recomputes sleep_day for every WAKE that was paired to
 * it under its old value, using the same nearest-preceding-SLEEP rule the WAKE would use on its
 * own. A SLEEP edit that crosses noon, or reorders it past a neighboring SLEEP, can change which
 * SLEEP a WAKE actually pairs with; this keeps a pair from disagreeing either way, per section
 * 3.5.1 of the architecture specification.
 *
 * @param {Sheet} sh The SleepDiary worksheet.
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_(sh).
 * @param {string} studyId The study the edited marker belongs to.
 * @param {string} participantId The participant the edited marker belongs to.
 * @param {string} oldSleepDay The SLEEP marker's sleep_day before this edit.
 */
function repairPairedWakeSleepDay_(sh, headerMap, studyId, participantId, oldSleepDay) {
  const c = {
    study_id: columnOf_(headerMap, 'study_id', 'SleepDiary'),
    participant_id: columnOf_(headerMap, 'participant_id', 'SleepDiary'),
    marker: columnOf_(headerMap, 'marker', 'SleepDiary'),
    event_utc: columnOf_(headerMap, 'event_utc', 'SleepDiary'),
    event_local: columnOf_(headerMap, 'event_local', 'SleepDiary'),
    sleep_day: columnOf_(headerMap, 'sleep_day', 'SleepDiary')
  };
  const width =
    Math.max(c.study_id, c.participant_id, c.marker, c.event_utc, c.event_local, c.sleep_day);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const rows = sh.getRange(2, 1, lastRow - 1, width).getValues();

  const wantedStudy = normalizeId_(studyId);
  const wantedParticipant = normalizeId_(participantId);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (normalizeId_(row[c.study_id - 1]) !== wantedStudy) continue;
    if (normalizeId_(row[c.participant_id - 1]) !== wantedParticipant) continue;
    if (row[c.marker - 1] !== 'WAKE') continue;
    if (String(row[c.sleep_day - 1]) !== oldSleepDay) continue;

    const precedingSleepDay = findPrecedingSleepDay_(
      sh, headerMap, studyId, participantId, toEpochMs_(row[c.event_utc - 1]));
    const newSleepDay = precedingSleepDay != null
      ? precedingSleepDay
      : sleepDayFromLocal_(String(row[c.event_local - 1]));
    if (newSleepDay !== oldSleepDay) sh.getRange(i + 2, c.sleep_day).setValue(newSleepDay);
  }
}

/*
 * ### Sleep And Wake Markers ###
 */

/**
 * Client-callable: records a SLEEP or WAKE marker.
 *
 * Idempotent on record_id: retrying a submission the device is unsure reached the server
 * updates the existing row instead of adding a second one, per section 14.1 of the
 * architecture specification, so a flaky connection can never duplicate a night.
 *
 * @param {Object} payload {study_id, participant_id, pin, record_id, marker, event_local,
 *     event_tz, event_utc, source, app_version}.
 * @return {{ok: boolean, reason: (string|undefined), sleep_day: (string|undefined)}} reason is
 *     set only when ok is false: 'invalid_login', 'not_set', 'locked', 'wrong_pin', 'busy', or
 *     'invalid_payload'.
 */
function logMarker(payload) {
  payload = payload || {};
  const auth = authenticateWrite_(payload.study_id, payload.participant_id, payload.pin);
  if (!auth.ok) return auth;

  if (!payload.record_id || (payload.marker !== 'SLEEP' && payload.marker !== 'WAKE')
    || !payload.event_local || !payload.event_tz || !payload.event_utc) {
    return { ok: false, reason: 'invalid_payload' };
  }

  const tab = tabDeclaration_('SleepDiary');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, reason: 'busy' };
  try {
    const sh = getSpreadsheet_().getSheetByName(tab.name);
    const headerMap = sheetHeaderMap_(sh);
    const sleepDay = assignSleepDay_(sh, headerMap, payload.marker, payload.study_id,
      payload.participant_id, payload.event_local, payload.event_utc);

    upsertRowByKey_(sh, headerMap, 'record_id', payload.record_id, {
      record_id: payload.record_id,
      study_id: payload.study_id,
      participant_id: payload.participant_id,
      marker: payload.marker,
      event_local: payload.event_local,
      event_tz: payload.event_tz,
      event_utc: payload.event_utc,
      sleep_day: sleepDay,
      edited: BOOL_NO,
      modified_utc: '',
      received_utc: nowIso_(),
      source: payload.source || 'web',
      app_version: payload.app_version || APP_VERSION
    }, tab.name);
    return { ok: true, sleep_day: sleepDay };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Client-callable: corrects the time on an existing SLEEP or WAKE marker.
 *
 * Enforced here as well as on the client, because the client runs on a device and anything a
 * device sends is untrusted (section 10 of the architecture specification). The edit window is
 * measured from the time already stored, not the proposed one, and from when the participant
 * made the edit rather than when the request arrives -- client_edit_utc carries that, so a
 * queued edit is judged fairly after time spent offline. Editing a SLEEP marker also recomputes
 * the sleep_day of the WAKE paired with it, so the two can never disagree.
 *
 * @param {Object} payload {study_id, participant_id, pin, record_id, event_local, event_tz,
 *     event_utc, client_edit_utc, source, app_version}. client_edit_utc is optional; a request
 *     made and answered online can leave it out and be judged by server time instead.
 * @return {{ok: boolean, reason: (string|undefined), sleep_day: (string|undefined)}} reason is
 *     set only when ok is false: 'invalid_login', 'not_set', 'locked', 'wrong_pin', 'busy',
 *     'invalid_payload', 'not_found', or 'edit_window_expired'.
 */
function updateMarker(payload) {
  payload = payload || {};
  const auth = authenticateWrite_(payload.study_id, payload.participant_id, payload.pin);
  if (!auth.ok) return auth;

  if (!payload.record_id || !payload.event_local || !payload.event_tz || !payload.event_utc) {
    return { ok: false, reason: 'invalid_payload' };
  }

  const tab = tabDeclaration_('SleepDiary');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, reason: 'busy' };
  try {
    const sh = getSpreadsheet_().getSheetByName(tab.name);
    const headerMap = sheetHeaderMap_(sh);
    const found = findRowByKey_(sh, headerMap, 'record_id', payload.record_id, tab.name);
    if (!found
      || normalizeId_(found.study_id) !== normalizeId_(payload.study_id)
      || normalizeId_(found.participant_id) !== normalizeId_(payload.participant_id)) {
      return { ok: false, reason: 'not_found' };
    }

    const editMadeMs = payload.client_edit_utc ? toEpochMs_(payload.client_edit_utc) : Date.now();
    const ageDays = (editMadeMs - toEpochMs_(found.event_utc)) / 86400000;
    if (ageDays > readEditWindowDays_()) return { ok: false, reason: 'edit_window_expired' };

    const marker = String(found.marker);
    const oldSleepDay = String(found.sleep_day);
    const sleepDay = assignSleepDay_(sh, headerMap, marker, payload.study_id,
      payload.participant_id, payload.event_local, payload.event_utc);

    upsertRowByKey_(sh, headerMap, 'record_id', payload.record_id, {
      event_local: payload.event_local,
      event_tz: payload.event_tz,
      event_utc: payload.event_utc,
      sleep_day: sleepDay,
      edited: BOOL_YES,
      modified_utc: nowIso_()
    }, tab.name);

    if (marker === 'SLEEP') {
      repairPairedWakeSleepDay_(sh, headerMap, payload.study_id, payload.participant_id, oldSleepDay);
    }
    return { ok: true, sleep_day: sleepDay };
  } finally {
    lock.releaseLock();
  }
}

/*
 * ### Surveys ###
 */

/**
 * A short fingerprint of the questions currently visible on QuestionsSetup: their IDs and
 * wording, in ID order. Computed fresh for every survey, so that if a researcher changes a
 * question's wording mid-study, surveys answered before and after the change carry different
 * hashes and are identifiable during analysis instead of silently mixed together, per section
 * 3.4.2 of the architecture specification.
 *
 * @return {string} 16 hex characters.
 */
function currentQuestionSetHash_() {
  const tab = tabDeclaration_('QuestionsSetup');
  const sh = getSpreadsheet_().getSheetByName(tab.name);
  const headerMap = sheetHeaderMap_(sh);
  const idColumn = columnOf_(headerMap, 'question_id', tab.name);
  const textColumn = columnOf_(headerMap, 'display_text', tab.name);
  const visibleColumn = columnOf_(headerMap, 'visible', tab.name);
  const width = Math.max(idColumn, textColumn, visibleColumn);
  const lastRow = sh.getLastRow();
  const rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, width).getValues() : [];

  const parts = rows
    .filter(function (row) { return isYes_(row[visibleColumn - 1]); })
    .map(function (row) { return String(row[idColumn - 1]) + '=' + String(row[textColumn - 1]); })
    .sort();

  return bytesToHex_(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, parts.join('|'))).slice(0, 16);
}

/**
 * Turns questions_locked on the first time any survey is written, and never again. A deployed
 * copy of the app never updates, so the researcher's own edit to QuestionsSetup after this
 * point is the only way wording can still change mid-study; the flag exists to warn them that
 * doing so now carries the cost described in section 3.4.2 of the architecture specification.
 */
function lockQuestionsIfNeeded_() {
  const tab = tabDeclaration_('StudySettings');
  const sh = getSpreadsheet_().getSheetByName(tab.name);
  if (!sh || sh.getLastRow() < 2) return;
  const headerMap = sheetHeaderMap_(sh);
  const lockedColumn = columnOf_(headerMap, 'questions_locked', tab.name);
  if (isYes_(sh.getRange(2, lockedColumn).getValue())) return;
  sh.getRange(2, lockedColumn).setValue(BOOL_YES);
  sh.getRange(2, columnOf_(headerMap, 'questions_locked_at', tab.name)).setValue(nowIso_());
}

/**
 * Client-callable: records one survey, and every answer it showed, in a single locked operation
 * so that neither can exist without the other -- an interrupted write can never leave a Surveys
 * row with no SurveyAnswers rows behind it, or the reverse.
 *
 * Idempotent on survey_id (the Surveys row) and on each answer's own record_id, on the same
 * terms as logMarker. Accepts a survey with no answers and records why through end_reason, per
 * section 3.6 of the architecture specification.
 *
 * @param {Object} payload {study_id, participant_id, pin, survey_id, sleep_record_id,
 *     wake_record_id, wake_marker_utc, survey_opened_utc, survey_ended_utc, end_reason,
 *     event_tz, tz_offset_minutes, source, app_version, answers}. Each entry in answers is
 *     {record_id, question_id, question_source, answer_type, question_text_shown, required,
 *     display_order, answer_order, value, value_number, value_unit, answered_utc, edited_utc,
 *     edit_count, time_to_answer_ms}.
 * @return {{ok: boolean, reason: (string|undefined), sleep_day: (string|undefined)}} reason is
 *     set only when ok is false: 'invalid_login', 'not_set', 'locked', 'wrong_pin', 'busy', or
 *     'invalid_payload'.
 */
function logSurvey(payload) {
  payload = payload || {};
  const auth = authenticateWrite_(payload.study_id, payload.participant_id, payload.pin);
  if (!auth.ok) return auth;

  if (!payload.survey_id || !payload.survey_opened_utc
    || END_REASONS.indexOf(payload.end_reason) === -1 || !Array.isArray(payload.answers)) {
    return { ok: false, reason: 'invalid_payload' };
  }

  const surveysTab = tabDeclaration_('Surveys');
  const answersTab = tabDeclaration_('SurveyAnswers');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, reason: 'busy' };
  try {
    const ss = getSpreadsheet_();
    const surveysSheet = ss.getSheetByName(surveysTab.name);
    const answersSheet = ss.getSheetByName(answersTab.name);
    const surveysHeaderMap = sheetHeaderMap_(surveysSheet);
    const answersHeaderMap = sheetHeaderMap_(answersSheet);

    const offsetMinutes = Number(payload.tz_offset_minutes) || 0;
    const sleepDay = sleepDayFromUtcAndOffset_(payload.survey_opened_utc, offsetMinutes);
    const receivedUtc = nowIso_();
    const answeredCount = payload.answers.filter(function (a) { return a && a.answered_utc; }).length;
    const editCountTotal = payload.answers.reduce(
      function (sum, a) { return sum + (Number(a && a.edit_count) || 0); }, 0);

    upsertRowByKey_(surveysSheet, surveysHeaderMap, 'survey_id', payload.survey_id, {
      survey_id: payload.survey_id,
      study_id: payload.study_id,
      participant_id: payload.participant_id,
      sleep_day: sleepDay,
      sleep_record_id: payload.sleep_record_id || '',
      wake_record_id: payload.wake_record_id || '',
      wake_marker_utc: payload.wake_marker_utc || '',
      survey_opened_utc: payload.survey_opened_utc,
      survey_ended_utc: payload.survey_ended_utc || '',
      survey_duration_ms: payload.survey_ended_utc
        ? toEpochMs_(payload.survey_ended_utc) - toEpochMs_(payload.survey_opened_utc) : '',
      end_reason: payload.end_reason,
      question_count: payload.answers.length,
      answered_count: answeredCount,
      skipped_count: payload.answers.length - answeredCount,
      edit_count_total: editCountTotal,
      question_set_hash: currentQuestionSetHash_(),
      event_tz: payload.event_tz || '',
      tz_offset_minutes: offsetMinutes,
      record_id: payload.survey_id,
      received_utc: receivedUtc,
      source: payload.source || 'web',
      app_version: payload.app_version || APP_VERSION
    }, surveysTab.name);

    payload.answers.forEach(function (answer) {
      if (!answer || !answer.record_id || !answer.question_id) {
        throw new Error('invalid_payload');
      }
      upsertRowByKey_(answersSheet, answersHeaderMap, 'record_id', answer.record_id, {
        record_id: answer.record_id,
        survey_id: payload.survey_id,
        study_id: payload.study_id,
        participant_id: payload.participant_id,
        sleep_day: sleepDay,
        question_id: answer.question_id,
        question_source: QUESTION_SOURCES.indexOf(answer.question_source) !== -1
          ? answer.question_source : 'default',
        answer_type: answer.answer_type || '',
        question_text_shown: answer.question_text_shown || '',
        required: isYes_(answer.required) ? BOOL_YES : BOOL_NO,
        display_order: answer.display_order != null ? answer.display_order : '',
        answer_order: answer.answer_order != null ? answer.answer_order : '',
        value: answer.value != null ? answer.value : '',
        value_number: answer.value_number != null ? answer.value_number : '',
        value_unit: answer.value_unit || '',
        answered_utc: answer.answered_utc || '',
        edited_utc: answer.edited_utc || '',
        edit_count: Number(answer.edit_count) || 0,
        time_to_answer_ms: answer.time_to_answer_ms != null ? answer.time_to_answer_ms : '',
        received_utc: receivedUtc,
        source: payload.source || 'web',
        app_version: payload.app_version || APP_VERSION
      }, answersTab.name);
    });

    lockQuestionsIfNeeded_();
    return { ok: true, sleep_day: sleepDay };
  } catch (err) {
    if (err && err.message === 'invalid_payload') return { ok: false, reason: 'invalid_payload' };
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/*
 * ### Helpers ###
 */

/**
 * Resolves the workbook this deployment writes to: the one the script is attached to, and no
 * other.
 *
 * There is deliberately no way to name a different spreadsheet by ID. Opening a workbook by ID
 * requires permission over every spreadsheet in the researcher's Drive, and this app only ever
 * needs the one it lives in. Keeping the narrower permission is worth more than a deployment
 * route nobody uses: both documented routes attach the script to the workbook.
 *
 * @return {Spreadsheet} The workbook this deployment writes to.
 * @throws {Error} If the script is not attached to a spreadsheet.
 */
function getSpreadsheet_() {
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  throw new Error('This script is not attached to a spreadsheet. Open your MiNap Go workbook, '
    + 'choose Extensions and then Apps Script, and deploy from there.');
}

/**
 * Looks a tab up in the declaration by name.
 *
 * @param {string} name The worksheet name.
 * @return {Object} The declaration entry.
 * @throws {Error} If the name is not declared, which can only be a mistake in this file.
 */
function tabDeclaration_(name) {
  for (let i = 0; i < WORKBOOK.tabs.length; i++) {
    if (WORKBOOK.tabs[i].name === name) return WORKBOOK.tabs[i];
  }
  throw new Error('No tab named ' + name + ' is declared in WORKBOOK.');
}

/**
 * Where a named column sits on a tab, counting from 1. Reading the position out of the
 * declaration rather than writing a number into the code is what keeps column order in one
 * place.
 *
 * Only for provisioning, where WORKBOOK's declared order is exactly the thing being checked or
 * built. Anything that reads or writes live participant, marker, or survey data resolves
 * columns with sheetHeaderMap_ and columnOf_ instead, because provisioning runs once per layout
 * version rather than on every open (see ensureWorkbook_), so a column renamed or reordered by
 * hand afterwards would otherwise be found only by the row that lands under the wrong heading.
 *
 * @param {Object} tab A declaration entry.
 * @param {string} header The column's header text.
 * @return {number} The column number.
 * @throws {Error} If the column is not declared, which can only be a mistake in this file.
 */
function headerPosition_(tab, header) {
  for (let i = 0; i < tab.columns.length; i++) {
    if (tab.columns[i].header === header) return i + 1;
  }
  throw new Error('No column named ' + header + ' is declared on the ' + tab.name + ' tab.');
}

/**
 * Reads the header row of a live worksheet, so that a caller can find a column by the text
 * actually sitting in row 1 right now rather than by trusting where WORKBOOK expects it.
 *
 * @param {Sheet} sh The worksheet to read.
 * @return {Object<string, number>} Header text to column number, counting from 1.
 */
function sheetHeaderMap_(sh) {
  const width = sh.getLastColumn();
  const map = {};
  if (width < 1) return map;
  sh.getRange(1, 1, 1, width).getValues()[0].forEach(function (value, i) {
    const text = String(value == null ? '' : value).trim();
    if (text) map[text] = i + 1;
  });
  return map;
}

/**
 * Looks up one column in a header map built by sheetHeaderMap_.
 *
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_.
 * @param {string} header The column's header text.
 * @param {string} tabName Worksheet name, used only in the error message.
 * @return {number} The column number, counting from 1.
 * @throws {Error} If the column is not present on the live sheet right now.
 */
function columnOf_(headerMap, header, tabName) {
  const column = headerMap[header];
  if (!column) {
    throw new Error('The ' + tabName + ' tab has no "' + header + '" column right now. Nothing '
      + 'has been changed. Put that header back, or start a new study from a fresh copy of the '
      + 'template.');
  }
  return column;
}

/**
 * Writes one row of values, keyed by a column that never repeats. If a row with this key
 * already exists it is overwritten in place; otherwise a new row is appended. This is what lets
 * a resent record_id update the row it already produced instead of adding a duplicate, per
 * section 14.1 of the architecture specification.
 *
 * @param {Sheet} sh The worksheet to write to.
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_(sh).
 * @param {string} keyHeader The header of the column that carries the key.
 * @param {string} keyValue The key to look for.
 * @param {Object<string, *>} values Column header to value, for every column this write sets.
 * @param {string} tabName Worksheet name, used only in error messages.
 */
function upsertRowByKey_(sh, headerMap, keyHeader, keyValue, values, tabName) {
  const keyColumn = columnOf_(headerMap, keyHeader, tabName);
  const lastRow = sh.getLastRow();
  let targetRow = null;
  if (lastRow >= 2) {
    const keys = sh.getRange(2, keyColumn, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(keyValue)) { targetRow = i + 2; break; }
    }
  }
  if (targetRow == null) targetRow = lastRow + 1;

  Object.keys(values).forEach(function (header) {
    sh.getRange(targetRow, columnOf_(headerMap, header, tabName)).setValue(values[header]);
  });
}

/**
 * Finds one row by a key column and reads every column the sheet's live header row names.
 *
 * @param {Sheet} sh The worksheet to search.
 * @param {Object<string, number>} headerMap Result of sheetHeaderMap_(sh).
 * @param {string} keyHeader The header of the column that carries the key.
 * @param {string} keyValue The key to look for.
 * @param {string} tabName Worksheet name, used only in error messages.
 * @return {?Object} Header text to value, plus `row` (the sheet row number, counting from 1).
 *     Null if no row carries this key.
 */
function findRowByKey_(sh, headerMap, keyHeader, keyValue, tabName) {
  const keyColumn = columnOf_(headerMap, keyHeader, tabName);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const lastColumn = sh.getLastColumn();
  const keys = sh.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) !== String(keyValue)) continue;
    const rowValues = sh.getRange(i + 2, 1, 1, lastColumn).getValues()[0];
    const result = { row: i + 2 };
    Object.keys(headerMap).forEach(function (header) { result[header] = rowValues[headerMap[header] - 1]; });
    return result;
  }
  return null;
}

/**
 * Reads edit_window_days from StudySettings, resolving the column by its live header text.
 * Falls back to the built-in default only if the tab cannot be read at all, which should only
 * happen before the workbook is provisioned.
 *
 * @return {number} The number of days a marker may still be edited after it was logged.
 */
function readEditWindowDays_() {
  try {
    const tab = tabDeclaration_('StudySettings');
    const sh = getSpreadsheet_().getSheetByName(tab.name);
    if (!sh || sh.getLastRow() < 2) return EDIT_WINDOW_DAYS;
    const column = columnOf_(sheetHeaderMap_(sh), 'edit_window_days', tab.name);
    const value = Number(sh.getRange(2, column).getValue());
    return value > 0 ? value : EDIT_WINDOW_DAYS;
  } catch (e) {
    return EDIT_WINDOW_DAYS;
  }
}

/**
 * The current instant as an ISO 8601 string in UTC, for every *_utc column this file writes.
 *
 * @return {string} For example '2026-08-16T23:30:00.000Z'.
 */
function nowIso_() {
  return new Date().toISOString();
}

/**
 * An instant, given as an ISO string or already a Date, as epoch milliseconds. Accepts either
 * because a value written by this file's own setValue calls can come back from getValues() as a
 * JavaScript Date if Sheets recognised it as one, or as the original string if it did not.
 *
 * @param {string|Date} value The instant to convert.
 * @return {number} Epoch milliseconds. NaN if value cannot be parsed as a date.
 */
function toEpochMs_(value) {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}

/**
 * Bytes, as returned by Utilities.computeDigest, spelled out as lowercase hex.
 *
 * @param {Array<number>} bytes Signed bytes from Utilities.computeDigest.
 * @return {string} Two hex characters per byte.
 */
function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/**
 * The error raised when a worksheet is not laid out the way the declaration describes. It
 * names what was expected and what was found, because a person has to put the workbook right
 * by hand, and it says plainly that nothing was changed.
 *
 * @param {string} tabName Which worksheet.
 * @param {number} rowIndex Which row the headers are on.
 * @param {number} columnIndex Which column, counting from 1.
 * @param {string} expected The header that belongs there.
 * @param {string} found What is there instead.
 * @return {Error} The error to throw.
 */
function shapeError_(tabName, rowIndex, columnIndex, expected, found) {
  const shown = found.length > 50 ? found.substring(0, 50) + '...' : found;
  return new Error('The ' + tabName + ' tab is not laid out the way this app expects. Row '
    + rowIndex + ', column ' + columnLetter_(columnIndex) + ' should read "' + expected
    + '" but reads "' + shown + '". Nothing has been changed. Put that header back, or start a '
    + 'new study from a fresh copy of the template.');
}

/**
 * Spreadsheet column letter for a column number, so that a message can say "column C" rather
 * than "column 3".
 *
 * @param {number} columnIndex Column number, counting from 1.
 * @return {string} The column letter or letters.
 */
function columnLetter_(columnIndex) {
  let letters = '';
  let remaining = columnIndex;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - remainder) / 26);
  }
  return letters;
}

/**
 * Reads a yes-or-no cell loosely. The app writes only the words Yes and No, but a person or a
 * spreadsheet may leave a checkbox, a number, or a different casing behind, and a researcher
 * who typed "yes" must not silently have said no.
 *
 * An empty cell is not a yes. It means nobody has said yet, which callers treat as they need.
 *
 * @param {*} value The raw cell value.
 * @return {boolean} True only for an affirmative value.
 */
function isYes_(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'yes' || text === 'true' || text === '1';
}

/**
 * Trims a Study or Participant ID and puts it in one letter case, so that a comparison does
 * not depend on how it was typed. Used for comparison only; what the workbook holds stays
 * exactly as the researcher entered it.
 *
 * @param {*} value The raw ID.
 * @return {string} The comparable form.
 */
function normalizeId_(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

/**
 * Escapes text for insertion into HTML, so that a value read out of the workbook can be shown
 * on a page without any of it being treated as markup.
 *
 * @param {string} text The text to escape.
 * @return {string} The escaped text.
 */
function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
