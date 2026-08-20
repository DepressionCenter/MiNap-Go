<!--
This file is part of MiNap Go
docs/architecture.md
Author(s): Gabriel Mongefranco
Created: 2026-08-17
Last Modified: 2026-08-19
Summary: Version 1 architecture specification for MiNap Go: the two build targets, the Google Sheet schema, participant login and device sessions, dashboards, and the decisions behind them.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan
Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# MiNap Go

## Architecture and Version 1 Specification

[⬅ Back to README](../README.md)

MiNap Go is a browser-based sleep diary. Participants log when they fall asleep
and when they wake, and answer a short daily survey. This page describes how the
system is put together, what data it stores, and why the main design choices were
made. It is written for a maintainer, researcher, or auditor who has never seen
the project before.

Version 1 is partly built. The build structure, the workbook layout, and the
server functions exist; the participant-facing screens are being written now.
Anything already working in the repository is marked as such; everything else is
a specification.

---

## 1. Two builds, one codebase

MiNap Go ships as two separate applications built from the same core code. They
never talk to each other, and neither can turn into the other.

| | Study build | Standalone build |
|---|---|---|
| Who deploys it | Researcher or clinician, in their own Google account | The Mobile Technologies Core, once |
| Where it runs | Google Apps Script web app | `code.depressioncenter.org` |
| Where data rests | The deployer's Google Sheet | The participant's device only |
| Login | Study ID, Participant ID, PIN | None |
| Sends data to a server | Yes | Never |
| Installable app, works offline | No | Yes |
| CSV export and import | Yes | Yes |
| Share a report with a clinician | No | Yes |
| PDF export | No | Yes |

### Why two builds instead of one app with a switch

An earlier design had a single application that changed behavior based on a URL
parameter. It was dropped. A switch raises questions that a split does not have
to answer: what happens to a person's saved entries when they follow a study
link, what happens if they join a second study, and which set of data a backup
belongs to. Splitting the builds removes those questions instead of solving them.

The split is enforced at build time. The standalone build does not contain the
code that sends data to a server. It is not disabled; it is absent. A reviewer
can confirm this by searching the built files.

### Why the study build stays on Apps Script

A study is one self-contained item under the researcher's own Google account. If
`code.depressioncenter.org` went offline tomorrow, every running study would keep
working. This is the property that makes the tool easy to describe to an IRB, and
it is worth the cost described below.

### What the study build gives up

Google Apps Script serves the app inside a sandboxed frame on a different domain.
That has three consequences:

- No service worker, so no offline app and no install to the home screen.
- Browser storage counts as third-party storage. Safari can delete it after about
  seven days of not using the app.
- The app must be online to save an entry. A short queue covers a dropped
  connection while the app is open, not a night with no signal.

Participants in a study therefore have a reliable record in the Sheet and an
unreliable copy on their phone. Participant-facing text must say so plainly.

---

## 2. Site layout

```
index.html        Landing page: what the app is, install button, researcher section
app/              Standalone build (app shell, service worker, manifest)
demo/             The existing study-build demo page
```

**Every path in the site is relative.** The site is not served from a domain root;
it lives under a prefix, as in `code.depressioncenter.org/MiNap-Go/`. A link, a
script tag, or a manifest entry written as `/app/` would break the moment the
prefix changed, and would already be wrong today.

The current `index.html` at the repository root is the study-build demo. It moves
to `demo/` unchanged. The new root page describes the project, sends members of
the public to `app/`, and sends researchers to `demo/` and the setup guide.

Only the standalone build has a service worker. Section 1 already rules one out
for the study build, which runs inside an Apps Script frame.

`app/sw.js` registers with no explicit scope, so the browser caps it at the
directory it is served from. A service worker cannot claim a broader scope than
its own directory unless the server sends a `Service-Worker-Allowed` header, which
this site never does. That keeps it away from the landing page and the demo under
any hosting prefix, with no path to keep in sync.

The same applies to `manifest.json`. Its `start_url`, `scope`, and icon paths must
be relative, for the same reason and with a worse failure: a manifest scope that
does not cover the page it is linked from makes the app silently uninstallable,
with no error a developer would notice.

**Before this ships:** the demo page embeds a live web app URL and a live
spreadsheet ID. Confirm that spreadsheet contains only made-up data, because the
new landing page will send more people to it.

---

## 3. The Google Sheet

One Sheet per deployment. It may hold more than one study.

The layout below is not written into the body of the provisioning code. It is a
declaration the server walks; see section 3.8.

This section says **why** each tab and column exists. [The data
dictionary](./data-dictionary.md) says **what** every column holds, written for a
researcher reading their own data. The declaration in `src/server/Code.gs` is the
authority; either page disagreeing with it is a defect.

### 3.1 Tabs

| Tab | What it holds | Who writes it |
|---|---|---|
| README | How to deploy, where to go next, and the link to share with participants | The only tab the template Sheet ships with. The app writes the link into one cell and changes nothing else |
| StudySettings | Schema version, the edit window, the backup reminder, the question lock | The app writes the version and the lock; the researcher fills the rest |
| ParticipantsSetup | The list of who may log in, and their PIN records | Researcher adds rows; the app writes PIN fields |
| QuestionsSetup | The daily survey | Researcher |
| SleepDiary | Sleep and wake markers | The app |
| Surveys | One row per survey shown, whether it was answered or not | The app |
| SurveyAnswers | One row per question shown, per survey | The app |
| Dashboard | Four charts, and the filter that decides whose nights they show | Created by the app; driven by formulas |
| \_calc | Hidden helper tables for the charts | Created by the app |

Only README exists before deployment. Everything else appears the first time the
researcher opens their web app. See section 3.8.

The README tab in the template needs rewriting for version 1: the current text
describes a Setup tab with three columns and no PIN step, which stops being true.

Every tab is a plain table: one header row, then rows of values. No tab is laid out
as a form, and none mixes two shapes, so any tab can be read, sorted, filtered, or
exported without knowing anything special about it.

The link to the deployed web app is the one exception to "the app never touches the
README tab". It is an output, not a setting, so it does not belong on a tab the
researcher fills in. It goes in cell `A10` of the README, written in bold on a pale yellow
ground so a researcher can find it again, and the app writes nothing else there:
the rest of that tab is written by hand in the template. A workbook with
no README tab, which is what a developer building from scratch has, simply gets no
link written.

### 3.2 StudySettings

One header row, one row of values.

| Field | Notes |
|---|---|
| `schema_version` | Set by the app. Lets a future version detect an old Sheet and refuse to write to it |
| `questions_locked` | Set to `Yes` automatically on the first survey submission |
| `questions_locked_at` | Timestamp of the above |
| `edit_window_days` | Defaults to 7 |
| `backup_reminder_days` | Defaults to 15 |

The participant filter is not here. It is a control rather than a setting: it changes
what you are looking at right now, so it lives on the Dashboard tab, above the charts
it drives. See section 11.

### 3.3 ParticipantsSetup

One row per participant per study.

| Column | Notes |
|---|---|
| `study_id` | Researcher-set |
| `participant_id` | Randomly assigned, never a name or a medical record number |
| `enabled` | `Yes` or `No`. Set to `No` to revoke access without deleting data |
| `pin_hash` | Written by the app when the participant first sets a PIN |
| `pin_salt` | Random, one per participant |
| `pin_set_at` | Timestamp |
| `failed_attempts` | Counter, reset on a correct PIN |
| `locked` | `Yes` after too many failures |
| `device_token_hash` | Identifies the one device this participant is signed in on. Clear it to sign that device out |
| `device_token_set_at` | When that device signed in |
| `device_last_seen_utc` | The last day that device sent anything |

Multiple studies live in one Sheet by putting different values in `study_id`. A
Participant ID leaked from one study cannot be used in another, because login
checks the pair.

Provisioning adds a "Generate Participant ID" button to this tab: an image the
researcher clicks to fill the next open row with a random ID and set `enabled` to
`Yes`, rather than typing one by hand. The letters it draws from skip characters
easy to misread on paper or a screen (`I`/`1`/`L`, `O`/`0`, and look-alike pairs
such as `B`/`8`), because a participant retypes this ID at every login. The
function behind the button only acts when triggered from inside the Sheet itself;
it refuses if reached any other way, since it writes to the column that authorizes
login.

The two things a researcher can clear here are not the same thing, and section
5.5 spells out the difference. Clearing the PIN cells starts PIN setup again and
makes the copy of the diary on the participant's own device unreadable. Clearing
`device_token_hash` only signs that device out: the participant enters their PIN
and everything on the device is still there.

### 3.4 QuestionsSetup

Twenty rows, always present. The first eight hold the Consensus Sleep Diary Core
items that MiNap Go asks; the rest are spare. The instrument has nine items, and the
ninth, a free-text comments box, is deliberately not asked. See section 3.4.1.

| Column | Notes |
|---|---|
| `question_id` | `Q01` through `Q20`. Fixed forever |
| `display_text` | The wording the participant sees |
| `answer_type` | See the table below |
| `min_value`, `max_value` | For `scale`, `ordinal`, `count`, and `duration_minutes` |
| `input_style` | `slider`, `buttons`, or `stepper`. See section 3.4.3 |
| `min_label`, `max_label` | End labels, for example "Not at all" and "Extremely" |
| `unit` | Stored unit, shown to anyone reading the raw data |
| `prefill_from` | `SLEEP_MARKER`, `WAKE_MARKER`, or empty |
| `required` | `Yes` or `No`. Defaults to `No`. A required question cannot be hidden and must be answered before the survey can be submitted |
| `visible` | `Yes` or `No` |
| `sort_order` | Display order |

