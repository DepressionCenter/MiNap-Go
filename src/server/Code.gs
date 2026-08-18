// This file is part of MiNap Go
// Code.gs
// Author(s): Gabriel Mongefranco
// Created: 2026-07-09
// Last Modified: 2026-08-18
// Summary: Server-side Apps Script; serves the web app and reads/writes sleep events to the bound Google Sheet.
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
 * The shape of every entry:
 *
 *   schemaVersion  Stamped into Setup when the workbook is created, and checked on every
 *                  later open. A workbook built by an older version is refused, not upgraded:
 *                  a deployed copy of the app never updates itself, so there is no migration
 *                  path, and pretending otherwise would corrupt data.
 *   tabs[]         One entry per worksheet, in the order they should appear.
 *     name         Worksheet name, exactly as it appears on the tab.
 *     purpose      One sentence for a maintainer reading this file cold.
 *     hidden       True for helper tabs the researcher never opens.
 *     frozenRows   Rows locked at the top of the worksheet.
 *     appendOnly   True where the app adds rows over time, so the tab starts empty.
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
 * Two things are deliberately over-provisioned. Questions always holds twenty rows, and EMA
 * always holds twenty answer columns, even though version 1 ships eight questions. Adding a
 * column after studies exist would mean every researcher editing their own workbook by hand,
 * so the space is claimed now, while it is free.
 */

/** Layout version stamped into Setup. Raise it only for a change that makes an existing
 *  workbook unreadable, because raising it locks every workbook built before the change. */
const SCHEMA_VERSION = 1;

/** How many question rows the Questions tab always holds, and how many `EMA_` answer columns
 *  the EMA tab always holds. The two are the same number by design: one answer column per
 *  possible question, so a spare question can be put to use without changing the EMA tab. */
const QUESTION_SLOT_COUNT = 20;

/** Fixed dimensions of the hidden `_calc` tab. Chart ranges are constants written once
 *  because these never change: fourteen nights of history, seven days of the week, and one
 *  row per question slot. A chart that worked out its own range would break the first time a
 *  study had fewer than fourteen nights of data. */
const CALC_DAY_ROWS = 14;
const CALC_WEEKDAY_ROWS = 7;
const CALC_QUESTION_ROWS = QUESTION_SLOT_COUNT;

/** Answer types a question may use. How each is stored is in the architecture specification,
 *  section 3.4: `time` is an ISO 8601 local time with an offset, and every other type is a
 *  whole number. */
const ANSWER_TYPES = ['time', 'duration_minutes', 'count', 'ordinal', 'scale', 'binary'];

/** How a rating question is presented: `slider` for wide rating scales, `buttons` where every
 *  option is worth showing, `stepper` for counts and durations. Empty for a time question,
 *  which uses the time picker built into the device. */
const INPUT_STYLES = ['slider', 'buttons', 'stepper'];

/** Which marker, if any, pre-fills a question's answer. A pre-filled value is a suggestion
 *  the participant may change; the marker itself is never overwritten from the answer. */
const PREFILL_SOURCES = ['SLEEP_MARKER', 'WAKE_MARKER'];

/**
 * Question and answer-column ID for slot `n`, zero-padded to two digits, as in `EMA_01`.
 *
 * @param {number} n Slot number, 1 through QUESTION_SLOT_COUNT.
 * @return {string} The question ID.
 */
function questionId_(n) {
  return 'EMA_' + (n < 10 ? '0' + n : String(n));
}

/**
 * Builds the default contents of the Questions tab.
 *
 * The default set is the Consensus Sleep Diary, Core version (Carney et al., 2012), the
 * standard daily sleep diary in insomnia research. Using a published instrument means results
 * can be compared with other studies instead of being trapped in this tool. Question numbers
 * match the item numbers of the instrument, so `EMA_03` is item 3 and the workbook can be
 * read without a codebook. That numbering is permanent.
 *
 * TODO: The wording below is provisional and must be settled before any study starts, because
 * a deployed copy of the app never updates. Permission to redistribute the Consensus Sleep
 * Diary wording inside a GPL-licensed tool is not yet confirmed with its authors, and it is
 * not yet settled whether the Core version or an expanded version is wanted. The IDs, answer
 * types, ranges, and pre-fill sources are final; only `display_text` is open.
 *
 * Two items of the published instrument are left out on purpose. The free-text comments box
 * and the medication list both invite a participant to type health information and personal
 * details into a field that lands in the researcher's spreadsheet. Participants who want to
 * write things down use the private notes feature, which never leaves their device.
 *
 * @return {Array<Array<string|number>>} One array per question, values in the same order as
 *     the columns of the Questions tab.
 */
