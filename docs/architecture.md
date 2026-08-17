<!--
This file is part of MiNap Go
docs/architecture.md
Author(s): Gabriel Mongefranco
Created: 2026-08-17
Last Modified: 2026-08-17
Summary: Version 1 architecture specification for MiNap Go: the two build targets, the Google Sheet schema, participant authentication, dashboards, and the decisions behind them.
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

Version 1 has not been built yet. This page is the plan. Anything already working
in the repository is marked as such; everything else is a specification.

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
/                 Landing page: what the app is, install button, researcher section
/app/             Standalone build (app shell, service worker, manifest)
/demo/            The existing study-build demo page
```

The current `index.html` at the repository root is the study-build demo. It moves
to `/demo/` unchanged. The new root page describes the project, sends members of
the public to `/app/`, and sends researchers to `/demo/` and the setup guide.

The service worker registers with a scope of `/app/`, so it never caches the
landing page or the demo.

**Before this ships:** the demo page embeds a live web app URL and a live
spreadsheet ID. Confirm that spreadsheet contains only made-up data, because the
new landing page will send more people to it.

---

## 3. The Google Sheet

One Sheet per deployment. It may hold more than one study.

### 3.1 Tabs

| Tab | What it holds | Who writes it |
|---|---|---|
| Instructions | Setup steps and the shareable app URL | The app writes the URL; the rest is fixed text |
| Setup | Study settings, schema version, dashboard filter | Researcher |
| Participants | The list of who may log in, and their PIN records | Researcher adds rows; the app writes PIN fields |
| Questions | The daily survey | Researcher |
| SleepDiary | Sleep and wake markers | The app |
| EMA | Daily survey responses | The app |
| Dashboard | Four charts | Formulas only |
| \_calc | Hidden helper tables for the charts | Formulas only |

### 3.2 Setup

| Field | Notes |
|---|---|
| `schema_version` | Set by the app. Lets a future version detect an old Sheet and refuse to write to it |
| `questions_locked` | Set to `TRUE` automatically on the first survey submission |
| `questions_locked_at` | Timestamp of the above |
| `edit_window_days` | Defaults to 7 |
| `backup_reminder_days` | Defaults to 15 |
| `dashboard_filter` | `ALL`, or a single Participant ID |

### 3.3 Participants

One row per participant per study.

| Column | Notes |
|---|---|
| `study_id` | Researcher-set |
| `participant_id` | Randomly assigned, never a name or a medical record number |
| `enabled` | `YES` or `NO`. Set to `NO` to revoke access without deleting data |
| `pin_hash` | Written by the app when the participant first sets a PIN |
| `pin_salt` | Random, one per participant |
| `pin_set_at` | Timestamp |
| `failed_attempts` | Counter, reset on a correct PIN |
| `locked` | `TRUE` after too many failures |

Multiple studies live in one Sheet by putting different values in `study_id`. A
Participant ID leaked from one study cannot be used in another, because login
checks the pair.

### 3.4 Questions

Twenty rows, always present. The first ten hold the recommended sleep questions;
the rest are spare.

| Column | Notes |
|---|---|
| `question_id` | `EMA_01` through `EMA_20`. Fixed forever |
| `display_text` | The wording the participant sees |
| `answer_type` | See the table below |
| `min_value`, `max_value` | For `scale`, `ordinal`, `count`, and `duration_minutes` |
| `input_style` | `slider`, `buttons`, or `stepper`. See section 3.4.3 |
| `min_label`, `max_label` | End labels, for example "Not at all" and "Extremely" |
| `unit` | Stored unit, shown to anyone reading the raw data |
| `prefill_from` | `SLEEP_MARKER`, `WAKE_MARKER`, or empty |
| `visible` | `YES` or `NO` |
| `sort_order` | Display order |

Answer types:

| `answer_type` | Stored as | Example |
|---|---|---|
| `time` | Local date and time, ISO 8601 with offset. See section 4.1 | `2026-08-16T23:30-04:00` |
| `duration_minutes` | Whole minutes | `55` |
| `count` | Whole number | `3` |
| `ordinal` | Whole number, 1 upward, with fixed labels | `2` for "Poor" |
| `scale` | Whole number between min and max | `7` |
| `binary` | `0` or `1` | `1` |

### 3.4.1 The default question set

Version 1 ships the Consensus Sleep Diary, Core version (Carney et al., 2012),
which is the standard daily sleep diary used in insomnia research. Using it means
results can be compared with other studies instead of being trapped in this tool.

Question numbers match the instrument's own item numbers, so `EMA_03` is item 3.
Keep it that way permanently; it makes the Sheet readable without a codebook.

| ID | Item | `answer_type` | Prefilled |
|---|---|---|---|
| `EMA_01` | What time did you get into bed? | `time` | No |
| `EMA_02` | What time did you try to go to sleep? | `time` | From the SLEEP marker |
| `EMA_03` | How long did it take you to fall asleep? | `duration_minutes` | No |
| `EMA_04` | How many times did you wake up, not counting your final awakening? | `count` | No |
| `EMA_05` | In total, how long did these awakenings last? | `duration_minutes` | No |
| `EMA_06` | What time was your final awakening? | `time` | From the WAKE marker |
| `EMA_07` | What time did you get out of bed for the day? | `time` | No |
| `EMA_08` | How would you rate the quality of your sleep? | `ordinal`, 1–5, Very poor to Very good | No |

`EMA_09` through `EMA_20` are empty and available to the researcher.

**Two items from the published instrument are deliberately left out.**

- The free-text comments box. Participants type identifying details into open
  fields — names, appointments, places, diagnoses — and every one of those would
  land in the researcher's Sheet. Leaving it out removes the risk rather than
  managing it. Participants who want to write things down have the private notes
  feature in section 6, which never leaves the device.
- The medication question from the expanded versions, for the same reason: it asks
  for a written list, and medication is health information.

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
of bed is a separate, later moment, asked as item 7. If participants tap WAKE when
they get up instead, item 6 and item 7 collapse into one and sleep efficiency is
wrong for the whole study. Say this in the participant instructions, not only on
the buttons.

**Nothing here may change after a study starts.** Deployed copies of the app
cannot be updated, so changing a question's wording mid-study produces two
different questions sharing one column, and no way to tell the rows apart later.

Two safeguards, since the researcher can always edit a cell:

- `questions_locked` turns on at the first survey submission. The app shows a
  clear warning if the Questions tab is edited afterwards.
- Every EMA row stores a `question_set_hash`: a short fingerprint of the visible
  question IDs and their wording. If wording does change, the affected rows are
  identifiable during analysis instead of silently mixed together.

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

### 3.5 SleepDiary

One row per marker.

| Column | Notes |
|---|---|
| `record_id` | Unique ID generated on the device |
| `study_id`, `participant_id` | |
| `marker` | `SLEEP` or `WAKE` |
| `ts_utc` | ISO 8601 in UTC. The one true timestamp |
| `ts_local` | ISO 8601 with the local offset |
| `tz` | IANA zone name, for example `America/Detroit` |
| `sleep_day` | See section 4 |
| `edited` | `TRUE` if the participant corrected the time |
| `created_at_utc`, `updated_at_utc` | |
| `app_version` | |

This replaces the five overlapping time fields in the current code. Three fields
is the smallest set that survives daylight saving time and travel.

### 3.6 EMA

One row per completed survey, matching the layout the EMA-CleanR analysis script
expects.

| Column | Notes |
|---|---|
| `participantidentifier` | Spelled this way for EMA-CleanR. Note it differs from `participant_id` in SleepDiary |
| `surveyname` | `<STUDY_ID>_sleep_diary`, for example `STUDY1_sleep_diary` |
| `start_datetime` | When the participant opened the survey |
| `end_datetime` | When they submitted it |
| `EMA_01` … `EMA_20` | One column per question, always all twenty |
| `question_set_hash` | See section 3.4 |
| `sleep_day` | See section 4 |

EMA-CleanR requires only `participantidentifier`, `surveyname`,
`start_datetime`, and `end_datetime`, and picks up questions by the `EMA_`
prefix. Extra columns are ignored, so the trailing columns are safe.

Putting the Study ID inside `surveyname` keeps the file usable by EMA-CleanR
without an extra column. The `_sleep_diary` suffix leaves room for a second daily
survey later, which matters because `surveyname` is how EMA-CleanR groups rows.

`sleep_day` on the EMA tab is **not** the same as EMA-CleanR's `start_day`.
`start_day` describes when the survey was answered. `sleep_day` describes which
night it belongs to, so sleep and survey data can be joined or charted together.

### 3.7 Freeze the schema now

A deployed copy of MiNap Go never receives an update. Adding a column later means
every researcher edits their own Sheet by hand. So version 1 creates every column
it will plausibly need, including all twenty `EMA_` columns even though ten are
shown. Empty columns cost nothing.

---

## 4. Sleep day

A night that starts at 01:30 belongs to the previous calendar day. Every summary
uses this rule, applied to the moment sleep starts:

```
if hour(sleep_start_local) < 12:
    sleep_day = date(sleep_start_local) - 1 day
