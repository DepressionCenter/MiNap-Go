<!--
This file is part of MiNap Go
docs/data-dictionary.md
Author(s): Gabriel Mongefranco
Created: 2026-08-18
Last Modified: 2026-08-18
Summary: Every tab and every column of the MiNap Go workbook, what each value means, who writes it, and how the tabs join together.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# MiNap Go

## Data Dictionary

[⬅ Back to README](../README.md)

This page lists every tab in the MiNap Go workbook and every column on it: what
the value means, who writes it, and what it may contain. It is for a researcher
reading their own data, an analyst joining the tabs together, and a maintainer
who needs to know what a column was for.

The workbook is created by the app the first time a researcher opens their
deployed web app. The layout comes from one declaration, `WORKBOOK`, at the top
of `src/server/Code.gs`. **That declaration is the authority. If this page
disagrees with it, this page is a defect.** The reasoning behind the design is in
[the architecture specification](./architecture.md); this page does not repeat
it.

---

## How to read this page

Four things are true of every tab.

- **One header row, then rows of values.** No tab is laid out as a form, and none
  mixes two shapes, so any tab can be sorted, filtered, or exported without
  knowing anything special about it.
- **Yes-or-no columns are written as `Yes` or `No`.** One spelling everywhere.
  The app also accepts `0`, `1`, `TRUE`, `FALSE`, and any casing of the words
  when it reads a cell a person typed, so `yes` never silently means no.
- **Every column ending in `_utc` is UTC.** The only local-calendar value is
  `sleep_day`. The only local clock times are `event_local` and survey answers,
  and both carry their offset.
- **Column names never change once a study exists.** A deployed copy of the app
  never updates itself, so a renamed column would leave every existing workbook
  unreadable.

"Written by the app" means do not type in it. "Written by the researcher" means
the app reads it and never overwrites it.

---

## How the tabs join

- **`SleepDiary` to `Surveys`:** join on `sleep_day`, `participant_id`, and
  `study_id`. One night has at most one survey and usually two marker rows, one
  `SLEEP` and one `WAKE`.
- **`Surveys` to `SurveyAnswers`:** join on `survey_id`. One survey has as many
  answer rows as it had questions, which is `question_count` on the survey row.
- **`SurveyAnswers` to `QuestionsSetup`:** join on `question_id`. Use
  `question_text_shown` on the answer row, not `display_text` on the setup row,
  when you need the wording a participant actually read.
- **Either data tab to `ParticipantsSetup`:** join on `study_id` and
  `participant_id` together. Never on `participant_id` alone, because two studies
  in one workbook may reuse an ID.

`sleep_day` is the night, not the day a row was written. A survey answered on
Tuesday morning about Monday night carries Monday's `sleep_day`.

---

## Setup tabs

### README

The only tab the template workbook ships with. It holds deployment instructions
written for the researcher, who may reformat it freely.

The app never creates this tab and never writes prose into it. It writes exactly
one cell and changes nothing else.

| Cell | Value | Written by |
|---|---|---|
| A10 | The live web app link to share with participants, written in bold on a pale yellow background | The app, the first time the web app is opened |

The cell is empty until then. The link is an output rather than a setting, which
is why it is not on a setup tab.

### StudySettings

Settings for the whole workbook. One header row, one row of values.

| Column | Meaning | Written by | Default |
|---|---|---|---|
| `schema_version` | Which workbook layout this is. If it does not match the app, the app stops rather than writing into a layout it does not know | App | `1` |
| `questions_locked` | `Yes` once a participant has submitted a survey. After that, changing a question's wording means two different questions share one ID | App | `No` |
| `questions_locked_at` | When the questions were locked, in UTC | App | *(empty)* |
| `edit_window_days` | How many days a participant may go back and correct a sleep or wake time. Counted from the time already stored, not the new one | Researcher | `7` |
| `backup_reminder_days` | How often the app reminds a participant to export a backup, in days | Researcher | `15` |