Answer types:

| `answer_type` | Stored as | Example |
|---|---|---|
| `time` | Local date and time, ISO 8601 with offset. The participant picks a clock time; the date comes from the night. See section 4.1 | `2026-08-16T23:30-04:00` |
| `datetime` | The same format, but the participant picks the date as well | `2026-08-14T15:00-04:00` |
| `duration_minutes` | Whole minutes | `55` |
| `count` | Whole number | `3` |
| `ordinal` | Whole number, 1 upward, with fixed labels | `2` for "Poor" |
| `scale` | Whole number between min and max | `7` |
| `boolean` | `Yes` or `No`, per section 3.10 | `Yes` |

**There is no free-text answer type, and there never will be.** Open text invites
a participant to type names, appointments, places, or diagnoses, and all of it
would land in the researcher's workbook as identifiable health information.
Leaving the type out removes the risk rather than managing it. Participants who
want to write things down use the private notes feature in section 6, which never
leaves the device. This holds in both builds, for researcher-written and
participant-written questions alike.

`time` and `datetime` differ only in what the participant is asked to choose.
Every question in the default set is `time`, because a sleep diary asks about
moments inside one night and the date follows from the night. `datetime` exists
for a question that can fall on any day, and nothing in version 1 uses it yet.

### 3.4.1 The default question set

Version 1 ships the Consensus Sleep Diary, Core version (Carney et al., 2012),
which is the standard daily sleep diary used in insomnia research. Using it means
results can be compared with other studies instead of being trapped in this tool.

Question numbers match the instrument's own item numbers, so `Q03` is item 3.
Keep it that way permanently; it makes the Sheet readable without a codebook.

| ID | Item | `answer_type` | Prefilled |
|---|---|---|---|
| `Q01` | What time did you get into bed? | `time` | No |
| `Q02` | What time did you try to go to sleep? | `time` | From the SLEEP marker |
| `Q03` | How long did it take you to fall asleep? | `duration_minutes` | No |
| `Q04` | How many times did you wake up, not counting your final awakening? | `count`, 0–10 | No |
| `Q05` | In total, how long did these awakenings last? | `duration_minutes` | No |
| `Q06` | What time was your final awakening? | `time` | From the WAKE marker |
| `Q07` | What time did you get out of bed for the day? | `time` | No |
| `Q08` | How would you rate the quality of your sleep? | `ordinal`, 1–5, Very poor to Very good | No |

`Q09` through `Q20` are empty and available to the researcher. All eight default
questions ship with `required` set to `No`: a participant who cannot remember an
answer should be able to submit the rest of the night rather than guess. A
researcher who needs an item answered sets `required` themselves.

Zero is a valid answer to `Q04`, and it has to be: a night with no awakenings is
both common and clinically meaningful, and it is what distinguishes an unbroken night
from a night nobody answered for. The top of the range is a clinical judgement rather
than a true ceiling. Past about ten awakenings, what matters is that the night was
badly broken, not the exact count, so the app offers the top value as "10 or more".

**Why `Q` and not `EMA_`.** Earlier drafts named these `EMA_01` onward, because
the survey tab was laid out as one wide row per survey and the EMA-CleanR analysis
script picks answer columns up by an `EMA_` prefix. Answers are now rows rather
than columns (section 3.6), so the prefix no longer does anything and only reads
as jargon to a researcher. Anything that needs the old shape gets it from a
converter, not from the stored layout.

**Two items from the published instrument are deliberately left out.**

- The free-text comments box. Participants type identifying details into open
  fields — names, appointments, places, diagnoses — and every one of those would
  be transmitted to and recorded in the researcher's Sheet. Leaving it out removes
  the risk rather than managing it. Participants who want to write things down have
  the private notes feature in section 6, which never leaves the device.
- The medication question from the expanded versions, for the same reason: it asks
  for a written list, and medication is health information.

**Credit the instrument wherever the questions appear.** Carney CE, Buysse DJ,
Ancoli-Israel S, Edinger JD, Krystal AD, Lichstein KL, Morin CM. The Consensus Sleep
Diary: Standardizing Prospective Sleep Self-Monitoring. *Sleep.* 2012;35(2):287–302.
DOI 10.5665/sleep.1642. Copyright © 2012 Associated Professional Sleep Societies,
LLC. The project README carries the same credit, along with the reason the free-text
item is omitted.

### 3.4.2 Prefilled answers, and why both copies are kept

The SLEEP and WAKE markers are the same moments as items 2 and 6, but recorded
when they happened rather than remembered the next morning. So the diary opens
with those two answers already filled in from the taps.

The participant can change them. If they do, the diary answer and the marker will
disagree, and **that is intended**. The marker records when the button was
pressed; the diary records what the participant says happened. Keep both. Never
overwrite a marker from a diary answer, and never overwrite a diary answer from a
marker after the participant has seen it.

Because of this, the button labels have to be exact. **SLEEP means "I am trying
to go to sleep now," and WAKE means "I woke up for the last time."** Getting out
of bed is a separate, later moment, asked as `Q07`. If participants tap WAKE when
they get up instead, `Q06` and `Q07` collapse into one and sleep efficiency is
wrong for the whole study. Say this in the participant instructions, not only on
the buttons.

**Nothing here may change after a study starts.** Deployed copies of the app
cannot be updated, so changing a question's wording mid-study produces two
different questions sharing one column, and no way to tell the rows apart later.

Two safeguards, since the researcher can always edit a cell:

- `questions_locked` turns on at the first survey submission. The app shows a
  clear warning if the QuestionsSetup tab is edited afterwards.
- Every Surveys row stores a `question_set_hash`: a short fingerprint of the
  visible question IDs and their wording. If wording does change, the affected
  surveys are identifiable during analysis instead of silently mixed together.
- Every SurveyAnswers row stores the wording as it was shown, in
  `question_text_shown`. The hash says that something changed; this says what the
  participant actually read.

### 3.4.3 Sliders and other rating inputs

A `scale` question with `min_value` 1 and `max_value` 10 is the common case and
must be supported. The researcher chooses how it is shown:

| `input_style` | Use it for |
|---|---|
| `slider` | Rating scales, typically 1–10 |
| `buttons` | Short scales where every option is worth showing, such as the 1–5 quality rating |
| `stepper` | Counts and durations |

Sliders are easy to get wrong. Four rules:

- **Build on the browser's own range control.** It works with a keyboard, arrow
  keys move it, and screen readers already announce it. A hand-built one has to
  reimplement all of that and usually does not.
- **Never require dragging.** Tapping anywhere on the track must set the value,
  and a minus and plus button on either end must step it. Dragging is unusable for
  someone with a tremor or limited hand movement, and requiring it fails the
  accessibility target in section 9.
- **Show the number, and label both ends.** A slider with no printed value is a
  guess. `min_label` and `max_label` say what high and low mean.
- **An untouched slider is not an answer.** Show no thumb and no number until the
  participant interacts, so a default position is never recorded as a response.
  This is the most common way rating data gets quietly ruined.

Touch targets stay at least 44 by 44 pixels, per section 9.

### 3.4.4 The standalone build: the person chooses

Everything above describes the study build, where the researcher fixes the
question set because a study needs every participant answering the same things.

The standalone build has no researcher, so the person decides.

- **Turn questions on and off.** The same Consensus Sleep Diary questions ship as
  the default set, but any of them can be hidden. Someone tracking only bedtime
  and sleep quality should not have to skip six questions every morning.
- **Change the selection at any time.** Turning a question off does not delete the
  answers already given; the charts simply stop after the last one. Turning it
  back on resumes.
- **Add up to five questions of their own.** Each is either a yes-or-no toggle or
  a 1-to-10 slider. They get IDs `Q16` through `Q20`, taken from the spare range,
  so a person's own questions never collide with the standard set and an exported
  file has the same shape in both builds.

The wording of a personal question is stored on the device and nowhere else. It
travels in an export or a backup, and it is embedded in a shared report so the
clinician reads the actual question rather than `Q17`. It is never sent to a
server, because in this build there is no server.

Nothing here exists in the study build. A study participant cannot hide a
required question or invent a new one.

### 3.5 SleepDiary

One row per marker.

| Column | Notes |
|---|---|
| `record_id` | Unique ID generated on the device |
| `study_id`, `participant_id` | |
| `marker` | `SLEEP` or `WAKE` |
| `event_local` | ISO 8601 local time with offset, for example `2026-08-16T23:30-04:00` |
| `event_tz` | IANA zone name, for example `America/Detroit` |
| `event_utc` | ISO 8601 in UTC. The one unambiguous instant |
| `sleep_day` | The night this marker belongs to. See section 3.5.1 |
| `edited` | `Yes` or `No` |
| `modified_utc` | When the participant last changed the time. Empty if never edited |
| `received_utc` | When the server accepted the row |
| `source` | How it arrived, for example `web` |
| `app_version` | |

Three time fields is the smallest set that survives daylight saving time and
travel: what the clock said, where that clock was, and the instant it names.

**On `received_utc`.** The old `created_at_iso` was confusing because for most
rows it duplicated the event time. It is worth keeping under a clearer name,
because the two are not the same whenever an entry was queued offline: the event
happened at 23:30 and reached the Sheet at 07:15 the next morning. Without it,
there is no way to tell an entry logged in the moment from one that synced days
later, which is exactly the distinction a data-quality check needs. If you would
rather not keep it, drop it deliberately rather than by accident.

