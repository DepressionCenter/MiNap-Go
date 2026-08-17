# MiNap Go — Architecture & Design

Browser-based sleep diary for research studies and clinical self-tracking. One codebase, two deployment targets, zero infrastructure beyond Google Apps Script and GitHub Pages.

## Design principles

1. Dead-simple setup for researchers, clinicians, and participants. No servers, no accounts to administer, no app stores.
2. Data location follows compliance context: research data rests in the study's own Sheet; clinic data never leaves the patient's device.
3. The same client code ships everywhere. Platform differences are confined to a thin shell and a build step.
4. Optional features (third-party integrations) are physically absent from builds that must not have them, not merely disabled.

## Components (single repo)

| Component | Path | Contents |
|---|---|---|
| Core client | `src/core.js`, `src/ui.html`, `src/styles.css` | All app logic: diary UI, questionnaire engine, localStorage layer, offline entry queue, migrations, report generator, share-link crypto, export/import, notes vault, plugin registry (inert stub) |
| Apps Script package | `gas/` | GAS shell (`google.script.run` transport), `Code.gs` (`doGet`, write-only `submitEntry`, Settings reader, enrollment link/QR menu), generated `core.html` |
| GitHub Pages package | `docs/` | Pages shell (fetch transport, text/plain POSTs to avoid CORS preflight), `sw.js`, `manifest.json`, `plugins/` directory, `report.html` viewer |
| Plugins | `src/plugins/*.js` | Self-registering integration modules (Fitbit, Drive backup, Dropbox, future Whoop/etc.). Copied to `docs/plugins/` only; never read by the GAS build |
| Build script | `build.js` | Inlines core into `gas/core.html`; copies core + plugins to `docs/` |

Workflow: edit `src/` → `node build.js` → `clasp push` (template Sheet) + `git push` (Pages).

## Deployment scenarios

| | Client served from | Data at rest | PWA/offline shell | Integrations | MTC dependency |
|---|---|---|---|---|---|
| A. Research, self-contained (default) | PI's Apps Script copy | PI's Sheet | No (sandboxed iframe) | Absent from build | None |
| B. Research, Pages-assisted (PI opt-in) | code.depressioncenter.org | PI's Sheet via PI's `/exec` API | Yes | Present in build, hard-disabled by mode; loader never invoked | Client hosting only; data path unchanged |
| C. Clinic | code.depressioncenter.org | Patient device only | Yes | Optional, user-enabled | Client hosting only; no data custody |

Mode detection: enrollment URL param `?s=<deploymentId>&t=<studyToken>` present = research (sync on, integrations off). Absent = clinic (local-only, integrations offered). Endpoint + token persist to localStorage on first open; params stripped from the address bar.

Scenario A is the IRB separation story: study = one self-contained artifact under the PI's own U-M account. If code.depressioncenter.org disappeared, running studies continue untouched. Scenario B trades that independence for PWA/offline; the PI chooses and discloses it in their protocol.

## Server API (research modes only)

- Apps Script web app deployed "Execute as me" + "Anyone". Anonymous access is contained by a write-only design.
- `doPost`: validates study token, whitelists fields (timestamp, participant ID, day number, sleep values, question ratings), appends to Sheet. No free-form fields reach the Sheet.
- `doGet`: returns study config JSON (study name, question set, required flags) only. No path returns diary data. A leaked URL exposes nothing.
- CORS: anonymous deployments return `Access-Control-Allow-Origin: *`; preflight is avoided by using simple requests (POST, default text/plain body, no custom headers).
- Optional hardening per IRB request: roster-validated participant IDs.
- All executions count against the PI's quota; diary volumes are far below limits.

## Questionnaire