The participant filter is not here. It is a control rather than a setting, so it
sits on the Dashboard tab above the charts it drives.

### QuestionsSetup

The daily survey. Twenty rows: eight in use, twelve spare. Everything on this tab
is written by the researcher; the app reads it and never writes to it.

| Column | Meaning | Applies to |
|---|---|---|
| `question_id` | `Q01` through `Q20`. Fixed forever | All |
| `display_text` | The wording the participant reads | All |
| `answer_type` | One of `time`, `datetime`, `duration_minutes`, `count`, `ordinal`, `scale`, `boolean` | All |
| `min_value` | Lowest value allowed | `scale`, `ordinal`, `count`, `duration_minutes` |
| `max_value` | Highest value allowed | Same |
| `input_style` | `slider`, `buttons`, or `stepper`. Empty for a time question, which uses the device's own picker | Same |
| `min_label` | What the low end means, for example "Very poor" | `scale`, `ordinal` |
| `max_label` | What the high end means | Same |
| `unit` | The unit the answer is stored in, for anyone reading raw data | `count`, `duration_minutes` |
| `prefill_from` | `SLEEP_MARKER` or `WAKE_MARKER`, or empty. The answer opens filled in from a marker the participant already tapped; they may change it, and the marker itself is never changed | `time` |
| `required` | `Yes` or `No`. A required question must be answered before the survey can be submitted, and cannot be hidden | All |
| `visible` | `Yes` to ask this question, `No` to leave it out | All |
| `sort_order` | The order questions are asked in, lowest first | All |

Twenty rows is a limit on how many questions can be **charted**, not a limit
imposed by the storage. Answers are rows on SurveyAnswers rather than columns, so
adding a question changes no tab's shape. The `_calc` tab holds one chart row per
question slot, and a chart range has to be a constant, which is where twenty
comes from.

#### Answer types

| `answer_type` | Stored as | Example |
|---|---|---|
| `time` | Local date and time, ISO 8601 with the offset. The participant picks a clock time; the date follows from the night | `2026-08-16T23:30-04:00` |
| `datetime` | The same format, but the participant picks the date too | `2026-08-14T15:00-04:00` |
| `duration_minutes` | Whole minutes | `55` |
| `count` | Whole number | `3` |
| `ordinal` | Whole number from 1 up, with fixed labels | `2`, meaning "Poor" |
| `scale` | Whole number between `min_value` and `max_value` | `7` |
| `boolean` | `Yes` or `No` | `Yes` |

A `time` answer carries a date as well as a clock time because a bedtime after
midnight belongs to the previous night, and a bare `23:30` cannot say which night
it means. The offset makes daylight saving time and travel unambiguous. Both
Google Sheets and Excel parse this format, so two cells can be subtracted to get
a duration.

`datetime` exists for a question that could fall on any day. Nothing in version 1
uses it.

**There is no free-text answer type, and there never will be.** Open text invites
a participant to type names, appointments, places, or diagnoses, and all of it
would land in the researcher's workbook as identifiable health information.
Participants who want to write things down use the private notes feature, which
never leaves their device. This holds for researcher-written and
participant-written questions alike.

#### The default questions

Version 1 ships the Consensus Sleep Diary, Core version (Carney et al., 2012).
Question numbers match the instrument's own item numbers, so `Q03` is item 3, and
the workbook can be read without a codebook. That numbering is permanent.

| ID | Question | `answer_type` | Range | Prefilled from |
|---|---|---|---|---|
| `Q01` | What time did you get into bed? | `time` | | |
| `Q02` | What time did you try to go to sleep? | `time` | | SLEEP marker |
| `Q03` | How long did it take you to fall asleep? | `duration_minutes` | 0–600 | |
| `Q04` | How many times did you wake up, not counting your final awakening? | `count` | 0–10 | |
| `Q05` | In total, how long did these awakenings last? | `duration_minutes` | 0–600 | |
| `Q06` | What time was your final awakening? | `time` | | WAKE marker |
| `Q07` | What time did you get out of bed for the day? | `time` | | |
| `Q08` | How would you rate the quality of your sleep? | `ordinal` | 1–5 | |