### 3.5.1 How `sleep_day` is filled in

`sleep_day` is the join key between this tab and the Surveys tab. Getting it right
matters more than getting it quickly, so the **server** fills it in. Not the
client, and not a formula.

- **SLEEP markers.** Apply the noon rule from section 4 to the marker's own local
  time. Purely arithmetic, no lookup.
- **WAKE markers.** Find the most recent SLEEP for the same study and participant
  whose instant is at or before this one, and copy its `sleep_day`. That ties the
  pair together explicitly.
- **A WAKE with no SLEEP before it.** Fall back to the noon rule on the WAKE's own
  local time, which puts an early-morning wake on the previous day. Correct, and
  it means the column is never empty.
- **Edits.** Changing a SLEEP time can move it across noon. When that happens, the
  server recomputes that marker's `sleep_day` and updates the WAKE paired with it
  in the same locked operation, so a pair can never disagree.

**Why not the client.** It looks tempting, because the app knows which SLEEP it is
closing. But its copy of history can be cleared by the browser, and a participant
who logs sleep on a phone and wake on a tablet leaves the second device with no
record of the first marker. A join key computed from data the client might not
have is a join key that will sometimes be wrong. The client may compute one for
display; the server's value is the one that is stored.

**Why not a formula.** Rows are appended by code, so each new row would need the
formula written into it anyway. A formula also recalculates, which means an
earlier row's stored value could change later, and sorting the tab would break it.

The server reads backwards from the last row until it finds the matching SLEEP or
passes a sensible limit, so the cost does not grow with the size of the study. All
of this happens inside the lock that already guards writes, so two devices
submitting at once cannot interleave.

The Surveys tab needs no lookup: a morning diary is filled in after waking, so
the noon rule applied to `survey_opened_utc` names the night being reported.

### 3.6 Surveys and SurveyAnswers

Survey data is stored **long**: one row per survey on `Surveys`, and one row per
question shown on `SurveyAnswers`. Earlier drafts used a single wide tab with one
column per question, shaped to be read directly by the EMA-CleanR analysis
script. That shape is gone. It could not hold a per-answer timestamp without one
column per question per timestamp, and it could not record a survey that was
shown and declined, because a survey with no answers produced no row at all.

Feeding EMA-CleanR is now a conversion rather than a storage decision: pivot
`SurveyAnswers` on `question_id` and join `Surveys` for the start and end times.
That converter is a separate piece of work and is not part of version 1.

#### Surveys

One row per survey **shown**, whether or not anything was answered.

| Column | Notes |
|---|---|
| `survey_id` | Generated on the device when the survey opens. The join key for SurveyAnswers |
| `study_id`, `participant_id` | |
| `sleep_day` | The night this survey describes. See section 4 |
| `sleep_record_id` | The SLEEP marker for that night, if there was one |
| `wake_record_id` | The WAKE marker that opened the survey |
| `wake_marker_utc` | When WAKE was tapped |
| `survey_opened_utc` | When the first question appeared |
| `survey_ended_utc` | When the participant submitted or skipped. Empty if the survey was abandoned |
| `survey_duration_ms` | Ended minus opened. Stored so the tab reads without a formula |
| `end_reason` | `submitted`, `skipped`, or `abandoned` |
| `question_count` | How many questions were shown |
| `answered_count` | How many were answered |
| `skipped_count` | The difference |
| `edit_count_total` | How many answers were changed before submitting |
| `question_set_hash` | See section 3.4.2 |
| `event_tz` | The participant's zone at the time |
| `tz_offset_minutes` | The offset in force at `survey_opened_utc` |
| `record_id` | Same value as `survey_id`, so a resend updates this row rather than adding one |
| `received_utc` | When the row reached the workbook |
| `source`, `app_version` | |

**`end_reason` carries the distinction the old tab could not.** `skipped` means
the survey was shown and declined, which is a real finding about engagement.
`abandoned` means the app closed part way through and the queue sent what
existed, with `survey_ended_utc` empty. Without those two values, both look
identical to data loss.

**A night with no survey row at all** means no survey was shown. That happens in
the standalone build when the person has hidden every question, and it is
deliberate: an empty survey is not offered, not shown, and not recorded.

**`tz_offset_minutes` alongside `event_tz`.** Daylight saving edges and later
revisions to the time zone database both reinterpret history. The stored offset
pins what the offset actually was.

#### SurveyAnswers

One row per question **shown**, per survey. Every question shown gets a row,
answered or not: an unanswered question is one with an empty `value` and an empty
`answered_utc`, which is not the same as a question nobody was asked.

| Column | Notes |
|---|---|
| `record_id` | Generated on the device |
| `survey_id` | Join to Surveys |
| `study_id`, `participant_id` | Repeated so this tab can be filtered on its own |
| `sleep_day` | Copied from the Surveys row, so the `_calc` tab can average one question over a date range with `AVERAGEIFS` alone, without joining through `survey_id` |
| `question_id` | `Q01` through `Q20` |
| `question_source` | `default`, `researcher`, or `participant` |
| `answer_type` | As shown, from section 3.4 |
| `question_text_shown` | The wording the participant read, copied in at the time |
| `required` | Whether the question was required when it was shown |
| `display_order` | Where it appeared |
| `answer_order` | The order it was actually answered in. Empty if unanswered |
| `value` | The answer as a person reads it |
| `value_number` | The same answer as a single number, for analysis |
| `value_unit` | `hh:mm`, `minutes`, `times`, `points`, or empty |
| `answered_utc` | When the answer was first given. **Empty means shown but not answered** |
| `edited_utc` | When it was last changed before submitting. Empty if never changed |
| `edit_count` | How many times it was changed |
| `time_to_answer_ms` | From the question appearing to the first answer |
| `received_utc` | When the row reached the workbook |
| `source`, `app_version` | |

**Two value columns, on purpose.** A researcher reading the tab wants `23:30` and
`Yes`. An analyst wants one numeric column that behaves the same way for every
question type. Storing both costs a column and saves everyone a conversion:

| `answer_type` | `value` | `value_number` | `value_unit` |
|---|---|---|---|
| `time` | `2026-08-16T23:30-04:00` | Minutes from local midnight | `hh:mm` |
| `datetime` | `2026-08-14T15:00-04:00` | Minutes from local midnight | `hh:mm` |
| `duration_minutes` | `55` | `55` | `minutes` |
| `count` | `3` | `3` | The question's `unit` |
| `ordinal` | `2` | `2` | `points` |
| `scale` | `7` | `7` | `points` |
| `boolean` | `Yes` | `1` | *(empty)* |

**`question_text_shown` is the reason a mid-study wording change is survivable
rather than silent.** `questions_locked` and `question_set_hash` between them say
that something changed and which surveys are affected. This column says what each
participant actually read. It costs a repeated string per answer and removes the
worst failure this workbook can have.

**`answer_order` and `time_to_answer_ms`** are ordinary data-quality signals: a
survey answered in eight seconds, or answered strictly bottom to top, looks
different from one filled in carefully. Neither can be recovered later, and
neither is recorded anywhere else.

**Volume.** Twenty questions across sixty nights for thirty participants is
thirty-six thousand rows, which Google Sheets handles without difficulty. The
long shape costs rows, which are cheap, instead of columns, which are frozen.

### 3.7 Freeze the schema now

A deployed copy of MiNap Go never receives an update. Adding a column later means
every researcher edits their own Sheet by hand. So version 1 creates every column
it will plausibly need, and every column it creates is final.

Storing answers as rows rather than columns removes most of what used to need
freezing. A new question is a new row on QuestionsSetup and new rows on
SurveyAnswers; no tab changes shape. QuestionsSetup still ships twenty rows and
question IDs still stop at `Q20`, but for a different reason than before: the
`_calc` tab holds one chart row per question slot, and a chart range is a constant
written once (section 3.8). Twenty is a limit on how many questions can be
charted, not on how many columns exist.

---

### 3.8 How the tabs get created

The template Sheet holds **only a README tab** explaining how to deploy. It has no
script attached and therefore no deployment, so it cannot contain working tabs: a
Dashboard drawn there would point at ranges that do not exist yet. Every tab, and
every chart, is created by the app the first time a researcher opens the deployed
web app.

The layout is a declaration at the top of the server code, not steps inside a
function:

```js
const WORKBOOK = {
  schemaVersion: 1,
  tabs: [
    { name: 'StudySettings', frozenRows: 1,
      columns: [
        { header: 'edit_window_days', width: 140,
          note: 'How many days a participant may go back and correct a sleep or wake time.' }
      ],
      defaultRows: [[7]]
    }
  ]
};
```

Default values are declared a row at a time rather than a column at a time. The
QuestionsSetup tab ships twenty rows across twelve columns, and twelve parallel
twenty-element arrays would be unreadable, which defeats the point of putting the
layout in one place you can read.

One function walks it and builds what is missing. Adding a column is one line, in
one file, and it shows up plainly in a code review.

This was very nearly a set of separate template files that the build turned into
code. That was over-engineering: the schema is frozen after version 1 ships, so
optimising for editing it often solves a problem that does not exist. The benefit
worth keeping is that the layout is data you can read in one place, and a constant
gives that for nothing.

The four charts in section 11 are created the same way, using the Apps Script
chart builder. Fix the size of the `_calc` tab in the declaration — fourteen date
rows, twenty question rows — so chart ranges are constants that never need
recalculating.