function buildQuestionDefaultRows_() {
  const rows = [
    ['EMA_01', 'What time did you get into bed?',
      'time', '', '', '', '', '', '', '', 'YES', 1],
    ['EMA_02', 'What time did you try to go to sleep?',
      'time', '', '', '', '', '', '', 'SLEEP_MARKER', 'YES', 2],
    ['EMA_03', 'How long did it take you to fall asleep?',
      'duration_minutes', 0, 600, 'stepper', '', '', 'minutes', '', 'YES', 3],
    ['EMA_04', 'How many times did you wake up, not counting your final awakening?',
      'count', 0, 20, 'stepper', '', '', 'times', '', 'YES', 4],
    ['EMA_05', 'In total, how long did these awakenings last?',
      'duration_minutes', 0, 600, 'stepper', '', '', 'minutes', '', 'YES', 5],
    ['EMA_06', 'What time was your final awakening?',
      'time', '', '', '', '', '', '', 'WAKE_MARKER', 'YES', 6],
    ['EMA_07', 'What time did you get out of bed for the day?',
      'time', '', '', '', '', '', '', '', 'YES', 7],
    ['EMA_08', 'How would you rate the quality of your sleep?',
      'ordinal', 1, 5, 'buttons', 'Very poor', 'Very good', '', '', 'YES', 8]
  ];

  // The remaining slots ship empty and hidden. They exist so that a researcher can add a
  // question by filling in a row, rather than by adding a column to a workbook already in use.
  for (let n = rows.length + 1; n <= QUESTION_SLOT_COUNT; n++) {
    rows.push([questionId_(n), '', '', '', '', '', '', '', '', '', 'NO', n]);
  }
  return rows;
}

/**
 * The twenty `EMA_` answer columns of the EMA tab, one per question slot, always all twenty
 * whether or not the matching question is in use. EMA-CleanR picks answer columns up by their
 * `EMA_` prefix and ignores columns it does not recognise.
 *
 * @return {Array<Object>} Column declarations, in slot order.
 */
function emaAnswerColumns_() {
  const columns = [];
  for (let n = 1; n <= QUESTION_SLOT_COUNT; n++) {
    columns.push({
      header: questionId_(n),
      width: 110,
      note: 'Answer to question ' + questionId_(n) + ' on the Questions tab. Empty when that '
        + 'question was not shown, or was not answered.'
    });
  }
  return columns;
}