- 10 standard questions, 1-10 rating scale.
- Research mode: researcher marks each standard question required or optional in the Settings sheet. Participants see required ones enforced at submit.
- Clinic mode: patient has full control — track any subset, ignore the rest, change anytime.
- Custom questions: up to 5, created by the researcher (Settings sheet, applies study-wide) or by the patient (clinic mode, local). Each custom question is either a 1-10 rating or a yes/no toggle.
- Storage schema (both modes): `{questionId, type: 'scale'|'binary', value}`. Standard questions have fixed IDs (`q1`-`q10`); custom get generated IDs (`c1`-`c5`). Research Sheet columns are provisioned for q1-q10 + c1-c5 so the schema never migrates mid-study.
- Custom question *text* for patient-created questions stays local; only IDs and values would ever appear in a share payload, with text resolved from the sharer's device at link-generation time (embedded in the report payload so the clinician sees the wording).

## Storage, migrations, backup

- Research participants: entries persist in the study Sheet (that is the backup). Device localStorage holds the offline queue + UI state only.
- Patients (clinic): all data in localStorage/IndexedDB. Backup ladder:
  1. JSON export/import — always available, both modes, no accounts. Blob download + FileReader; works inside the GAS iframe.
  2. Optional cloud backup plugins (clinic only): Google Drive `drive.file` scope via client-side OAuth token client (public client ID, no secret, non-sensitive scope) or Dropbox PKCE.
  3. Installed PWA + `navigator.storage.persist()` to resist iOS storage eviction; install prompted on first run.
- Backups include the notes vault as ciphertext plus its key metadata (salt, wrapped master key). Restoring on any device preserves notes; the notes PIN is still required to read them.
- Schema versioning: `DATA_VERSION` in localStorage; migrations run on load and on backup import, so old backups import cleanly indefinitely.

## PWA update mechanism

- Service worker caches the app shell under a versioned cache name. SW cache and localStorage/IndexedDB are separate storage; code updates never touch data.
- Update flow: `updatefound` → toast ("Update available") → `skipWaiting` message → reload. Old code caches (only) are deleted on activate.
- Discipline rules: never rename a storage key without a migration; never clear anything except old code caches.
- GAS mode has no service worker (sandboxed iframe); research scenario A assumes connectivity, with the localStorage entry queue covering brief offline gaps while the app is open.

## Private notes vault

- Notes are private diary entries. They are never shared with a researcher or clinician, structurally: the share-payload builder imports only the entries and ratings stores; the notes store is not reachable from that code path.
- Enabling notes requires setting a notes PIN. The PIN can be changed but never removed — no removal code path exists.
- Crypto (WebCrypto, both modes, no libraries): random AES-256 master key encrypts notes (AES-GCM). PIN → PBKDF2 (310k iterations, random salt) → wrapping key → wraps master key. PIN change unwraps with old, rewraps with new; notes are not re-encrypted. Stored: salt, iteration count, wrapped master key, verifier. The PIN itself is never stored.

## Sharing

### Patient → clinician (clinic)
- Report link with data in the URL fragment: `report.html#<blob>`. Fragments never leave the browser — not sent to any server, absent from hosting logs. The static viewer page decodes and renders client-side.
- Payload: compress first (lz-string), then encrypt (AES-GCM keyed from a short share PIN via PBKDF2). Fixed crypto overhead is ~44 bytes (~60 base64 chars); ciphertext equals plaintext size. 30-90 nights plus ratings fits comfortably under the ~2,000-char safe URL ceiling. For long histories, the share range is capped (e.g., last 8-12 weeks).
- Share PIN is separate from and shorter than the notes PIN. It is a proportionate deterrent for an intercepted link, not vault-grade: a determined attacker holding the link can brute-force a short PIN offline; high PBKDF2 iterations slow this but do not prevent it. Documented honestly; appropriate for sleep-rating sensitivity.
- Delivery: link pasted into a MyUofMHealth portal message, QR shown in visit, or PDF download as fallback. Always patient-initiated — the compliance keystone. The clinician charts findings in MiChart; the app never replaces the medical record.

### Participant → researcher (research)
- No sharing step: sync to the study Sheet is the transfer. The share-link/report feature remains available for the participant's own use and reads local data only.

## Plugin architecture