### 3.9 Never clear a tab

The current code wipes a tab when its headers do not match what it expects. That
was survivable when a tab held nothing but appended rows. It is not survivable
now: ParticipantsSetup holds participant IDs and PIN records typed by a researcher,
and the Dashboard holds charts.

Provisioning creates what is missing and leaves everything else alone. If it finds
a tab whose shape it does not recognise, it stops and says so rather than
repairing by deletion. `schemaVersion` is written into StudySettings on creation and
checked on later opens, so a Sheet built by an older version is detected instead
of silently written to.

---

### 3.10 One spelling for yes and no

Every yes-or-no column in the workbook uses `Yes` and `No`. One spelling everywhere,
so a researcher never has to remember which tab wanted `TRUE` and which wanted `YES`.

**Written strictly, read loosely.** Everything the app writes uses exactly those two
words. Everything that reads a yes-or-no cell also accepts what a person or a
spreadsheet is likely to leave there instead:

- `0` and `1`
- the booleans `TRUE` and `FALSE`, as Sheets stores them
- the words `yes`, `no`, `true`, and `false` in any casing

A researcher typing `yes` into a cell must not silently mean no. An empty cell is
treated as `No` only when the app is recording an answer to a required question;
everywhere else, empty means nobody has said yet, which is not the same as no.

---

## 4. Sleep day

A night that starts at 01:30 belongs to the previous calendar day. Every summary
uses this rule, applied to the local time sleep starts:

```
if local_time_of(sleep_onset) >= 12:00:
    sleep_day = local_date_of(sleep_onset)
else:
    sleep_day = local_date_of(sleep_onset) - 1 day
```

**This is the rule the Depression Center's Sleep Data Automation already uses**,
transcribed from its Power Query step so that numbers from the two tools line up
without anyone reconciling them:

```
if Time.From([SleepOnsetDateTime]) >= #time(12,00,00)
then Date.From([SleepOnsetDateTime])
else Date.AddDays(Date.From([SleepOnsetDateTime]), -1)
```

Two things about it are easy to get wrong and both matter:

- **It reads local time, never UTC.** A participant in Detroit going to bed at
  23:00 is already at 03:00 UTC the next day, and a UTC reading would file the
  night under the wrong date for everyone west of Greenwich.
- **It is anchored on sleep onset**, not on when the survey was filled in and not
  on the wake time. That is why a WAKE marker copies its `sleep_day` from the
  SLEEP that precedes it rather than working one out for itself (section 3.5.1).

`sleep_day` is stored as a real column rather than recalculated in formulas. It
is cheaper, and a researcher reading the Sheet can see what it means.

When averaging clock times across a group of nights, convert first:

- **Bedtimes:** minutes counted from noon, so 23:00 is 660 and 01:30 is 810.
  Averaging raw clock times gives nonsense, because 23:50 and 00:10 average to
  midday.
- **Wake times:** minutes counted from midnight.
- **Duration:** wake time minus sleep time. No conversion needed.

The same code produces `sleep_day` for the client dashboards and the stored
column, so the two can never disagree.

### 4.1 How clock times are stored

Times are stored as the actual time the participant reported, never converted
into some other unit. The Sheet, the CSV export, and the app all show the real
answer.

The stored form is an ISO 8601 local date and time with the offset:

```
2026-08-16T23:30-04:00
```

A bare `23:30` would be ambiguous, because a bedtime after midnight belongs to
the previous night. The date resolves that, and it is derived from `sleep_day`
using the same anchor rule as section 4: times before noon belong to the morning
after, times from noon onward to the evening before. The offset makes daylight
saving time and travel unambiguous. Nothing about the participant's answer is
altered; the date and offset only say which instant the answer refers to.

Google Sheets and Excel both parse this format, so a researcher can subtract two
cells and get a duration.

**Averaging clock times needs care, and that happens in `_calc`, not in storage.**
Clock time runs on a circle: midnight sits next to 23:59, not twelve hours away,
so an ordinary average of 23:50 and 00:10 gives midday. The `_calc` tab therefore
converts to minutes from an anchor before averaging — noon for bedtimes, midnight
for wake times — then converts back for display. That conversion is a step in a
calculation, not a stored value.

**Analysis tools built for rating scales will not handle a clock time.** A
timestamp read as a rating produces nonsense, which is not a fault in the tool: a
clock time is a different kind of quantity, and it runs on a circle. Anything
consuming these answers numerically should read `value_number` from section 3.6,
which holds minutes from local midnight for a time answer, and should average
them the way `_calc` does rather than directly.

Durations and counts (items 3, 4, and 5) are ordinary whole numbers and need none
of this.

### 4.2 Derived measures

Computed in `_calc` and in the app, never stored, so a change to the formula
cannot leave old rows behind:

| Measure | Formula |
|---|---|
| Time in bed | `Q07` − `Q01` |
| Sleep onset latency | `Q03` |
| Wake after sleep onset | `Q05` |
| Total sleep time | (`Q06` − `Q02`) − `Q03` − `Q05` |
| Sleep efficiency | total sleep time ÷ time in bed, as a percentage |

Sleep efficiency is the usual primary outcome in insomnia work, and it needs
`Q01` and `Q07`. That is why the diary asks for getting into bed and getting out of
bed even though the markers already give sleep and wake times.

---

## 5. Participant login, PINs, and device sessions

Only the study build has a login. The standalone build has no server to check
anything against.

### 5.1 Setting a PIN

The researcher adds a Participant ID to the ParticipantsSetup tab. Nothing else.

The first time that participant logs in, the app finds no PIN on file and asks
them to choose one. It saves a random salt and a hash. Every later login checks
against that record.

The researcher never sees, sends, or handles a PIN. There is no admin screen, and
none is needed: the Sheet is the admin screen, and the researcher opens it as its
owner.

The gap in this approach is honest and small. Between the researcher adding an ID
and the participant claiming it, someone who guessed the ID could claim the PIN
first. Have participants claim their PIN during the enrollment appointment and
the window is minutes long.

### 5.2 Changing and resetting

- **Participant changes their PIN:** enter the old one, then the new one.
- **Participant forgets it:** the researcher clears `pin_hash`, `pin_salt`, and
  `failed_attempts` for that row. The next login starts the setup flow again.
- **Account locked after failed attempts:** the researcher clears the same cells.

One procedure covers both problems, so there is only one thing to remember.

### 5.3 What the PIN does and does not do

The PIN does two jobs, and only two:

1. It proves who the person is at login and when they change it.
2. It unlocks the key that encrypts the participant's local copy of their data.
   Entering it decrypts the profile; a wrong PIN cannot read anything, and this
   works with no connection.

It is not the credential the server checks on a write. That is a device token,
described in section 5.4. The PIN is never stored on the device and is not held
in memory after the moment it is used.

Splitting the two matters. If the PIN authenticated every write, the app would
have to keep the PIN to stay signed in, and keeping it would hand a stolen device
the participant's own chosen secret, which people reuse. A device token is
random, useful for nothing but writing as that participant to this one workbook,
and revocable from the Sheet.

Be clear about the limits:

- Apps Script offers SHA hashing but no PBKDF2, and running a hash tens of
  thousands of times there is slow enough that participants would notice at
  login. Use a per-participant random salt, a modest iteration count, at least a
  six-digit PIN, and a hard lockout. The lockout, not the hash, is what stops
  guessing.
- The researcher can read the hashes in their own Sheet, and could work out a
  six-digit PIN offline. The PIN is not a secret from the study team.
- The endpoint is open to anyone, so a wrong-PIN response is a signal an attacker
  can test against. Server-side lockout is the real defense.

State this in the protocol. The PIN stops participants writing as each other. It
is not hospital-grade authentication.

### 5.4 Staying signed in: the device token

A sleep diary is opened at least three times around one night: going to bed,
waking, and the morning survey. The phone may have reclaimed the page between
each one. Asking for a PIN every time is friction nobody asked for, so the app
stays signed in until the participant logs out or the researcher disables them.

**What the server issues.** A successful `setPin` or `verifyPin` mints a device
token: 256 bits of randomness, returned to the browser once and never again. The
Sheet stores only a hash of it, in `device_token_hash`. Every write sends the
token instead of the PIN, and the server checks three things before storing
anything: the row exists, `enabled` is `Yes`, and the token matches.

The hash here is a single SHA-256 with no stretching, unlike the PIN hash in 5.3.
Stretching exists to slow an offline guess against a short secret a person chose.
A 256-bit random value is not guessed, and skipping the stretching takes roughly
a second of work off every marker and every survey.

A failed token check never touches `failed_attempts`. That counter belongs to PIN
guessing, and a stale device must not be able to lock a participant out of their
own account.

**One device at a time.** Signing in on a second device mints a new token and
overwrites the old one, so the first device is signed out. This is a deliberate
simplification, not an oversight: with no read path, a new device already starts
with an empty local history, so there is nothing for two devices to keep in step.

Being signed out mid-night costs nothing. A write refused for an unrecognised
token comes back with its own reason, distinct from an invalid login, and the app
keeps whatever it had queued and asks for the PIN. Entering it mints a new token
and the queue sends in order. Nothing is dropped, and the server is never asked
whether a night is in progress.

**Revoking.** Clearing `device_token_hash` signs that device out at the next
write. Setting `enabled` to `No` stops every write for that participant. Both are
one cell in a Sheet the researcher already owns.

### 5.5 Resetting a PIN destroys the local copy