const WORKBOOK = {
  schemaVersion: SCHEMA_VERSION,
  tabs: [
    {
      name: 'Setup',
      purpose: 'Study settings: one header row, and one row of values under it.',
      hidden: false,
      frozenRows: 1,
      appendOnly: false,
      columns: [
        { header: 'web_app_url', width: 460,
          note: 'The link participants use. The app fills this in the first time you open the '
            + 'web app, so you never have to hunt for it.' },
        { header: 'schema_version', width: 120,
          note: 'Which workbook layout this is, set by the app. Do not change it. If it does '
            + 'not match the app, the app stops instead of writing into a layout it does not '
            + 'know.' },
        { header: 'questions_locked', width: 130,
          note: 'TRUE once a participant has submitted a survey. After that, changing the '
            + 'wording of a question makes two different questions share one column, and '
            + 'nothing in the data can tell those answers apart later.' },
        { header: 'questions_locked_at', width: 170,
          note: 'When the questions were locked, in UTC. Set by the app.' },
        { header: 'edit_window_days', width: 140,
          note: 'How many days a participant may go back and correct a sleep or wake time. '
            + 'Counted from the time already stored, not from the new one. Default 7.' },
        { header: 'backup_reminder_days', width: 170,
          note: 'How often the app reminds a participant to export a backup, in days. '
            + 'Default 15.' },
        { header: 'dashboard_filter', width: 150,
          note: 'What the Dashboard charts show: ALL for everyone, or one Participant ID to '
            + 'look at a single person.' }
      ],
      defaultRows: [
        ['', SCHEMA_VERSION, 'FALSE', '', 7, 15, 'ALL']
      ]
    },

    {
      name: 'Participants',
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
          note: 'YES or NO. Set it to NO to end access for this person while keeping their '
            + 'data.' },
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
          note: 'TRUE once there have been too many wrong PINs in a row. To unlock, clear '
            + 'pin_hash, pin_salt, and failed_attempts, which starts PIN setup again.' }
      ],
      defaultRows: []
    },

    {
      name: 'Questions',
      purpose: 'The daily survey: always twenty rows, eight in use and twelve spare.',
      hidden: false,
      frozenRows: 1,
      appendOnly: false,
      columns: [
        { header: 'question_id', width: 100,
          note: 'Fixed forever, and also the name of the matching answer column on the EMA '
            + 'tab. Never change one.' },
        { header: 'display_text', width: 420,
          note: 'The wording the participant reads. Settle it before your study starts: once '
            + 'anyone has answered, changing the wording puts two different questions into one '
            + 'column.' },
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
        { header: 'visible', width: 90,
          note: 'YES to ask this question, NO to leave it out.' },
        { header: 'sort_order', width: 100,
          note: 'The order questions are asked in, lowest first.' }
      ],
      defaultRows: buildQuestionDefaultRows_()
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
            + 'wake that follows it share one value. Join to the EMA tab on this column.' },
        { header: 'edited', width: 80,
          note: 'YES if the participant corrected the time after first recording it.' },
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
      name: 'EMA',
      purpose: 'Daily survey responses, one row per completed survey, written by the app. The '
        + 'first four column names are spelled the way the EMA-CleanR analysis script needs.',
      hidden: false,
      frozenRows: 1,
      appendOnly: true,
      columns: [
        { header: 'participantidentifier', width: 170,
          note: 'Who answered. Spelled without underscores because EMA-CleanR requires that '
            + 'exact name. The SleepDiary tab spells the same thing participant_id.' },
        { header: 'surveyname', width: 200,
          note: 'The study ID followed by _sleep_diary, for example STUDY1_sleep_diary. '
            + 'EMA-CleanR groups rows by this column.' },
        { header: 'start_datetime', width: 200,
          note: 'When the participant opened the survey.' },
        { header: 'end_datetime', width: 200,
          note: 'When the participant submitted it.' }
      ].concat(emaAnswerColumns_(), [
        { header: 'question_set_hash', width: 150,
          note: 'A short fingerprint of the questions as they were worded when this survey was '
            + 'answered. If wording ever does change, this is how you tell the affected rows '
            + 'apart instead of mixing them together.' },
        { header: 'sleep_day', width: 110,
          note: 'Which night this survey describes. Join to the SleepDiary tab on this column. '
            + 'It is not the same as the day the survey was answered.' },
        { header: 'record_id', width: 240,
          note: 'The ID the device gave this survey, so that a resend updates this row instead '
            + 'of adding a second one.' },
        { header: 'received_utc', width: 200,
          note: 'When this row reached the workbook, in UTC.' },
        { header: 'source', width: 90,
          note: 'How the row arrived, for example web.' },
        { header: 'app_version', width: 110,
          note: 'Which version of the app sent it.' }
      ]),
      defaultRows: []
    },

    {
      name: 'Dashboard',
      purpose: 'Four charts covering the last fourteen nights, drawn from the _calc tab. Holds '
        + 'charts and no cell data.',
      hidden: false,
      frozenRows: 0,
      appendOnly: false,
      columns: [],
      defaultRows: []
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
       * Every block below starts on a known row and holds a known number of rows, so each
       * chart points at a range that is written once and never worked out again. Moving any
       * of these numbers moves a chart range, so treat the whole set as fixed.
       */
      blocks: [
        {
          name: 'criteria',
          purpose: 'Turns the Dashboard filter into values the formulas below use directly, so '
            + 'that no formula has to test whether the filter says ALL.',
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
              note: '1 if a survey was submitted for this night, 0 if not.' }
          ]
        },
        {
          name: 'weekday',
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
          purpose: 'One row per question slot, averaged over the same fourteen nights. Feeds '
            + 'the survey answer chart.',
          headerRow: 29,
          firstDataRow: 30,
          rowCount: CALC_QUESTION_ROWS,
          columns: [
            { header: 'question_id',
              note: 'EMA_01 through EMA_20, in order.' },
            { header: 'display_text',
              note: 'The wording, copied from the Questions tab for the chart labels.' },
            { header: 'visible',
              note: 'YES or NO, copied from the Questions tab. Hidden questions are not '
                + 'charted.' },
            { header: 'average_value',
              note: 'Average answer over the fourteen nights. Empty for a time question, which '
                + 'is not averaged this way.' },
            { header: 'response_count',
              note: 'How many surveys answered this question.' }
          ]
        }
      ]
    }
  ]
};

const SHEET_NAME = 'SleepDiary';
const SETUP_SHEET = 'Setup';
const APP_VERSION = '1.0.0';
const EDIT_WINDOW_DAYS = 7; // How far back in history is the user allowed to edit entries

const HEADERS = [
  'record_id', 'study_id', 'participant_id', 'event_type', 'event_epoch_ms',
  'event_iso_utc', 'event_tz', 'event_local', 'created_at_iso', 'updated_at_iso',
  'edited', 'source', 'app_version'
];

