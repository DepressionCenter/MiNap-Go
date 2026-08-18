<!--
This file is part of MiNap Go
docs/implementation-plan.md
Author(s): Gabriel Mongefranco
Created: 2026-08-17
Last Modified: 2026-08-18
Summary: Five-phase build plan for MiNap Go version 1, with what each phase delivers and how to tell it is finished.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan
Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.
-->

# MiNap Go

## Version 1 Implementation Plan

[⬅ Back to README](../README.md)

This page breaks the version 1 build into five phases. Each one ends with
something you can open and check, and each depends only on the phases before it.
The design it implements is in [the architecture
specification](./architecture.md); this page does not repeat those decisions, it
sequences them.

The order is not arbitrary. Phase 1 closes a live security hole and puts the
build structure in place, so nothing after it has to be moved. Phase 2 freezes the
data shape, which cannot change once studies exist. Phases 3 to 5 add behavior on
top of a fixed foundation.

---

## Phase 1 — Close the hole, lay the foundation

The one phase with real urgency.

**Deliverables**

- Remove `getHistory` from `Code.gs`. It runs on the server and returns a
  participant's diary to anyone who knows a Study ID and Participant ID, both of
  which are published in the repository. Rename `include` to `include_`.
- Split the repository into `src/`, `gas/`, and `app/`, following the seven-file
  separation in section 16.2 of the specification. `build.py` packages `src/`
  into the other two, using only Python's standard library.
- Commit both outputs. `app/` is what the site serves; `gas/` is what a person
  pastes. Mark every generated file as generated.
- Add `build.py --check`, which rebuilds into memory and fails if the committed
  output does not match the source.
- Move the existing root `index.html` to `demo/`.
- Write a new root landing page: what the app is, a way into `/app/`, and a
  section for researchers linking to the demo and the setup guide.
- Confirm the spreadsheet embedded in the demo holds only invented data.
- **Update the existing documentation in the same change.** The README tells
  developers to copy four specific files out of `src/`; after this phase they copy
  seven files out of `gas/`, and `src/` is source that is never pasted. The code
  maintenance note in `docs/overview.md` says there is no build step, which stops
  being true. Both are instructions somebody will follow, so leaving them stale
  is a defect, not a tidy-up.
- Keep the manual deployment steps in the README, aimed at developers. Researchers
  are still told to copy the template Sheet, but the copy-and-paste route has to
  stay documented and correct.

**Done when** the security fix is deployed to the demo, `build.py` produces both
outputs from one source, `--check` passes on a clean tree, the three pages load,
and somebody can follow the README's manual steps end to end without hitting a
path that no longer exists.

---

## Phase 2 — The Sheet and the server

Everything here is permanent. A deployed copy never receives an update, so a
column added later has to be added by hand in every researcher's Sheet.

**Task 1 — the layout declaration. Done, and now needs reworking.**

`WORKBOOK` at the top of `src/server/Code.gs` declares the tabs, their columns and
notes, the question rows, the Dashboard filter cells, and the four fixed `_calc`
blocks. The structure is right and stays. What it declares has changed: survey
data is now two long tabs rather than one wide one, and question IDs are `Q01`
onward rather than `EMA_01` onward. See section 3.6 of the specification.

**Task 1a — bring the declaration in line with the revised schema**

- Replace the `EMA` tab with `Surveys` and `SurveyAnswers`, per section 3.6. Drop
  `emaAnswerColumns_` and the twenty answer columns with it.
- Rename question IDs from `EMA_01`–`EMA_20` to `Q01`–`Q20`. Change
  `questionId_` and the default rows together.
- Add `required` to QuestionsSetup, defaulting to `No` on every shipped question.
- Add `datetime` to `ANSWER_TYPES` and rename `binary` to `boolean`.
- Point the `_calc` questions block at `SurveyAnswers` with `AVERAGEIFS` and
  `COUNTIFS` over `question_id`, instead of at twenty answer columns.
