<!--
This file is part of MiNap Go.
README.md
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
- Access control - Only enrolled participants with valid IDs can log data

## Architecture

### System Flow

1. Participant opens web app URL and enters Study ID and Participant ID
2. App validates ID against Setup tab in Google Sheet
3. Participant taps Sleep or Wake button
4. Apps Script records timestamp to Google Sheet
5. Researcher reviews data in the Sheet

### Security

- Runs as the deploying researcher
- Data is stored in the researcher's own Google Drive
- Each study has its own Google Sheet
- Participant IDs must be pre-approved in Setup tab
- Participants can write data but cannot read or modify the Sheet directly. Sleep diary history that is vieweable by participants comes from the web app itself (browser cache), not the Sheet. That means if the participants clear their browser cache, log off from the app, or switch devices, they will lose access to their sleep diary history. The researcher can still view all data in the Sheet.

## Quick Start Guide

### Prerequisites
- A Google account

### Steps

1. Try the live demo: https://code.depressioncenter.org/MiNap-Go
2. Copy the template sheet: https://docs.google.com/spreadsheets/d/1oygo0kEPhFN6bKEcw8wE7RhUb_JM3K7jTiy6z6Hv8rg/copy
3. Go to Extensions > Apps Script > Deploy > New deployment > Web app
4. Set: Execute as = Me, Who has access = Anyone
5. Click Deploy and authorize (click Advanced > Go to MiNap Go if warned)
6. Open the web app URL once - Setup tab appears
7. Replace default Study ID and Participant IDs with yours. Only participant IDs listed in the Setup tab will be able to log in. Participant IDs should be randomized (not sequential) and not personally identifiable.
8. Share URL with participants

## Troubleshooting

### "Invalid Participant ID"
- Verify ID is in Setup tab list
- Check for typos (case-sensitive)

### Data Not Appearing
- Open web app URL once first
- Check Sheet is not read-only

### "Invalid Participant ID"
- Verify ID is in Setup tab list
- Check for typos (case-sensitive)

### Data Not Appearing
- Open web app URL once first
- Check Sheet is not read-only


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