`Q09` through `Q20` ship empty, with `visible` set to `No`, and are available to
the researcher. All eight defaults ship with `required` set to `No`: a
participant who cannot remember an answer should be able to submit the rest of
the night rather than guess.

Zero is a real answer to `Q04`, and an empty cell is not the same thing: zero
means an unbroken night, empty means nobody answered. The top of the range is a
clinical judgement rather than a true ceiling, so the app offers `10` as "10 or
more".

The wording is provisional until permission to redistribute it is confirmed with
the instrument's authors. The IDs, types, ranges, and prefill sources are final.

**Credit.** Carney CE, Buysse DJ, Ancoli-Israel S, Edinger JD, Krystal AD,
Lichstein KL, Morin CM. The Consensus Sleep Diary: Standardizing Prospective
Sleep Self-Monitoring. *Sleep.* 2012;35(2):287–302. DOI 10.5665/sleep.1642.

### ParticipantsSetup

Who may log in. One row per participant per study.

| Column | Meaning | Written by |
|---|---|---|
| `study_id` | Your study ID, given to participants at enrollment | Researcher |
| `participant_id` | A randomly assigned ID. Never a name, initials, a date of birth, or a medical record number | Researcher |
| `enabled` | `Yes` to let this person log in, `No` to end their access while keeping their data. A blank cell does not grant access | Researcher |
| `pin_hash` | Written when the participant first sets a PIN | App |
| `pin_salt` | A random value for this participant alone | App |
| `pin_set_at` | When the PIN was set, in UTC | App |
| `failed_attempts` | How many wrong PINs in a row. Back to zero after a correct one | App |
| `locked` | `Yes` once there have been too many wrong PINs in a row | App |

Several studies can share one workbook, because login checks the study and the
participant together. An ID leaked from one study will not work in another.

**To reset a forgotten or locked PIN,** clear `pin_hash`, `pin_salt`, and
`failed_attempts`. The participant is asked to choose a new PIN at the next
login. Their local copy of their own history becomes unreadable, because the old
PIN unwrapped its encryption key. The workbook keeps every row, so nothing is
lost to the study.

---

## Data tabs

All three are append-only and written entirely by the app.

### SleepDiary

One row per marker.

| Column | Meaning |
|---|---|
| `record_id` | The ID the device gave this marker. The app resends anything it is unsure arrived, and this is what stops a resend becoming a second row |
| `study_id` | The study this marker belongs to |
| `participant_id` | Who recorded it |
| `marker` | `SLEEP` or `WAKE` |
| `event_local` | What the clock said where the participant was, with the offset, for example `2026-08-16T23:30-04:00` |
| `event_tz` | Which time zone that clock was in, for example `America/Detroit` |
| `event_utc` | The same moment in UTC. The one reading that is never ambiguous |
| `sleep_day` | Which night this marker belongs to. Filled in by the server. Join to Surveys on this column |
| `edited` | `Yes` if the participant corrected the time after first recording it |
| `modified_utc` | When they last changed it, in UTC. Empty if never changed |
| `received_utc` | When this row reached the workbook, in UTC |
| `source` | How the row arrived, for example `web` |
| `app_version` | Which version of the app sent it |

**`SLEEP` means "I am trying to go to sleep now." `WAKE` means "I woke up for the
last time."** Getting out of bed is a separate, later moment, asked as `Q07`. If
participants tap `WAKE` when they get up instead, `Q06` and `Q07` collapse into
one and sleep efficiency is wrong for the whole study.

**Three time columns, on purpose.** What the clock said, where that clock was,
and the instant it names. That is the smallest set that survives daylight saving
time and travel.

**`received_utc` is later than `event_utc`** whenever an entry was recorded with
no signal and sent once the app was online again. That difference is how a
data-quality check tells an entry logged in the moment from one that synced days
later.