// Setup tab layout: URL to Share with Participants | Active Study ID | Active Participant IDs
const SETUP_COL_URL = 1;
const SETUP_COL_STUDY = 2;
const SETUP_COL_PARTICIPANTS = 3;
const SETUP_DATA_ROW = 2; // first row below the header
const DEFAULT_STUDY_ID = 'STUDY1';
const DEFAULT_PARTICIPANT_IDS = ['P01', 'P02', 'P03'];

function doGet(e) {
  recordWebAppUrl_(); // save the shareable link into the Sheet on first open
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

// Write the live web app URL into the Setup tab so the researcher never loses it.
// The URL is only known in web-app context, so this runs on app open, not deploy.
function recordWebAppUrl_() {
  let url;
  try { url = ScriptApp.getService().getUrl(); } catch (e) { return; }
  if (!url) return; // not running as a published web app
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // busy; a later open will record it
  try {
    const sh = ensureSetupSheet_();
    const cell = sh.getRange(SETUP_DATA_ROW, SETUP_COL_URL);
    if (cell.getValue() !== url) cell.setValue(url); // keep current
  } catch (e) {
    // non-fatal; never block the app over URL bookkeeping
  } finally {
    lock.releaseLock();
  }
}

// Auto-provision the Setup tab: the shareable URL plus the Study ID / Participant ID allowlist.
// Placed right after the README tab (if present) so sheet order is README, Setup, SleepDiary.
function ensureSetupSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SETUP_SHEET);
  if (sh) return sh;

  const readme = ss.getSheetByName('README');
  sh = ss.insertSheet(SETUP_SHEET, readme ? readme.getIndex() : 0);

  sh.getRange(1, SETUP_COL_URL).setValue('URL to Share with Participants');
  sh.getRange(1, SETUP_COL_STUDY).setValue('Active Study ID')
    .setNote('Change this to your actual Study ID. This must be given to participants during enrollment.');
  sh.getRange(1, SETUP_COL_PARTICIPANTS).setValue('Active Participant IDs')
    .setNote('Enter your participant IDs below, one per row. Only the IDs listed here will be allowed to use the app.');
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setFrozenRows(1);

  sh.getRange(SETUP_DATA_ROW, SETUP_COL_STUDY).setValue(DEFAULT_STUDY_ID);
  sh.getRange(SETUP_DATA_ROW, SETUP_COL_PARTICIPANTS, DEFAULT_PARTICIPANT_IDS.length, 1)
    .setValues(DEFAULT_PARTICIPANT_IDS.map(function (id) { return [id]; }));

  sh.setColumnWidth(SETUP_COL_URL, 460);
  sh.setColumnWidth(SETUP_COL_STUDY, 140);
  sh.setColumnWidth(SETUP_COL_PARTICIPANTS, 140);
  return sh;
}

// Case-insensitive check of studyId/participantId against the Setup tab's allowlist.
function isValidParticipant_(studyId, participantId) {
  if (!studyId || !participantId) return false;
  const sh = ensureSetupSheet_();

  const study = String(sh.getRange(SETUP_DATA_ROW, SETUP_COL_STUDY).getValue() || '').trim().toUpperCase();
  if (!study || String(studyId).trim().toUpperCase() !== study) return false;

  const lastRow = sh.getLastRow();
  if (lastRow < SETUP_DATA_ROW) return false;
  const ids = sh.getRange(SETUP_DATA_ROW, SETUP_COL_PARTICIPANTS, lastRow - SETUP_DATA_ROW + 1, 1)
    .getValues()
    .map(function (r) { return String(r[0] || '').trim().toUpperCase(); })
    .filter(function (v) { return v; });
  return ids.indexOf(String(participantId).trim().toUpperCase()) !== -1;
}

// Client-callable: check a Study ID / Participant ID before letting the login screen proceed.
// Returns a plain value rather than throwing, so "invalid" and "can't reach the server"
// stay distinguishable on the client instead of both landing in a thrown-error channel.
function validateLogin(studyId, participantId) {
  return { valid: isValidParticipant_(studyId, participantId) };
}