Clearing the PIN throws away the key to the encrypted local data, so the
participant's history on that device becomes unreadable. In a study this is
acceptable: the Sheet holds the record. Say so in the participant instructions.

Clearing the device token is not the same thing and does not do this. It signs
the device out; the PIN still unwraps everything that was already there. Reach
for it when a participant loses a phone or moves to a new one, and reach for the
PIN reset only when the PIN itself is the problem.

Private notes are unaffected. See section 6.

### 5.6 Local storage

The PIN-unlocked key described in 5.3 encrypts an IndexedDB database, not
localStorage. IndexedDB replaced localStorage in version 1 because the
participant-facing screens need one database name and record layout that
holds up for the whole build, not a handful of ad hoc keys.

**Database name.** The static site that serves the standalone build hosts
other PWAs on the same origin, and IndexedDB databases are scoped per origin,
not per path -- a generic name could collide with another app's. Both builds
use the fixed name `minap-go`.

**Records are namespaced by identity.** A single Apps Script deployment can
serve more than one study sharing one workbook (section 3.3), and a device --
a researcher's own test phone, a shared household device -- could plausibly
be used for more than one study/participant pair over time. Every record is
keyed by `{studyId}_{participantId}_{collection}`, so two identities used on
the same device get fully separate, independently encrypted data: no
overwriting, no orphaning. The standalone build has no login and only ever
one local identity, so it uses a fixed prefix instead.

A small unencrypted record remembers the last identity used on this device,
purely so the login screen can pre-fill the Study ID and Participant ID
fields for the common case (one participant, one device, every night). A
"Not you? Switch account" link clears it; either way, the two IDs typed are
what is actually looked up, so switching never touches another identity's
data.

**How the app resumes without asking.** The key that encrypts the local
records is wrapped twice. One copy is wrapped under a key derived from the
PIN, which is what a fresh sign-in unwraps. The other is wrapped under a
device key: a random key the browser generates and stores, marked so that
page code can use it but can never read it back out. The same device key
encrypts the stored device token. On startup the app reads the device key,
unwraps the data key and the token, and goes straight to the home screen with
no prompt and no connection needed.

**What that protects, and what it does not.** A key the page cannot read out
cannot be stolen by injected script, and the app cannot be tricked into
handing over its own key. It is not a safe against someone who has taken the
phone apart: on a rooted or jailbroken device the browser's stored form of
that key can be recovered. So the protection that carries the weight is that
the token is revocable and useless anywhere else, and the unreadable key is a
second layer on top. Set out honestly, the position is this: a lost unlocked
phone exposes the diary on that phone, it does not expose the PIN, and the
researcher can revoke the device from the Sheet.

If a browser turns out not to store the device key properly, the app stores
the token in the clear instead and carries on. That is a smaller loss than it
sounds, because the token is single-purpose and revocable. Storing the PIN
would not be, which is why the app never does.

**Measured, not assumed.** Inside the Apps Script frame on desktop Chrome, a
non-extractable key is generated, stored, read back as a usable key, and still
works after a full reload; `exportKey` on it is refused, so the protection is
real rather than nominal. Two things about it still need checking on the
devices participants actually use: iOS Safari, and whether a researcher
publishing a new version of their deployment changes the frame's origin. It
does not change across a reload. If it changes across a redeployment, every
participant's local copy is orphaned and they sign in again on an empty
device -- survivable, because the Sheet holds the record, but it belongs in
the participant instructions rather than in a surprise.

**Ask for persistent storage, in both builds.** The study build was assumed
not to be able to, being third-party storage in a frame; it can, and the
request is granted at least sometimes. Ask once, after the first successful
sign-in, and treat a refusal as normal rather than as an error. It does not
change the honest position in section 1 -- study-build storage is the
unreliable copy and the Sheet is the record -- but a granted request is free
and moves the odds the right way.

**Private browsing throws all of this away.** Nothing persists past the
session, and the request for persistent storage is refused outright. That is
the browser working as intended, not a fault in the app, but a participant
who opens the diary in a private window every night will be asked for their
Study ID, Participant ID, and PIN every night and will never see their own
history. Worth one line in the participant instructions and one entry in
troubleshooting.

**Logging out locks; it never deletes.** "Log out" clears the in-memory key,
deletes the device key, the device-wrapped copy of the data key, and the
stored token, and tells the server to forget the token as well. It then
returns to the PIN entry screen for the same identity. The PIN-wrapped copy
and every namespaced record stay on disk, still encrypted, exactly as before
-- logging back in with the correct PIN sees the same history again. This
matters because the study build's storage can already be cleared by the
browser on its own (section 1); logging out should never be a second way to
lose the same data. The same rule applies when a revoked Study/Participant ID
forces a logout: a later re-enable should not cost the participant their
on-device history.

**Nobody is signed out for being offline.** Because every write is checked
against `enabled` and the token, tapping Sleep while online is itself the
check, and an authoritative one. The separate checks exist only so the
interface does not keep showing a disabled participant their own screens, and
they sign somebody out only on an explicit "no" from the server. The app
records when it last heard back; after fourteen days with no answer it tries
again on the next start, and if it still cannot reach the server it keeps
working and says quietly that it has not checked recently. A participant with
no signal is queueing writes that will be checked on arrival, so an
unverified spell offline costs nothing and is not treated as a fault.

**The standalone build has no logout function, because it has no login**
(this whole section applies only to the study build). There is nothing to
log out of.

---

## 6. Private notes

Notes are private diary entries. They are never sent to a researcher or
clinician, and this is guaranteed by structure rather than by rule:

- The code that builds a shareable report reads only the entries and survey
  answers. It cannot reach the notes store at all.
- Notes are encrypted with their own key, wrapped by a separate notes PIN that
  never leaves the device. Nothing about them exists on the server, so there is
  no cell a researcher could clear. A login PIN reset cannot touch them.
- Turning notes on requires setting a notes PIN. It can be changed but not
  removed, because no removal path exists.

### 6.1 How the notes are encrypted

Built on the browser's own cryptography, in both builds, with no library.

- A random 256-bit key encrypts the notes, using AES-GCM.
- The notes PIN is stretched into a wrapping key with PBKDF2, a random salt, and
  310,000 iterations. That wrapping key encrypts the notes key.
- The device stores the salt, the iteration count, the wrapped key, and a short
  value used to check whether a PIN is right. **The PIN itself is never stored.**
- Changing the PIN unwraps the notes key with the old one and wraps it with the
  new one. The notes are not re-encrypted, so the change is instant however many
  notes there are.

This is why a backup can restore notes on a new phone: the file carries the
ciphertext and the wrapping material, and the PIN opens it there just as it did
on the old device.

Unlike the login PIN in the study build, these iteration counts run in the
browser, where 310,000 is fast enough to be unnoticeable.

Sleep times and survey answers never go in the notes store, even though it would
make them survive a PIN reset. Those are study data the participant agreed to
share; notes are what they chose not to share. The boundary is intent, and
blurring it would break a promise.

Three PINs exist and they are unrelated. Name them distinctly everywhere:

| Name | Where | Purpose |
|---|---|---|
| Login PIN | Study build | Unlocks local data; authorizes writes |
| Notes PIN | Both builds | Unlocks the private notes |
| Share PIN | Standalone build | Protects a shared report link |

---

## 7. Server interface

The Apps Script web app is deployed to run as the researcher, open to anyone.
Anonymous access is safe only because nothing readable is served.

**Every function in the script file without a trailing underscore can be called
from any browser.** That is how Apps Script works. Treat the list as a public
API.

| Function | Returns |
|---|---|
| `doGet` | The app page |
| `validateLogin` | Whether the login is valid, and whether a PIN is already on file for it |
| `setPin` | Success or failure, and a new device token on success. Also handles changing an existing PIN, given the old one |
| `verifyPin` | Success, failure, or locked. A new device token on success |
| `checkSession` | Whether this participant is still enabled and this device still recognised |
| `signOutDevice` | Confirmation only. Forgets the token it was given, and only that one |
| `getConfig` | Question list, edit window, backup reminder interval |
| `logMarker` | Confirmation only |
| `logSurvey` | Confirmation only. Writes one Surveys row and its SurveyAnswers rows in one locked operation, so a survey can never exist without its answers or the reverse |
| `updateMarker` | Confirmation only |

`logMarker`, `logSurvey`, and `updateMarker` carry a device token, not a PIN. See
section 5.4.

**`logSurvey` refuses to overwrite a survey that is already locked** — submitted
outright, or ended skipped or abandoned with at least one answer given — returning
`already_answered` instead. It also enforces `edit_window_days` against the night
the survey describes, the same as an edit to a marker (section 10), returning
`edit_window_expired` once that night is too old. A brand-new `survey_id` names
its night through an optional `target_sleep_day`, needed only when nothing else in
the payload already implies it; once a Surveys row exists, its own `sleep_day` is
authoritative and `target_sleep_day` is ignored.

No function returns diary or survey data. There is no read path in version 1, not
even one protected by a PIN. Recovery happens through file export and import
instead.

**Why that rule may be worth revisiting later, but not now.** It rests on the
deployment being open to anyone holding two IDs that are published in this
repository and in the setup guide. A function that requires a device token is not
open in that way, so a token-gated read path — recovering history on a new device,
say, which is the sharpest limitation this design has — becomes possible to build
safely for the first time. It is deliberately not in version 1. Anyone reaching
for the old conclusion should notice that the premise underneath it has changed.