- Retire what the declaration replaces: `SHEET_NAME`, `SETUP_SHEET`, `HEADERS`,
  the `SETUP_COL_*` constants, `DEFAULT_STUDY_ID`, `DEFAULT_PARTICIPANT_IDS`,
  `ensureSetupSheet_`, and `ensureSheet_` still describe the three-column Setup tab
  from version 0. `ensureSheet_` also calls `sh.clear()` on a header mismatch,
  which section 3.9 forbids. Two layouts in one file is how a workbook ends up
  with both.
- Fix the build before anything else in this phase. `build.py` reads
  `src/index.html`; the file is committed as `src/Index.html`. That works on a
  case-insensitive filesystem and fails everywhere else, so `--check` cannot run
  on Linux today. Rename the file, keep the header's own filename line in step,
  and confirm `--check` passes.

**Remaining deliverables**

- One function that walks `WORKBOOK` and creates what is missing: StudySettings,
  QuestionsSetup, ParticipantsSetup, SleepDiary, Surveys, SurveyAnswers,
  Dashboard, `_calc`. It also writes the live web app link into the one cell
  reserved for it on the README tab.
- The four charts, created by the same pass using the Apps Script chart builder,
  against a `_calc` tab whose size is fixed in the declaration.
- Provisioning that never clears a tab. It creates what is missing and stops with
  a clear message if it finds a shape it does not recognise. Losing a researcher's
  participant list or their charts to a header mismatch is not acceptable.
- `sleep_day` filled in by the server for both marker types, including the lookup
  that pairs a WAKE to its SLEEP and the recompute when an edit moves a marker
  across noon. Transcribe the rule from the Sleep Data Automation exactly, in
  local time, anchored on sleep onset. Section 4 has both forms side by side.
- A rewritten README tab for the template Sheet. The current text describes a
  three-column Setup tab and no PIN step.
- All QuestionsSetup columns, including the ones only the standalone build reads,
  and all twenty question rows.
- The full timestamp set on both survey tabs: survey opened, ended, and its
  reason, and per answer the answered time, the last edit, the edit count, and the
  time taken. None of these can be recovered after the fact.
- `question_text_shown` written onto every SurveyAnswers row.
- One spelling for every yes-or-no column, per section 3.10: `Yes` and `No` written,
  and `0`/`1`, real booleans, and any casing of the words accepted on read.
- The Consensus Sleep Diary Core questions as defaults, numbered to match the
  instrument, with the free-text comments item left out and the instrument credited
  in the README.
- Server functions: `validateLogin`, `setPin`, `verifyPin`, `getConfig`,
  `logMarker`, `logSurvey`, `updateMarker`. No function returns diary data.
  `logSurvey` writes the Surveys row and its SurveyAnswers rows inside one lock,
  so neither can exist without the other. It accepts a survey with no answers, and
  records why.
- PIN storage with a per-participant random salt, and a lockout counter.
- `schemaVersion` in the declaration, written into StudySettings on creation and
  checked on later opens, so a Sheet built by an older version is detected rather
  than silently written to.
- Documentation updated with the tabs, the columns, and what a researcher edits by
  hand. A manual deployment into a blank Sheet now gets everything, charts
  included, so the developer route and the template route end in the same place.

**Done when** a copy of the template with only its README tab builds every other
tab and all four charts on first open, a participant can be added and can set a
PIN, a marker and a survey land in the right tabs with matching `sleep_day`
values, a skipped survey leaves a Surveys row and no answer rows, and a wrong PIN
locks the account after the set number of tries.

**Check the sleep day rule against the automation.** Take a bedtime at 11:59,
another at 12:01, and one at 01:30, and confirm all three land on the day the
Power Query step in section 4 would give. This is the join key between three tabs
and it is anchored on local time, so a UTC reading passes casual inspection and is
wrong for every participant west of Greenwich.


