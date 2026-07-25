<!--
This file is part of MiNap Go.
KB-ARTICLE-MiNap-Go.md
Author(s): Gabriel Mongefranco
Created: 2026-07-25
Summary: Knowledge base article for MiNap Go.
Copyright 2026 The Regents of the University of Michigan
GNU General Public License v3.0
-->

# MiNap Go - Knowledge Base Article

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

1. Participant opens web app URL and enters Participant ID
2. App validates ID against Setup tab in Google Sheet
3. Participant taps Sleep or Wake button
4. Apps Script records timestamp to Google Sheet
5. Researcher reviews data in the Sheet

### Security

- Runs as the deploying researcher
- Each study has its own Google Sheet
- Participant IDs must be pre-approved in Setup tab

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
7. Replace default Study ID and Participant IDs with yours
8. Share URL with participants

## Troubleshooting
<!--
This file is part of MiNap Go.
KB-ARTICLE-MiNap-Go.md
Author(s): Gabriel Mongefranco
Created: 2026-07-25
Summary: Knowledge base article for MiNap Go.
Copyright 2026 The Regents of the University of Michigan
-->

# MiNap Go - Knowledge Base Article

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

1. Participant opens web app URL and enters Participant ID
2. App validates ID against Setup tab in Google Sheet
3. Participant taps Sleep or Wake button
4. Apps Script records timestamp to Google Sheet
5. Researcher reviews data in the Sheet

### Security

- Runs as the deploying researcher
- Each study has its own Google Sheet
- Participant IDs must be pre-approved in Setup tab

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
7. Replace default Study ID and Participant IDs with yours
8. Share URL with participants

## Troubleshooting

### "Invalid Participant ID"
- Verify ID is in Setup tab list
- Check for typos (case-sensitive)

### Data Not Appearing
- Open web app URL once first
- Check Sheet is not read-only

## Contact

efdc-mobiletech@umich.edu
### "Invalid Participant ID"
- Verify ID is in Setup tab list
- Check for typos (case-sensitive)

### Data Not Appearing
- Open web app URL once first
- Check Sheet is not read-only

## Contact

efdc-mobiletech@umich.edu