`getHistory`, which once read the Sheet and returned a participant's rows to the
browser, is gone, and `include` is renamed to `include_` so it is not callable.
Both were the first fix made in version 1, because the deployment is open to
anyone and the sample IDs are published in the repository and the setup guide.

---

## 8. Export, import, and backup

Because there is no read path, an exported file is the only way to move history
to a new device or recover it after a PIN reset. Both builds have this.

There are two export formats, and they do different jobs. Do not merge them.

### 8.1 CSV export — for reading and analysis

Plain text, opens in Excel, one file per table. Both builds.

| File | Contents |
|---|---|
| `minap-sleep-<date>.csv` | The SleepDiary columns from section 3.5 |
| `minap-surveys-<date>.csv` | The Surveys columns from section 3.6 |
| `minap-answers-<date>.csv` | The SurveyAnswers columns from section 3.6 |

Two rules make this safe and reversible:

- **Include `record_id`.** Without it, importing a file twice creates duplicates.
- **Guard against spreadsheet formula injection.** Any cell whose text starts with
  `=`, `+`, `-`, `@`, a tab, or a carriage return must be prefixed with a single
  quote before writing. Question wording is researcher-supplied text, so this is
  a real path, not a theoretical one.

CSV never contains private notes. See section 6.

### 8.2 Backup file — for moving devices

A single encrypted file holding everything, including the notes vault as
ciphertext plus the key material needed to open it later (salt, iteration count,
wrapped key). Restoring on a new phone preserves notes, and the notes PIN is
still required to read them.

The backup carries a `schema_version`. Migrations run on import as well as on
load, so an old backup restores cleanly years later.

### 8.3 Import

Both formats import. Merge by `record_id`:

- Unknown ID: add it.
- Known ID, identical: skip.
- Known ID, different: keep the newer `updated_at_utc` and tell the participant
  how many entries were changed.

Importing can never delete an entry. Show a summary before writing anything.

**Import does not send data to the Sheet.** A restored entry that was never
successfully submitted stays local. Reconciling old entries into a study Sheet
after the fact would let anyone with the app write arbitrary history, so version 1
does not attempt it. The Sheet remains the study record.

### 8.4 Reminders

Every 15 days in the study build, every 30 in the standalone build. A dismissible
banner plus a permanent menu item. No repeated interruption.

Storage limits matter when writing the participant instructions. The study
build's storage can be cleared by Safari after roughly a week of not opening the
app, so a 15-day reminder can arrive after the data it was meant to protect is
gone. The standalone build asks for persistent storage on install, which browsers
usually grant to an installed app, so 30 days is comfortable there.

Cloud backup to Google Drive or OneDrive is a later enhancement, not part of
version 1.

---

## 9. Sharing a report

Standalone build only. Study participants have no sharing step, because their
data is already in the researcher's Sheet.

Sharing is always started by the person whose data it is. Nothing is sent
automatically, and the Depression Center never holds a copy. A clinician receiving
a report records what matters in the medical record; this app never replaces it.

### 9.1 Link with the data in the address

The report travels inside the URL fragment:

```
app/report.html#<encrypted blob>
```

A fragment is never sent to a web server. It does not appear in hosting logs. The
viewer page is static and decodes everything in the browser.

Build the payload in this order: pack the entries into a compact binary layout,
then encrypt with AES-GCM using a key derived from a short share PIN, then encode
as base64 for the address bar.

### 9.2 Size, and why the range is capped

The original design assumed a two-button diary. With a full sleep log, twenty
survey questions, and naps, roughly 25 values per night, the numbers change:

| Encoding | 30 nights |
|---|---|
| Plain JSON | about 4,500 characters |
| Compressed text | about 1,900 characters |
| Packed binary, then encrypted | about 1,250 characters |

Treat these as estimates to confirm against real entries.

The limit is not the browser, which tolerates far longer addresses. The limits are
email clients that wrap long links, patient-portal message boxes that mangle them,
and QR codes that stop scanning reliably. So:

- **Link and QR: last 14 nights.** Around 1,000 characters. Scans reliably, and
  matches what a clinician reviews in a short appointment.
- **Longer history: an encrypted file.** The viewer page also accepts a file the
  person picks or drags in. Same encryption, same viewer, no length limit. This is
  what goes into a portal message as an attachment.
- **PDF:** the readable fallback. See section 9.4.

### 9.3 What the share PIN protects

Say this plainly in the interface and the documentation, because it is easy to
overstate.

A short PIN can be guessed by someone who already holds the link, given time. Key
stretching slows that down; it does not prevent it. If the link travels through a
patient portal, the portal is the real protection and it is much stronger than the
PIN.

What the share PIN actually prevents is the ordinary accident: pasting into the
wrong conversation, or a screenshot landing in a shared photo library. That is a
sensible goal, and it is the only one to claim.

The share PIN is separate from the notes PIN and from the login PIN. It is short
on purpose, because the person has to read it aloud or type it into a second
message.

### 9.4 PDF

Standalone build only. The study build inlines its whole code into every page
load, and a PDF library is far too large for that budget.

The PDF contains the same charts and tables as the report link, laid out for
printing, with the date range and generation time on every page.

**Every PDF is password-protected by default.** The person may turn it off for a
single export, with a clear warning, but the default is on.

Library notes:

- jsPDF is MIT-licensed, which combines freely with this project's GPL v3.
  Encryption has been built in since version 2.5: pass a user password, an owner
  password, and a permissions list when creating the document. The default is
  AES-128.
- Size is roughly 100 KB compressed. Acceptable in the standalone build, where the
  service worker caches it once.
- A QR code needs a second small library. Choose an MIT or BSD one of about
  10 KB.

**Verify before shipping.** PDF password protection is only as strong as the
password, and a six-digit PIN is weak against an offline attack. Separately,
confirm that the library derives its encryption key using the browser's secure
random number generator; published source for the file identifier uses an ordinary
random function, and in the PDF standard security handler that identifier feeds
key derivation. Check this against the version you actually bundle, and if it does
not hold, treat the PDF password as a deterrent against casual opening rather than
as encryption.

State the honest claim in the documentation: a password-protected PDF stops
someone casually opening a file they were not meant to see. It is not a secure
channel.

---

## 10. Editing entries

| Item | Rule |
|---|---|
| Sleep or wake marker | Editable for 7 days, measured from the time currently stored, not the new time |
| Survey answers | Never editable |
| Missing survey | May be added as a whole survey. Individual answers cannot be filled in later |

Seven days is the default, set as `edit_window_days` in StudySettings so a study can
choose differently. Measuring from the stored time rather than the proposed one
stops somebody walking an entry backwards a week at a time.

**The server enforces this, and the app also enforces it.** The app hides the edit
control on anything older, which is what a participant experiences. The server
checks again before writing, which is what actually holds, because the app runs on
a device and anything a device sends is untrusted. An edit that arrives outside
the window is refused with a message the participant can act on.

One case falls between the two: an edit made inside the window, queued because the
device was offline, and delivered after the window has closed. The server judges
it by when the edit was made, not when it arrived, so a participant is never
punished for having no signal. The queued item carries that time.

Adding a survey after the fact needs care. `survey_opened_utc` and
`survey_ended_utc` must record when the participant actually answered, with the
night it refers to carried in `sleep_day`. Otherwise completion rates look better
than they were.

Unlike a marker edit, a survey completion's edit window is checked against the
night it describes (`sleep_day`) as of the moment the server receives it, not
against when the participant actually completed it. A completion attempted just
inside the window but queued offline long enough to arrive after it closes is
refused on delivery rather than honored — a narrower version of the problem
`updateMarker`'s `client_edit_utc` solves for markers, not yet solved the same
way for surveys. Worth revisiting if it turns out to matter in practice.

A missing survey may be added for the same seven days markers may be edited, and
for the same reason: without a cap, participants fill in two weeks the night
before their final visit. A survey may be completed only while it holds no
answers at all. Once it has been submitted, or ended with even one answer given,
it is closed for good, which keeps the "survey answers are never editable" rule
above from being reachable by a side door. Both limits are enforced on the device
and again on the server.

---

## 11. Researcher dashboards, in the Sheet

Four charts on a Dashboard tab, driven by a filter cell at the top left of that same
tab holding either `ALL` or one Participant ID. The tab holds the filter and the four
charts and nothing else: no tables, and no working data. Charts start below the filter
so there is room for further controls without moving them.

1. Total sleep per day, last 14 days
2. Average, earliest, and latest sleep and wake times by day of week, last 14 days
3. Days with sleep and survey data, last 14 days
4. Average of each survey question, last 14 days

Sleep efficiency, total sleep time, sleep onset latency, and wake after sleep
onset are computed in `_calc` per night from section 4.2, and feed charts 1 and 2.
They are worth showing to the researcher even in version 1, because sleep
efficiency is what most sleep studies actually report.

### Everything must survive export to Excel

Researchers export these workbooks. Formulas that only exist in Google Sheets
turn into errors.

**Never use:** `QUERY`, `SPARKLINE`, `ARRAYFORMULA`, `IMPORTRANGE`, `FLATTEN`.
None has an Excel equivalent.

**Avoid:** `FILTER`, `SORT`, `UNIQUE`, `LET`, `XLOOKUP`. These need Excel 365, and
many university machines run older versions.

**Safe everywhere:** `SUMIFS`, `AVERAGEIFS`, `COUNTIFS`, `MINIFS`, `MAXIFS`,
`INDEX`, `MATCH`, `IFERROR`, `TEXT`, `WEEKDAY`.