---

## Phase 3 — The app people actually use

One core, running in both builds.

**Deliverables**

- Local storage in IndexedDB, encrypted, with the login PIN unwrapping the key in
  the study build.
- Sleep and wake markers, with unambiguous button labels and instructions.
- The morning diary, with items 2 and 6 pre-filled from the markers and editable.
- Question rendering for every answer type, including the 1-to-10 slider and its
  four rules.
- The seven-day edit window for markers; add-missing-only for surveys.
- The offline queue, and the rule that a rejected ID is never retried.
- Times stored as real local times with an offset.
- Fix `.btn-primary`'s contrast in `styles.css`. White text on its
  violet-to-indigo gradient measures about 4.27:1 at the violet end -- under the
  4.5:1 AA threshold that applies here, since the button's 16px bold label is
  normal text, not large text. Used by the login "Start" button and the edit-time
  "Save" button. The landing page's equivalent button already uses a solid color
  instead of this gradient for the same reason; carry that fix into the app.

**Done when** a participant can log a night end to end, offline and online, on a
phone, and the values in the Sheet match what they typed.

---

## Phase 4 — Making the data visible

Both audiences get their charts, and the data can leave.

**Deliverables**

- The `_calc` tab and the four researcher charts, with the participant filter.
- Derived measures: time in bed, total sleep time, sleep efficiency, latency,
  wake after sleep onset.
- Client charts drawn as SVG, each with a toggle to a plain data table.
- CSV export for both tables, with `record_id` and the formula-injection guard.
- The encrypted backup file, and import that merges by record ID and never
  deletes.
- Backup reminders: fifteen days in the study build, thirty in the standalone.

**Done when** the workbook downloads as `.xlsx`, opens in Excel with every chart
and formula intact, and an export from one device imports cleanly into another.

---

## Phase 5 — The standalone app

Everything that only exists where there is no researcher.

**Deliverables**

- Service worker, manifest, install prompts for both platforms, and the request
  for persistent storage.
- The update flow, and the three rules that protect stored data.
- Choosing which questions to answer, and up to five personal ones.
- The private notes vault.
- Sharing: the link, the code, the file for longer histories, and the share PIN.
- PDF export, password-protected by default.

**Done when** the app installs on a phone, works with no connection, and a report
opens on a different device with the PIN.

**Check before release:** confirm the PDF library derives its key from a secure
random source. If it does not, describe the PDF password as a deterrent rather
than as encryption.

---

## Working notes

- **Verify each phase before starting the next.** Nothing here is hard to build
  and easy to test later; several parts are the reverse.
- **Freeze after Phase 2.** If a column has to change after that, it is cheaper to
  change it before any study starts than to ask researchers to edit their Sheets.
- **Documentation is part of each phase.** Any phase that changes a step somebody
  follows updates the README and `/docs` in the same change set. Stale
  instructions are a defect.
- **Accessibility is part of each phase**, not a pass at the end. Keyboard
  traversal, visible focus, 200% zoom, and a screen reader on the main flow.
- The open questions in section 19 of the specification should be answered before
  the phase that depends on them. The Consensus Sleep Diary permission question no
  longer blocks Phase 2: build on the assumption that permission is granted, since
  only `display_text` changes if it is refused.

---

## Conclusion

Phase 1 is high priority, and now completed. Phase 2 needs task 1a, also high priority, as it brings the schema into alignment with changes decided after the original plan had already started.

## Additional resources

- [MiNap Go architecture and version 1 specification](./architecture.md)
- [MiNap Go data dictionary](./data-dictionary.md)
- [Agent instructions for this repository](../AGENTS.md)
- [MiNap Go technical overview](./overview.md)
- [MiNap Go repository](https://github.com/DepressionCenter/MiNap-Go)

[⬅ Back to README](../README.md)

----
Copyright © 2026 The Regents of the University of Michigan