- `src/plugins/*.js` are self-registering modules calling `Minap.plugins.register({id, init})`. Core exposes a ~20-line registry plus hook points (`addSettingsPanel`, `addSyncSource`, `onExportData`).
- Build guarantees: the GAS target inlines core only; plugin files are never read, so the GAS bundle cannot grow when integrations are added.
- Runtime guarantees: only the Pages shell contains the dynamic `Minap.plugins.load(id)` script-injection loader, invoked only in clinic mode when the user enables an integration.
- Fitbit plugin: OAuth Authorization Code + PKCE with app type "Client" (no secret exists client-side); api.fitbit.com serves CORS headers; tokens in localStorage. Note: Fitbit developer docs reference migration to Google Health APIs — verify Web API longevity before deep investment.
- Not viable client-side: Garmin (approved-partner program, push-to-server webhooks) and likely Whoop (confidential-client OAuth). Documented as "manual diary entry" for those users.
- Registered OAuth origins use the stable code.depressioncenter.org origin — the reason integrations are only possible on the Pages target.

## Role workflows

- **Researcher:** copy template Sheet → fill Settings (study name, token, date anchor, question config) → Deploy web app → menu generates enrollment link/QR → distribute. Data lands in the Diary sheet. The participant-ID key file lives in an approved system, never in Google.
- **Participant:** open enrollment link once → daily entries (queued offline, synced when online) → done. No Google login, no account, nothing to install (scenario B: optional home-screen install).
- **Clinician:** shares the public URL/QR with patients — no per-clinic deployment, nothing to operate, no data custody, no keys. Reviews patient-shared reports; charts in MiChart.
- **Patient:** open app → prompted to install to home screen → track chosen questions + diary → optional PIN-gated private notes → share by link/QR/PDF when they choose → optional cloud backup.

## Feature gate matrix

| Feature | Research A (GAS) | Research B (Pages) | Clinic (Pages) |
|---|---|---|---|
| Sheet sync | Yes | Yes | Never |
| Standard questions required/optional | Researcher-set | Researcher-set | Patient-controlled |
| Custom questions (max 5) | Researcher-created | Researcher-created | Patient-created |
| Private notes + notes PIN | Yes | Yes | Yes |
| Report / share link (+ share PIN) | Yes (self-use) | Yes (self-use) | Yes (to clinician) |
| JSON export/import | Yes | Yes | Yes |
| Offline entry queue | Yes | Yes | n/a (all local) |
| PWA / offline shell / updates | No | Yes | Yes |
| Fitbit / Drive / Dropbox plugins | Absent from build | In build, never loaded | Optional |


## Security Architecture for MiNap-Go

| Component | Security Mechanism | Purpose |
| --- | --- | --- |
| **Participant Identity** | Hashed PIN (`Utilities.computeDigest`) | Prevents participants from writing data under someone else's Participant ID. |
| **Data Ingestion** | Write-Only (`doPost` / `google.script.run`) | Acts as a strict "drop-box." Guarantees zero data leakage from server to client. |
| **Data History** | Local `IndexedDB` | Provides instant UI history on the participant's device without reading from Google servers. |
| **Timestamps** | Exact Real-World Timestamps | Preserves raw data quality and spreadsheet formulas. Qualifies as a **Limited Data Set (LDS)** under IRB rules since direct identifiers are omitted. |

### Key Takeaways from This Setup

* **Zero Infrastructure / Zero Cost:** Remains a 100% Google Apps Script + Google Sheets project that any researcher can clone and deploy in under 5 minutes.
* **Low Maintenance:** By using hashed PINs instead of zero-knowledge keys or date-shifting scripts, there are no passwords or master keys for the study team to manage or lose.
* **Data Integrity:** Real-time logging straight to the Google Sheet avoids the high risk of data loss associated with client-side batching or offline caching.


## Compliance posture (summary)

- Research: coded participant IDs (key held separately in an approved system), no real dates (per-study random anchor offsets), no participant Google login, write-only anonymous endpoint, self-contained under the PI's account. IRBMED pre-submission consultation recommended; classification call is theirs.
- Clinic: Michigan Medicine stores, operates, and custodies nothing; patient-held data with patient-initiated sharing mirrors the existing paper-diary/screenshot workflow. Voluntary IA heads-up with a one-page data-flow diagram recommended since an MM-affiliated unit ships the tool.
