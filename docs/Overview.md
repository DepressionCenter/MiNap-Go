<!--
This file is part of MiNap Go.
docs/overview.md
Author(s): Gabriel Mongefranco (@gabrielmongefranco), Abhiram V. (@abhiramvsmg)
Created: 2026-06-25
Last Modified: 2026-08-18
Summary: MiNap Go: a standalone, ready-to-run version of MiNap (sleep diary app for research) with no additional technology required. This file provides an overview of the project, in Markdown format.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

Licensed under the GNU Free Documentation License v1.3 or later.
See <https://www.gnu.org/licenses/fdl-1.3.html>. See README for full license information.

-->
![Eisenberg Family Depression Center](https://github.com/DepressionCenter/.github/blob/main/images/EFDCLogo_375w.png "depressioncenter.org")

# MiNap Go: Documentation and Quick Start Guide

## Overview

MiNap Go is a standalone, ready-to-run browser-based sleep diary for research studies. Participants tap Sleep or Wake, and each timestamped event is saved to a researcher-owned Google Sheet.

### Key Features

- No technology required to deploy - Runs as a Google Apps Script web app
- Privacy-first - Data lives in the researcher's own Google Drive
- Simple interface - Just two buttons: Sleep and Wake
- Timestamped events - Each tap records exact time
- Access control - Only participants the researcher has enrolled can log data

## Architecture

### System Flow

1. Participant opens web app URL, enters Study ID and Participant ID, and sets or enters a PIN
2. App checks the pair against the ParticipantsSetup tab in the Google Sheet, and the PIN against
   the hash stored there
3. Participant taps Sleep or Wake button, and answers the short morning diary
4. Apps Script computes which night each marker and survey belongs to and records it to the
   Google Sheet
5. Researcher reviews data, and the built-in charts, in the Sheet

The Sheet has a tab for each kind of data. For what every tab and column holds, read
[the data dictionary](./data-dictionary.md). For why it is built this way, read
[the architecture specification](./architecture.md).

**Planned.** Steps 1 through 4 above describe what the server now accepts and stores; the
server functions behind them (`setPin`, `verifyPin`, `logMarker`, `logSurvey`, `updateMarker`)
are built and covered by the data dictionary. The participant-facing screens that call them —
the Sleep and Wake buttons, the morning diary, and the PIN entry screen — are the next piece of
work and are not wired up yet. Use the last released copy for a live study until that work
lands.

### Security

- Runs as the deploying researcher
- Data is stored in the researcher's own Google Drive
- The app asks for access to the one spreadsheet it is attached to, not to your Drive
- Each study has its own Google Sheet
- Participants must be listed on the ParticipantsSetup tab before they can log in, and a study ID from one study will not work in another
- A participant also needs the PIN they chose at enrollment. The server checks it before accepting any submission, which is what stops someone logging entries under a Participant ID that is not theirs, and it locks the account after too many wrong guesses in a row
- Participants can write data but cannot read or modify the Sheet directly. Sleep diary history that is vieweable by participants comes from the web app itself (browser cache), not the Sheet. That means if the participants clear their browser cache, log off from the app, or switch devices, they will lose access to their sleep diary history. The researcher can still view all data in the Sheet.

## Quick Start Guide

### Prerequisites
- A Google account

### Steps

1. Try the live demo: https://code.depressioncenter.org/MiNap-Go
2. Copy the template sheet: https://docs.google.com/spreadsheets/d/1oygo0kEPhFN6bKEcw8wE7RhUb_JM3K7jTiy6z6Hv8rg/copy
3. Go to Extensions > Apps Script > Deploy > New deployment > Web app
4. Set: Execute as = Me, Who has access = Anyone
5. Click Deploy and authorize (click Advanced > Go to MiNap Go if warned).

   MiNap Go asks for one permission: to see and edit **the spreadsheet it is attached to**, and no other. It cannot open, read, or change any other file in your Drive. If the screen you see asks for more than that, stop and tell the Mobile Technologies Core.
6. Open the web app URL once. The app creates the rest of the tabs it needs, writes the link to share into cell A10 of the README tab, and shows you a setup page with a link straight to the spreadsheet. This happens once, so later opens are fast and participants never see that page.
7. Add a row to the ParticipantsSetup tab for each participant: your Study ID, their Participant ID, and `Yes` in the `enabled` column. Participant IDs should be randomly assigned, not sequential, and never a name, initials, a date of birth, or a medical record number.
8. Share URL with participants

## Troubleshooting

### "Invalid Participant ID"

- Check that the Study ID and the Participant ID both appear on the same row of the ParticipantsSetup tab. They are checked together.
- Check that the `enabled` column on that row says `Yes`. A blank cell does not grant access.
- Check for typos.

### Data Not Appearing

- Open the web app URL once first, so the tabs are created.
- Check the Sheet is not read-only.

### A tab is missing, or was deleted by mistake

The app builds the tabs once and then stops checking, so deleting one does not bring it
back on the next page load. To rebuild it: open **Extensions > Apps Script**, choose
`ensureWorkbook_` from the function list, and click **Run**. It creates whatever is
missing and leaves every existing tab alone.

### "This sleep diary is not ready yet"

The app found a tab whose columns are not the ones it expects, and stopped rather than
writing into it. Nothing was changed. The message names the tab and the column. Put that
header back, or start a new study from a fresh copy of the template.


## Contributing
All contributions are welcome! If you would like to contribute code or documentation to MiNap Go, please follow these steps:
- Fork the repository, make changes, test them locally, and submit pull requests.
- If using an AI coding assistant, tell it to read `AGENTS.md` first. Please ensure that the code is reviewed and tested before submission.

We also welcome your feedback and suggestions for improving MiNap Go. Please [submit issues or feature requests](https://github.com/DepressionCenter/MiNap-Go/issues) on the GitHub repository.


### Code maintenance notes
+ This repository is the source of truth for the code. `src/` is where it is written; a local `build.py` script packages it into `gas/` (what gets pasted into the template's bound Apps Script project) and `app/` (what the site serves). There is still no clasp project, no API key, and no automated deployment -- releases are hand-synced by copying `gas/` into the Apps Script project.
+ **Once deployed, the script is independent of this repository.** Changes to the code here will not affect any deployed copies of MiNap Go. To update a deployed copy, you must manually copy the new code into the bound Apps Script project and redeploy it. This ensures that each study's data remains private and secure, and that the researcher has full control over when and how to update their deployed copy of MiNap Go.

## Contact

Mobile Technologies Core: efdc-mobiletech@umich.edu

[⬅ Back to README](https://github.com/DepressionCenter/MiNap-Go/)

---

Copyright © 2026 The Regents of the University of Michigan