**A marker and a survey answer may disagree, and that is intended.** `Q02` and
`Q06` open prefilled from the markers, and the participant may change them. The
marker records when a button was pressed; the answer records what the participant
says happened. Neither ever overwrites the other.

### Surveys

One row per survey **shown**, whether or not anything was answered.

| Column | Meaning |
|---|---|
| `survey_id` | Generated on the device when the survey opens. The join key for SurveyAnswers |
| `study_id` | The study this survey belongs to |
| `participant_id` | Who answered |
| `sleep_day` | Which night this survey describes. Join to SleepDiary on this column. Not the same as the day it was answered |
| `sleep_record_id` | The SLEEP marker for that night, if there was one |
| `wake_record_id` | The WAKE marker that opened the survey |
| `wake_marker_utc` | When WAKE was tapped |
| `survey_opened_utc` | When the first question appeared |
| `survey_ended_utc` | When the participant submitted or skipped. Empty if the survey was abandoned |
| `survey_duration_ms` | Ended minus opened, in milliseconds |
| `end_reason` | `submitted`, `skipped`, or `abandoned` |
| `question_count` | How many questions were shown. This is how many SurveyAnswers rows to expect |
| `answered_count` | How many were answered |
| `skipped_count` | `question_count` minus `answered_count` |
| `edit_count_total` | How many answers were changed before submitting |
| `question_set_hash` | A short fingerprint of the questions as worded when this survey was answered |
| `event_tz` | The participant's time zone at the time |
| `tz_offset_minutes` | The offset from UTC in force at `survey_opened_utc` |
| `record_id` | The same value as `survey_id`, so a resend updates this row instead of adding a second one |
| `received_utc` | When this row reached the workbook, in UTC |
| `source` | How the row arrived, for example `web` |
| `app_version` | Which version of the app sent it |

**`end_reason` is the difference between three things that otherwise look the
same.**

| Value | What happened |
|---|---|
| `submitted` | The participant finished and submitted |
| `skipped` | The survey was shown and declined. A real finding about engagement, not missing data |
| `abandoned` | The app closed part way through. `survey_ended_utc` is empty |

**No survey row at all** means no survey was shown. In the standalone build that
happens when the person has hidden every question: an empty survey is not
offered, not shown, and not recorded.

**`tz_offset_minutes` as well as `event_tz`.** Daylight saving edges and later
revisions to the time zone database both reinterpret history. The stored offset
pins what the offset actually was that night.

### SurveyAnswers

One row per question **shown**, per survey.

| Column | Meaning |
|---|---|
| `record_id` | The ID the device gave this answer |
| `survey_id` | Join to Surveys |
| `study_id` | Repeated here so this tab can be filtered on its own |
| `participant_id` | Repeated for the same reason |
| `question_id` | `Q01` through `Q20` |
| `question_source` | `default`, `researcher`, or `participant` |
| `answer_type` | The type as it was shown |
| `question_text_shown` | The wording the participant read, copied in at the time |
| `required` | Whether the question was required when it was shown |
| `display_order` | Where the question appeared in the survey |
| `answer_order` | The order it was actually answered in. Empty if unanswered |
| `value` | The answer as a person reads it |
| `value_number` | The same answer as a single number, for analysis |
| `value_unit` | `hh:mm`, `minutes`, `points`, the question's own unit, or empty |
| `answered_utc` | When the answer was first given. **Empty means the question was shown and not answered** |
| `edited_utc` | When it was last changed before submitting. Empty if never changed |
| `edit_count` | How many times it was changed |
| `time_to_answer_ms` | From the question appearing to the first answer, in milliseconds |
| `received_utc` | When this row reached the workbook, in UTC |
| `source` | How the row arrived, for example `web` |
| `app_version` | Which version of the app sent it |

**Every question shown gets a row.** An unanswered question is a row with an
empty `value` and an empty `answered_utc`. A question nobody was asked has no row
at all. Those are different facts, and only this layout can hold both.

#### `value` and `value_number`

Two columns because two people need different things. A researcher reading the
tab wants `23:30` and `Yes`. An analyst wants one numeric column that behaves the
same way for every question type.

