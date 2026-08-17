<!--
This file is part of MiNap Go
docs/implementation-plan.md
Author(s): Gabriel Mongefranco
Created: 2026-08-17
Last Modified: 2026-08-17
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
- Split the repository into `src/`, `gas/`, and `app/`, with `build.js` producing
  the two outputs from the one core.
- Move the existing root `index.html` to `demo/`.
- Write a new root landing page: what the app is, a way into `/app/`, and a
  section for researchers linking to the demo and the setup guide.
- Confirm the spreadsheet embedded in the demo holds only invented data.

**Done when** the security fix is deployed to the demo, the build produces both
outputs from one source, and the three pages load.

---

## Phase 2 — The Sheet and the server

Everything here is permanent. A deployed copy never receives an update, so a
column added later has to be added by hand in every researcher's Sheet.

**Deliverables**

- The template Sheet with all tabs: Instructions, Setup, Participants, Questions,
  SleepDiary, EMA, Dashboard, `_calc`.
- All twenty `EMA_` columns, even though eight are used. All Questions columns,
  including the ones only the standalone build reads.
- The Consensus Sleep Diary Core questions as defaults, numbered to match the
  instrument.
- Server functions: `validateLogin`, `setPin`, `verifyPin`, `getConfig`,
  `logMarker`, `logSurvey`, `updateMarker`. No function returns diary data.
- PIN storage with a per-participant random salt, and a lockout counter.
- `schema_version` written and checked.

**Done when** a new Sheet builds its own tabs on first open, a participant can be
added and can set a PIN, a marker and a survey both land in the right tabs, and a
wrong PIN locks the account after the set number of tries.

**Check before moving on:** ask the server for data as an unauthenticated caller
and confirm nothing readable comes back. Try to edit another participant's row by
guessing a record ID and confirm it is refused.

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
- **Accessibility is part of each phase**, not a pass at the end. Keyboard
  traversal, visible focus, 200% zoom, and a screen reader on the main flow.
- The open questions in section 19 of the specification should be answered before
  the phase that depends on them. The Consensus Sleep Diary permission question
  blocks Phase 2.

---

## Conclusion

Phase 1 is the only one with a deadline, because the current deployment exposes
participant data. After that the order protects you from rework: the data shape
is settled before anything reads it, and the shared behavior is built before the
parts that only one build has.

Start with the Phase 1 prompt in the repository root, and read the architecture
specification before writing anything.

## Additional resources

- [MiNap Go architecture and version 1 specification](./architecture.md)
- [Agent instructions for this repository](../AGENTS.md)
- [MiNap Go technical overview](./Overview.md)
- [MiNap Go repository](https://github.com/DepressionCenter/MiNap-Go)

[⬅ Back to README](../README.md)