All four charts can be built from the safe list.

### How to build them

Put a hidden `_calc` tab between the data and the charts. It holds one fixed table
per chart: a 3-column criteria row, a 14-row date table, a 7-row day-of-week table,
and a 20-row question table. The question table reads `SurveyAnswers` with
`AVERAGEIFS` and `COUNTIFS` over `question_id`, which is what the long shape costs
here: one criteria column instead of one column reference per question. Each table gets a named range, so a chart and a formula
refer to `calcDaily` rather than to a row number, and the names survive the download
to Excel. Charts point at `_calc`, never at the raw data. Clock times are stored as real times
(section 4.1); convert them to minutes from an anchor inside `_calc` before
averaging, then convert back for the axis labels.

Handle the `ALL` case without branching by choosing the criteria value: use a
match-anything criterion when the filter is `ALL`, and the Participant ID
otherwise.

Verify by downloading the workbook as `.xlsx` and opening it. Google charts
convert to Excel charts reasonably well, but not perfectly, and this is the kind
of thing that only shows up when you check.

---

## 12. Participant dashboards, in the app

Both builds. All charts read local storage and work offline.

### Sleep

- **Last night:** duration, sleep and wake times, compared with the 7-day average.
- **Duration, last 14 nights:** bar chart with a shaded target range.
- **Consistency chart:** one horizontal bar per night spanning sleep to wake,
  stacked by day. The most useful single sleep visual; irregular schedules are
  obvious at a glance.
- **Rolling 7-day average duration.**
- **Weekday against weekend midpoint:** one number, showing the shift between
  work nights and free nights.
- **Completion grid:** small squares, one per night, filled when logged.

### Survey

- **Small multiples:** one small line per visible question, 14 days, in a grid.
  Scales from ten questions to twenty without redesign.
- **Tap for detail:** full-size chart with the question's wording.
- **One overlay:** a chosen question plotted against sleep duration on the same
  time axis. Participants want to know whether sleep affects how they feel; this
  shows it without claiming cause.
- **Completion streak.**

### Drawn by hand, in SVG

No charting library. The study build inlines all of its code into a single page
response with no caching between visits, so a library of several hundred
kilobytes would be sent on every open. Every chart above is rectangles, lines, and
text.

Hand-drawn SVG also gives real page elements, so a title and a label can be
attached to each chart without needing a library feature.

Each chart has a toggle that swaps it for a plain data table. This helps people
using a screen reader and anyone who just wants the numbers. The Sheet dashboards
cannot offer this, which is another reason the app should.

---

## 13. Install the standalone app

Installing matters because it is what makes the browser keep the data. Ask
clearly, once, and leave a way back.

- Chrome on Android and desktop provides a real install prompt. Use it.
- Safari on iPhone does not. It needs the Share menu and "Add to Home Screen", so
  show a short illustrated card instead. Detect the browser; do not guess.
- A banner that can be dismissed and returns on a later visit is fine. A screen
  that blocks the app until the person installs is not: it fails accessibility
  requirements and traps anyone on a managed device.
- Keep a permanent Install item in the menu.
- Ask for persistent storage right after install, which is when browsers are most
  likely to agree.

Explain the benefit in one line: the app keeps working without a connection, and
the browser stops deleting the history.

---

## 14. Working offline, and getting updates

### 14.1 The entry queue

Both builds write to the device first and show the entry immediately. Sending it
onward is a second step that is allowed to fail.

In the study build, a submission that does not reach the Sheet goes into a queue
and is retried when the app is next open and online. This covers new markers, new
surveys, and edits alike; anything that has to reach the server goes through it.

The queue lives in the same storage as everything else, so closing the app or
reloading the page does not lose it. It drains oldest first, one item at a time. A
failure stops the drain until the next attempt, so a server problem cannot turn
into a flood of retries, and items keep their original order.

**Retrying is safe because every item carries its `record_id`.** The hardest case
is a submission that reached the Sheet but whose reply was lost on the way back:
the app still thinks it failed and will send it again. The server treats a
`record_id` it has already stored as the same entry, updates it rather than adding
a second row, and reports success. A flaky connection can therefore never produce
duplicate nights.

Some rejections never retry, because no amount of resending changes the answer:
the Study ID or Participant ID is no longer allowed; a survey the server already
considers locked (`already_answered`); an edit or a survey completion outside
`edit_window_days` (`edit_window_expired`); or a malformed payload. Each of these
is dropped from the queue immediately, with a message telling the participant what
happened, rather than left to jam every later item behind it forever. A device the
server no longer recognises (`device_not_recognized`) is different: the queue is
left untouched and the drain stops until the participant re-enters their PIN,
because that item, unlike the others, will succeed once a fresh token exists.

Nothing is removed from the queue until the server confirms it. An entry the
participant can see on their phone but that has not yet reached the Sheet is
marked as not yet sent, so they are never misled about what the study has
received.

The limit is worth stating plainly, because it shapes what you tell participants.
The study build has no service worker, so the queue only works **while the app is
open**. Closing the app with no signal means the entry waits on the device until
the app is opened again. The standalone build has no queue at all, because there
is nowhere to send anything.

### 14.2 Updating the standalone app

The service worker keeps the app's code in a cache with a version number in its
name. Code and data live in separate places, so updating one never touches the
other.

When a new version appears: the app notices, shows a message offering to update,
and reloads once the person accepts. Old code caches are deleted; nothing else
is.

Three rules that must never be broken, because breaking them destroys data:

- Never rename a storage key without a migration that moves the old data.
- Never delete anything except old code caches.
- Never assume an update ran. A person can stay on an old version for months, so
  every version must read data written by every earlier one.

The study build has no service worker and therefore no update mechanism.
Researchers update by pasting new code into their own project and redeploying,
which they choose to do; running studies are never changed underneath them.

---

## 15. How each person uses it

**Researcher.** Copy the template Sheet. Fill in the setup tabs and the
participant list. Deploy the web app and open it once so the URL is recorded.
Share the URL and each person's Study ID and Participant ID at enrollment, and
have them set their PIN while you are there. Watch the data arrive in the Sheet
and the charts on the Dashboard tab. The file linking Participant IDs to real
people is kept in an approved system, never in Google.

**Study participant.** Open the URL, enter the two IDs, choose a PIN. After that,
tap when going to sleep and when waking, and fill in the short diary each
morning. Export a backup when the app asks. Nothing to install, no Google
account.

**Clinician.** Point patients at the public app. There is nothing to operate, no
deployment, no keys, and no patient data in your custody. Patients send you a
report when they choose to; record what matters in the medical record as usual. A
clinician who instead deploys their own copy takes on data custody, which is a
different decision — see section 17.

**Person tracking their own sleep.** Open the public app and install it when
asked. Pick which questions to answer. Tap sleep and wake, fill in the morning
diary, optionally keep private notes behind their own PIN. Share a report by link,
code, or PDF whenever you want to. Export a backup every so often.

---

## 16. Building and releasing

One repository, one shared core, two packaged outputs. A small Python script
using only the standard library turns the first into the other two. No Node, no
package manager, no lockfile, and nothing that talks to Google.

### 16.1 Why a build step exists

Apps Script cannot serve a plain `.js` file. Its page service only reads files
saved as HTML, so shared code has to arrive there wrapped in a `<script>` tag.
The standalone site wants the same code as an ordinary `.js` file that a service
worker can cache. Same characters, different container.

Keeping two hand-maintained copies would guarantee they drift. The script does
the packaging instead. It never contacts a server, never deploys anything, and
never needs a credential. Releasing is still copy and paste, exactly as this
project has always done it.

### 16.2 The seven-file separation

The shared code splits into seven parts. The split is not sleep-specific; it is
what any browser application without a framework needs, and the boundaries are
chosen so each part has one reason to change. Use it as a starting point for
other projects.

| # | Role | `src/` | `gas/` | `app/` |
|---|---|---|---|---|
| 1 | Shell markup | `index.html` | `Index.html` | `index.html` |
| 2 | Styles | `styles.css` | `Stylesheet.html` | `styles.css` |
| 3 | Environment adapter | `platform/*.js` | `Platform.html` | `platform.js` |
| 4 | Storage, schema, migrations | `data/*.js` | `Core.html` | `core.js` |
| 5 | Domain rules | `logic/*.js` | (same file as 4) | (same file as 4) |
| 6 | Screens, charts, startup | `ui/*.js` | `App.html` | `app.js` |
| 7 | Server code | `server/Code.gs` | `Code.gs` | not present |

`appsscript.json` goes alongside as a settings file rather than code.

**The environment adapter is the important one.** It is the only part that knows
which build it is running in: how data is sent, what storage is available,
whether sharing exists at all. Everything above it is identical in both builds.
That is what makes the promise in section 1 checkable, because a reviewer has one
short file to read rather than a whole application to search.

Parts 4 and 5 stay separate in `src/`, because storage and rules change for
different reasons, but they are packaged into one output file to stay inside the
seven.

Dependencies run one way only: shell, then adapter, then storage, then rules,
then screens. Nothing lower may reference anything higher. The packaging order
follows the same sequence, so a file can never use something defined after it.

### 16.3 What each output looks like

`gas/` is seven files, always, however many files `src/` grows to. A person
pastes them into the Apps Script editor by hand, so the count has to stay
predictable.

`app/` is packaged for a browser instead, and several of its files cannot be
merged even if you wanted to:

```
app/
  index.html      shell
  app.js          screens and startup
  core.js         storage and rules
  platform.js     environment adapter
  styles.css
  sw.js           must be its own file; its address decides what it controls
  manifest.json   fetched as JSON by the browser
  report.html     opens on its own, see 16.5
  icons/          192 and 512 pixel icons, including a maskable one
```

`sw.js` is generated rather than copied. The script writes the cache name and the
list of files to precache, both derived from the contents of the build, so a
stale cache cannot be caused by someone forgetting to change a number by hand.
Deriving the name from a hash of the built files also means a build that changes
nothing produces identical output, which is what makes the check in section 16.6
trustworthy.

### 16.4 Both outputs are committed to the repository

Normally build output would be left out of version control. Not here.

`app/` is what the website serves, so it has to be in the repository. `gas/` is
what a researcher pastes, and a researcher is not going to install Python and run
a script to deploy a sleep diary. So both are generated **and** committed, and
`src/` is for developers only.

That creates one hazard: somebody edits a generated file in a hurry and loses the
change on the next build. Two guardrails:

- Every generated file carries a line under its licence header saying it was
  generated from `src/`, must not be edited, and where the real source is.
- Nothing in `gas/` or `app/` is ever written by hand, including `Code.gs`. It is
  authored at `src/server/Code.gs` and copied. One hand-edited file in a folder of
  generated ones is an invitation to edit the wrong thing.

### 16.5 The report viewer

`report.html` is built from a template. The template holds the page structure with
markers, and the script fills them from the same sources the app uses, so the
decoding, the cryptography, and the charts exist in exactly one place.

The result is a single self-contained file. That matters for the same reason the
study build runs on Apps Script: a report somebody saved should still open years
later, whether or not this website still exists.

### 16.6 Checking and releasing

`build.py --check` rebuilds into memory and stops with an error if `gas/` or
`app/` differ from what `src/` produces. Run it before every release. It catches
the case where a generated file was edited directly.

Then: paste the seven files in `gas/` into the Apps Script project, and push
`app/` to the site.

There is no automated deployment, deliberately. Every study is a separate copy
under somebody else's Google account, and nothing should be able to change them
all at once.

The Sheet layout is not a build input. It is a declaration in the server code; see section 3.8.

Minification is not part of version 1. Compression over the network already
recovers most of what it would save, and the output in `gas/` is a file people
read and compare between releases. Revisit it only if a measured payload turns
out to be a problem.

---

## 17. Privacy and compliance

Timestamps are stored exactly as they happen. Dates are not shifted. Shifting
would break the dashboards, which are the reason a researcher can use this tool
without writing code.

The consequence is specific and needs to be in the protocol. Real dates with
coded participant IDs make this a **Limited Data Set** under HIPAA. Dates are
permitted in a Limited Data Set, but it requires a **data use agreement**. It is
not Safe Harbor de-identification, which forbids dates finer than a year.

Any earlier project note describing random per-study date offsets is out of date
and should be corrected before an IRB conversation.

Other points for review:

- The list linking Participant IDs to real people is kept in an approved system,
  never in Google.
- Participants do not sign in to Google and are not identified by the platform.
- The endpoint accepts writes and returns nothing readable.
- In the standalone build, no data reaches any server, and the Depression Center
  stores and holds nothing.
- A clinician who deploys their own copy takes on data custody, which the
  standalone build avoids entirely. The documentation must not present these as
  equally light choices, and an Information Assurance conversation is warranted
  before recommending the deployed option to a clinic.

Nothing here is a claim of HIPAA compliance. These are facts about the design for
a reviewer to weigh.

---

## 18. Deliberately not in version 1

Recorded here so they are not rediscovered as new ideas later.

**Cloud backup.** Google Drive or OneDrive, standalone build only. Drive is
workable from the browser with a narrow file-scoped permission and no secret;
Dropbox is workable the same way. File export covers the need for now.

**Device integrations.** Fitbit is the only major wearable that could work from a
browser, because its interface allows it and its sign-in flow does not need a
secret. Garmin requires an approved-partner arrangement and pushes data to a
server, and Whoop appears to need a secret that cannot exist in a browser. Those
users enter their diary by hand. Any integration would be standalone-build only,
because sign-in has to be registered against a fixed web address and a
researcher's own deployment does not have one. Before investing here, check
whether the Fitbit interface is still supported; its documentation has pointed at
a move to Google's health interfaces.

**Naps.** The published diary has an expanded version that asks about naps,
alcohol, caffeine, and medication. Version 1 ships the Core version only. Adding
naps means more than a question: a nap is a second sleep episode in a day, and the
sleep-day rule and the charts both assume one. See section 19.

**Pulling history back from the Sheet.** Ruled out. See section 7.

**A native phone app.** The plan is to prove the idea works first.

**Rendering reports through DataLaVista.** DataLaVista already keeps a report
definition — views, queries, widgets, layout — separate from the data it renders,
and it already accepts a report definition by URL. A shared MiNap report could
therefore become a two-part address: which report design and version to use,
given as the address of a JSON file, and the encrypted data itself. That would
give clinicians a far richer view than a hand-drawn chart, and would remove the
report layout from this project entirely.

Two things stand in the way for version 1. DataLaVista would need to accept data
passed in the address rather than fetched, and decrypt it in the browser. And a
report definition is larger than packed binary, which pushes against the size
limit in section 9.2. Worth revisiting once the sharing feature has real use.

---

## 19. Still to decide

- Permission to redistribute the Consensus Sleep Diary wording inside a
  GPL-licensed tool. Requested from the authors and not yet answered. Because the
  instrument is distributed freely for research and non-profit use, build on the
  assumption that permission is granted and file the reply when it arrives. If it
  is refused, only `display_text` changes: the workbook ships the question rows
  with wording left blank and the researcher pastes it from their own licensed
  copy. This does not block Phase 2. Cite Carney et al. wherever the questions
  appear.
- The exact iteration count for PIN hashing, measured against real Apps Script
  response times rather than estimated. Less pressing than it was: since section
  5.4, the PIN hash runs at login and at a PIN change, not on every write, so a
  higher count now costs a participant a moment once rather than a moment each
  time they touch the app. Do not raise it without measuring.
- Whether iOS Safari stores a non-extractable key the way desktop Chrome does,
  per section 5.6, and whether publishing a new version of a deployment changes
  the frame's origin and so orphans every participant's local copy. The desktop
  Chrome case is measured and passes; these two are not. The fallback is written
  and harmless either way.
- Whether the demo spreadsheet contains only made-up data. (Of course! No real data!)
- Measured payload sizes for a real 14-night report, to confirm the link and QR
  cap in section 9.2. (Could default to summary statistics, in a very compressed hex format, rather than the full data, to reduce size).
- Whether the bundled PDF library derives its encryption key from a secure random
  source, per section 9.4.
- Length of the share PIN.(Assume 5 digits, to match the notes PIN. This is a deterrent against casual sharing, not a secure channel. If possible, we may implement the emoji+digital hybrid PIN pad from FieldStationAI, which is more memorable and less likely to be guessed by a casual observer.)

---

## Conclusion

Version 1 is two applications from one codebase: a study version on Apps Script
that writes to the researcher's own Sheet, and a standalone installable app that
keeps everything on the device. Neither can turn into the other. The server
accepts writes and returns nothing. Researchers get four charts in the Sheet that
survive export to Excel; participants get charts in the app drawn without a
library.

`getHistory`, the function that once exposed participant diaries to anyone, is
gone. The Sheet schema in section 3 is built, and freezes once a study starts:
the three device-session columns in 3.3 are the last addition it takes, made
while nothing is deployed and nothing can be broken by making it.

What remains is section 12's participant-facing app -- the screens that call
`logMarker`, `logSurvey`, and `updateMarker` -- and section 16's standalone
build.

## Additional resources

- [MiNap Go repository](https://github.com/DepressionCenter/MiNap-Go)
- [MiNap Go technical overview](./overview.md)
- Carney CE, Buysse DJ, Ancoli-Israel S, Edinger JD, Krystal AD, Lichstein KL,
  Morin CM. [The consensus sleep diary: standardizing prospective sleep
  self-monitoring](https://pubmed.ncbi.nlm.nih.gov/22294820/). SLEEP
  2012;35(2):287-302. The source of the default question set
- [MiNap Go data dictionary](./data-dictionary.md)
- [MiNap Go version 1 implementation plan](./implementation-plan.md)
- [Sleep Data Automation repository](https://github.com/DepressionCenter/SleepDataAutomation)
  — the source of the `sleep_day` rule in section 4
- [EMA-CleanR repository](https://github.com/DepressionCenter/EMA-CleanR) — the
  analysis script a future converter would target
- [EMA-CleanR knowledge base article](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/14610/EMA-CleanR-Ecological-Momentary-Assessment-EMA-Data-Processing-in-R)
- [Sleep data automation for Fitbit](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/11822/Sleep-Data-Automation-for-Fitbit-Overview) — the sleep-day rule used here
- [MiNap, the original smartwatch sleep diary](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/10603/MiNap-Facilitating-Sleep-Medicine-Research-with-Smartwatch-Technology)
- [Google Apps Script documentation](https://developers.google.com/apps-script)
- [jsPDF, client-side PDF generation](https://github.com/parallax/jsPDF) —
  MIT-licensed; native password protection since version 2.5
- [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)

[⬅ Back to README](../README.md)

----
Copyright © 2026 The Regents of the University of Michigan