| `answer_type` | `value` | `value_number` | `value_unit` |
|---|---|---|---|
| `time` | `2026-08-16T23:30-04:00` | Minutes from local midnight | `hh:mm` |
| `datetime` | `2026-08-14T15:00-04:00` | Minutes from local midnight | `hh:mm` |
| `duration_minutes` | `55` | `55` | `minutes` |
| `count` | `3` | `3` | The question's `unit` |
| `ordinal` | `2` | `2` | `points` |
| `scale` | `7` | `7` | `points` |
| `boolean` | `Yes` | `1` | *(empty)* |

**Averaging a clock time needs care.** Clock time runs on a circle: midnight sits
next to 23:59, not twelve hours away, so an ordinary average of 23:50 and 00:10
lands at midday. Convert to minutes from an anchor first, noon for bedtimes and
midnight for wake times, then convert back. The `_calc` tab does this, and
anything reading `value_number` directly should do the same.

#### Why the wording is stored on every row

A researcher editing a question's wording after a study starts is the most likely
way this workbook can be quietly corrupted: two different questions end up
sharing one ID, and nothing in the data says so. Three things guard against it.
`questions_locked` warns that it has happened. `question_set_hash` says which
surveys are affected. `question_text_shown` says what each participant actually
read. It costs a repeated string per answer, and it removes the worst failure the
workbook can have.

---

## Presentation tabs

### Dashboard

Four charts covering the last fourteen nights, and the filter that decides whose
nights they show. No tables and no working data.

| Cell | Contents |
|---|---|
| A1 | The label `Show data for:` |
| B1 | The filter. Type `ALL` to chart everyone, or one Participant ID to chart one person |
| Row 3 down | The charts |

### \_calc

Hidden. The working tables behind the charts, worked out from the other tabs.
Nothing here is stored data, and nothing here is meant to be read directly.

Each table starts on a fixed row, holds a fixed number of rows, and carries a
named range, so a chart points at a range that is written once. Moving any of
these numbers moves a chart range.

| Table | Named range | Header row | Rows | What it holds |
|---|---|---|---|---|
| criteria | `calcCriteria` | 1 | 1 | The Dashboard filter turned into values the tables below use directly |
| daily | `calcDaily` | 4 | 14 | One row per night, oldest first |
| weekday | `calcWeekday` | 20 | 7 | One row per day of the week, averaged over the same nights |
| questions | `calcQuestions` | 29 | 20 | One row per question slot, averaged over the same nights |

#### criteria

| Column | Meaning |
|---|---|
| `participant_criterion` | The Dashboard filter, or a match-anything wildcard when it says `ALL` |
| `window_start_sleep_day` | The first night the charts cover: thirteen days before the last |
| `window_end_sleep_day` | The last night the charts cover |

#### daily

| Column | Meaning |
|---|---|
| `sleep_day` | The night this row describes |
| `total_sleep_minutes` | Final awakening minus the time sleep was attempted, less time to fall asleep and time awake during the night |
| `time_in_bed_minutes` | Getting out of bed minus getting into bed |
| `sleep_onset_latency_minutes` | How long it took to fall asleep |
| `wake_after_sleep_onset_minutes` | How long the awakenings lasted altogether |
| `sleep_efficiency_percent` | Time asleep as a percentage of time in bed |
| `has_sleep_data` | `1` if a marker exists for this night, `0` if not |
| `has_survey_data` | `1` if a survey was submitted for this night, `0` if not |

#### weekday

| Column | Meaning |
|---|---|
| `day_of_week` | Sunday through Saturday |
| `avg_sleep_minutes_from_noon` | Average bedtime, as minutes after noon |
| `earliest_sleep_minutes_from_noon` | Earliest bedtime, same units |
| `latest_sleep_minutes_from_noon` | Latest bedtime, same units |
| `avg_wake_minutes_from_midnight` | Average wake time, as minutes after midnight |
| `earliest_wake_minutes_from_midnight` | Earliest wake time, same units |
| `latest_wake_minutes_from_midnight` | Latest wake time, same units |
| `avg_sleep_clock` | Average bedtime as a clock time, for the chart label |
| `avg_wake_clock` | Average wake time as a clock time, for the chart label |