else:
    sleep_day = date(sleep_start_local)
```

This matches the convention used in the Depression Center's Fitbit sleep data
automation, so numbers from the two tools line up.

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

**EMA-CleanR will not handle these columns.** It is built for rating-scale items
and will treat a timestamp as a rating. That is not a fault in the script; a
clock time is a different kind of quantity. A researcher using EMA-CleanR should
leave the time questions out of that analysis and use the Sheet dashboards for
them. This is the right trade: the raw data stays true to what the participant
said, and one downstream tool skips four columns.

Durations and counts (items 3, 4, and 5) are ordinary whole numbers and need none
of this.

### 4.2 Derived measures

Computed in `_calc` and in the app, never stored, so a change to the formula
cannot leave old rows behind:

| Measure | Formula |
|---|---|
| Time in bed | item 7 − item 1 |
| Sleep onset latency | item 3 |
| Wake after sleep onset | item 5 |
| Total sleep time | (item 6 − item 2) − item 3 − item 5 |
| Sleep efficiency | total sleep time ÷ time in bed, as a percentage |

Sleep efficiency is the usual primary outcome in insomnia work, and it needs
items 1 and 7. That is why the diary asks for getting into bed and getting out of
bed even though the markers already give sleep and wake times.

---

## 5. Participant login and PINs

Only the study build has a login. The standalone build has no server to check
anything against.

### 5.1 Setting a PIN

The researcher adds a Participant ID to the Participants tab. Nothing else.

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

The PIN unlocks the key that encrypts the participant's local copy of their data.
Entering it decrypts the profile; a wrong PIN cannot read anything. This works
offline, and a lost phone does not leak a diary.

The server also checks the PIN before accepting a write, which is what stops
someone from logging entries under another participant's ID.

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

### 5.4 Resetting a PIN destroys the local copy

Clearing the PIN throws away the key to the encrypted local data, so the
participant's history on that device becomes unreadable. In a study this is
acceptable: the Sheet holds the record. Say so in the participant instructions.

Private notes are unaffected. See section 6.

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
| `validateLogin` | Whether the login is valid, and whether a PIN is set |
| `setPin` | Success or failure |
| `verifyPin` | Success, failure, or locked |
| `getConfig` | Question list, edit window, backup reminder interval |
| `logMarker` | Confirmation only |
| `logSurvey` | Confirmation only |
| `updateMarker` | Confirmation only |

No function returns diary or survey data.

### Fix required before anything else

The current `Code.gs` contains `getHistory`, which reads the Sheet and returns a
participant's rows to the browser. It runs on Google's servers under the
researcher's authorization, not in the browser. Because the deployment is open to
anyone and the sample IDs are published in the repository and the setup guide,
anyone can retrieve a participant's diary today.

Delete it. Also rename `include` to `include_` so it is not callable; it returns
project file contents, which is harmless with public source but is needless
exposure.

There is no read path in version 1, not even one protected by a PIN. Recovery
happens through file export and import instead.

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
| `minap-surveys-<date>.csv` | The EMA columns from section 3.6 |

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
/app/report.html#<encrypted blob>
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

Adding a survey after the fact needs care. `start_datetime` and `end_datetime`
must record when the participant actually answered, with the night it refers to
carried in `sleep_day`. Otherwise completion rates look better than they were.
Cap how far back a missing survey may be added, or participants will fill in two
weeks the night before their final visit.

---

## 11. Researcher dashboards, in the Sheet

Four charts on a Dashboard tab, driven by a single filter cell in Setup holding
either `ALL` or one Participant ID.

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

Put a hidden `_calc` tab between the data and the charts. It holds a fixed
14-row date list, a fixed 20-row question list, and the aggregate formulas. Charts
point at `_calc`, never at the raw data. Clock times are stored as real times
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

## 14. Privacy and compliance

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

## 15. Still to decide

- Permission to redistribute the Consensus Sleep Diary wording inside a
  GPL-licensed tool. It is distributed freely by its authors and widely used, but
  the exact reuse terms need confirming before the wording ships as a default.
  Cite Carney et al. wherever the questions appear.
- Whether the sleep specialist meant the Core version or an expanded one. Naps are
  an expanded-version item, not a Core one, and adding them changes the question
  set that gets frozen.
- How far back a missing survey may be added.
- The exact iteration count for PIN hashing, measured against real Apps Script
  response times rather than estimated.
- Whether the demo spreadsheet contains only made-up data.
- Measured payload sizes for a real 14-night report, to confirm the link and QR
  cap in section 9.2.
- Whether the bundled PDF library derives its encryption key from a secure random
  source, per section 9.4.
- Length of the share PIN. Longer is safer, but the person has to say it out loud.

---

## Conclusion

Version 1 is two applications from one codebase: a study version on Apps Script
that writes to the researcher's own Sheet, and a standalone installable app that
keeps everything on the device. Neither can turn into the other. The server
accepts writes and returns nothing. Researchers get four charts in the Sheet that
survive export to Excel; participants get charts in the app drawn without a
library.

The most urgent item is section 7: `getHistory` currently exposes participant
diaries to anyone and should be removed before anything else is built. After
that, the Sheet schema in section 3 should be frozen, because deployed copies
cannot be updated later.

## Additional resources

- [MiNap Go repository](https://github.com/DepressionCenter/MiNap-Go)
- [MiNap Go technical overview](./Overview.md)
- Carney CE, Buysse DJ, Ancoli-Israel S, Edinger JD, Krystal AD, Lichstein KL,
  Morin CM. [The consensus sleep diary: standardizing prospective sleep
  self-monitoring](https://pubmed.ncbi.nlm.nih.gov/22294820/). SLEEP
  2012;35(2):287-302. The source of the default question set
- [EMA-CleanR repository](https://github.com/DepressionCenter/EMA-CleanR) — the
  survey data format used by the EMA tab
- [EMA-CleanR knowledge base article](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/14610/EMA-CleanR-Ecological-Momentary-Assessment-EMA-Data-Processing-in-R)
- [Sleep data automation for Fitbit](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/11822/Sleep-Data-Automation-for-Fitbit-Overview) — the sleep-day rule used here
- [MiNap, the original smartwatch sleep diary](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/10603/MiNap-Facilitating-Sleep-Medicine-Research-with-Smartwatch-Technology)
- [Google Apps Script documentation](https://developers.google.com/apps-script)
- [jsPDF, client-side PDF generation](https://github.com/parallax/jsPDF) —
  MIT-licensed; native password protection since version 2.5
- [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)

[⬅ Back to README](../README.md)