// Client-callable: expose settings the UI needs without hardcoding a second copy of the constant.
function getConfig() {
  return { editWindowDays: EDIT_WINDOW_DAYS, appVersion: APP_VERSION };
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Resolve the target spreadsheet. Bound script uses its own Sheet (no ID needed);
// standalone deployments fall back to a SPREADSHEET_ID script property.
function getSpreadsheet_() {
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('No spreadsheet. Bind this script to a Sheet, or set a SPREADSHEET_ID script property.');
}

// Auto-provision the data sheet and headers on first use; recreate headers if the schema drifted.
// Always created right after the Setup tab, so sheet order is README, Setup, SleepDiary.
function ensureSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    const setupSh = ensureSetupSheet_();
    sh = ss.insertSheet(SHEET_NAME, setupSh.getIndex());
  }
  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('') !== HEADERS.join('')) {
    sh.clear();
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Append one Sleep or Wake event. Returns { invalid: true } if the study/participant ID
// isn't on the Setup tab's allowlist (checked as a plain return value, not a thrown error,
// so the client can reliably tell "invalid" apart from "request failed").
function logEvent(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!payload || !isValidParticipant_(payload.study_id, payload.participant_id)) {
      return { invalid: true };
    }
    validateEvent_(payload);
    const sh = ensureSheet_();
    const nowIso = new Date().toISOString();
    const row = [
      payload.record_id,
      String(payload.study_id).trim().toUpperCase(),
      String(payload.participant_id).trim().toUpperCase(),
      payload.event_type,
      Number(payload.event_epoch_ms),
      payload.event_iso_utc,
      payload.event_tz,
      payload.event_local,
      nowIso,
      '',
      'FALSE',
      'web',
      payload.app_version || APP_VERSION
    ];
    sh.appendRow(row);
    return { invalid: false, row: rowToObj_(row) };
  } finally {
    lock.releaseLock();
  }
}

// Edit an existing Sleep/Wake event's date & time. Only entries within the edit window
// (based on their currently stored time, not the proposed new one) may be changed.
// Returns { invalid: true } (rather than throwing) if the study/participant ID isn't
// on the Setup tab's allowlist; still throws for genuinely unexpected/structural problems.
function updateEvent(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!req || !req.record_id) throw new Error('Missing record_id');
    if (!req.event_epoch_ms || isNaN(Number(req.event_epoch_ms))) throw new Error('Bad timestamp');
    if (!isValidParticipant_(req.study_id, req.participant_id)) return { invalid: true };

    const sh = ensureSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) throw new Error('Record not found');

    const studyU = String(req.study_id).trim().toUpperCase();
    const partU = String(req.participant_id).trim().toUpperCase();
    const values = sh.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      // Match on study/participant too, so no one can edit another participant's row by guessing a record_id.
      if (String(row[0]) === String(req.record_id) &&
          String(row[1]).trim().toUpperCase() === studyU &&
          String(row[2]).trim().toUpperCase() === partU) {
        assertWithinWindow_(Number(row[4])); // gate on the currently stored time
        const sheetRow = i + 2; // +1 for the header row, +1 for 1-based indexing
        sh.getRange(sheetRow, 5).setValue(Number(req.event_epoch_ms));  // event_epoch_ms
        sh.getRange(sheetRow, 6).setValue(req.event_iso_utc || '');     // event_iso_utc
        sh.getRange(sheetRow, 7).setValue(req.event_tz || row[6]);      // event_tz
        sh.getRange(sheetRow, 8).setValue(req.event_local || '');       // event_local
        sh.getRange(sheetRow, 10).setValue(new Date().toISOString());  // updated_at_iso
        sh.getRange(sheetRow, 11).setValue('TRUE');                    // edited
        const updatedRow = sh.getRange(sheetRow, 1, 1, HEADERS.length).getValues()[0];
        return { invalid: false, row: rowToObj_(updatedRow) };
      }
    }
    throw new Error('Record not found');
  } finally {
    lock.releaseLock();
  }
}

// ----- v2 stub: add a missing time within the edit window (not yet implemented) -----
function addEvent(payload) {
  throw new Error('Not implemented in v1');
}

// ----- helpers -----
function assertWithinWindow_(epochMs) {
  const ageDays = (Date.now() - Number(epochMs)) / 86400000;
  if (ageDays > EDIT_WINDOW_DAYS) {
    throw new Error('Edit window expired (older than ' + EDIT_WINDOW_DAYS + ' days)');
  }
}

function validateEvent_(p) {
  if (!p || !p.record_id) throw new Error('Missing record_id');
  if (!p.study_id || !p.participant_id) throw new Error('Missing study or participant id');
  if (p.event_type !== 'SLEEP' && p.event_type !== 'WAKE') throw new Error('Bad event_type');
  if (!p.event_epoch_ms || isNaN(Number(p.event_epoch_ms))) throw new Error('Bad timestamp');
}

function rowToObj_(row) {
  const o = {};
  for (let i = 0; i < HEADERS.length; i++) o[HEADERS[i]] = row[i];
  o.event_epoch_ms = Number(o.event_epoch_ms);
  return o;
}