#### questions

Built from `SurveyAnswers` with `AVERAGEIFS` and `COUNTIFS` over `question_id`.

| Column | Meaning |
|---|---|
| `question_id` | `Q01` through `Q20`, in order |
| `display_text` | The wording, copied from QuestionsSetup for the chart labels |
| `visible` | `Yes` or `No`, copied from QuestionsSetup. Hidden questions are not charted |
| `average_value` | Average of `value_number` over the fourteen nights. Empty for a time question, which is not averaged this way |
| `response_count` | How many surveys answered this question |

---

## Sleep day

`sleep_day` names the night, and it is the join key between SleepDiary and
Surveys. It is worked out from the local time sleep started:

```
if local_time_of(sleep_onset) >= 12:00:
    sleep_day = local_date_of(sleep_onset)
else:
    sleep_day = local_date_of(sleep_onset) - 1 day
```

So a bedtime of 01:30 on Tuesday belongs to Monday night, and Tuesday morning's
wake time carries the same value.

**This is the same rule the Depression Center's Sleep Data Automation uses**, so
numbers from the two tools line up without anyone reconciling them. Two things
about it matter:

- **It reads local time, never UTC.** Someone in Detroit going to bed at 23:00 is
  already at 03:00 UTC the next day, and a UTC reading would file the night under
  the wrong date.
- **It is anchored on sleep onset**, not on the wake time and not on when the
  survey was filled in. A WAKE marker copies its `sleep_day` from the SLEEP
  before it rather than working one out for itself.

---

## Derived measures

Worked out in `_calc` and in the app, never stored, so a change to a formula
cannot leave old rows behind.

| Measure | How it is worked out |
|---|---|
| Time in bed | `Q07` − `Q01` |
| Sleep onset latency | `Q03` |
| Wake after sleep onset | `Q05` |
| Total sleep time | (`Q06` − `Q02`) − `Q03` − `Q05` |
| Sleep efficiency | Total sleep time ÷ time in bed, as a percentage |

Sleep efficiency is the usual primary outcome in insomnia research, and it needs
`Q01` and `Q07`. That is why the diary asks about getting into and out of bed
even though the markers already record sleep and wake times.

---

## What is deliberately absent

Naming what a workbook does not collect is part of describing what it does.

- **No free text, anywhere in the survey**, in either build.
- **No medication question.** Medication is health information and would arrive
  as written text.
- **No names, dates of birth, or medical record numbers.** `participant_id` is a
  randomly assigned code, and the file linking codes to people belongs in an
  approved system, never in this workbook.
- **No read path.** No server function returns diary or survey data to a browser.
  History on a participant's device comes from that device's own storage.

---

## Conclusion

You can now read any tab in the workbook, join the tabs together correctly, and
tell which columns you may edit from those the app owns. If you are about to
start a study, settle the question wording first: `questions_locked` turns on at
the first submission, and a deployed copy of the app never updates.

For why the workbook is shaped this way, read the architecture specification. For
the order things get built in, read the implementation plan.

## Additional resources

- [MiNap Go architecture and version 1 specification](./architecture.md)
- [MiNap Go version 1 implementation plan](./implementation-plan.md)
- [MiNap Go technical overview](./overview.md)
- [Sleep Data Automation repository](https://github.com/DepressionCenter/SleepDataAutomation)
  — the source of the sleep day rule
- [The Consensus Sleep Diary: Standardizing Prospective Sleep Self-Monitoring](https://doi.org/10.5665/sleep.1642)
  — the source of the default questions
- [MiNap Go repository](https://github.com/DepressionCenter/MiNap-Go)

[⬅ Back to README](../README.md)

----
Copyright © 2026 The Regents of the University of Michigan
