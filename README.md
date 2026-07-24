<!--
This file is part of MiNap Go.
README.md
Author(s): Gabriel Mongefranco
Created: 2026-06-26
Last Modified: 2026-07-10
Summary: MiNap Go: a standalone, ready-to-run version of MiNap (sleep diary app for research) with no additional technology required. This file provides an overview of the project, in Markdown format.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.

-->
![Eisenberg Family Depression Center](https://github.com/DepressionCenter/.github/blob/main/images/EFDCLogo_375w.png "depressioncenter.org")

# MiNap Go!

## Description
MiNap Go is a standalone, ready-to-run version of [MiNap](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/10603/MiNap-Facilitating-Sleep-Medicine-Research-with-Smartwatch-Technology) with no additional technology required. A Google account is required to host the Apps Script web app and the Google Sheet it writes to.

[![MiNap Go Preview](/images/MiNap-Go-Preview.gif)](https://code.depressioncenter.org/MiNap-Go)

MiNap Go is a browser-based sleep diary: participants tap Sleep and Wake, and each timestamped event is saved to a private, researcher-owned Google Sheet. It runs entirely as a single Google Apps Script web app, with no server, no database, and no code editing needed to deploy a new study.



## Quick Start Guide
Want to try it first? Check out the [live demo](https://code.depressioncenter.org/MiNap-Go) before deploying your own copy.

1. A Google account is required. Each study gets its own copy of MiNap Go, and data lives in the researcher's own Google Drive.
2. Make a copy of the [MiNap Go template sheet](https://docs.google.com/spreadsheets/d/1oygo0kEPhFN6bKEcw8wE7RhUb_JM3K7jTiy6z6Hv8rg/copy) (if the link doesn't automatically take you to the "make a copy screen", open the sheet, expand the menu, and click **File > Make a copy** to copy it to your own Google Drive). Rename the copy to your study name or study ID.
3. In your copy, click **Extensions > Apps Script > Deploy > New deployment > Web app**. Set "Execute as" to **Me** and "Who has access" to **Anyone**. Click **Deploy** and authorize the script when prompted.
4. The first authorization shows a Google "unverified app" screen: click **Advanced**, then "**Go to MiNap Go (unsafe)**". This is expected -- it is your own copy of the script.
5. Once deployed, you will be given the URL for your new web app. Open that URL once. A **Setup** tab appears in the Sheet with three columns: the web app URL, your Active Study ID, and your Active Participant IDs. Also copy that URL somewhere safe as a backup.
6. In the **Setup** tab, replace the default Active Study ID (`STUDY1`) with your actual study ID, and replace the sample Active Participant IDs (`P01`, `P02`, `P03`) with your real participant IDs, one per row — only IDs listed there will be able to log in. Give each participant their Study ID and their own Participant ID during enrollment.
7. Share the URL with participants. To start another study, make another copy of the template Sheet and repeat these steps.



## Documentation
+ The full documentation is available at: https://michmed.org/efdc-kb


### Optional: manual deployment into a blank project
You can also deploy the app manually into a blank project if you want to rebuild it from scratch instead of copying the template Sheet:

1. Create a new Google Sheet. This becomes your data store.
2. Open the sheet and click**Extensions > Apps Script** to open the bound script project.
3. Replace the default `Code.gs` contents with this repo's [`src/Code.gs`](src/Code.gs).
4. **File > New > HTML file**, three times; name them exactly `Index`, `Stylesheet`, and `JavaScript`, and paste in the matching files from the repo's [`src`](src/) folder.
5. Open Project Settings (gear icon) and enable "Show `appsscript.json` manifest file in editor"; open `appsscript.json`, delete its contents, and paste in this repo's [`src/appsscript.json`](src/appsscript.json).
6. Click **Deploy > New deployment > Web app**. Set "Execute as" to "Me" to ensure it runs under your account. Set "Who has access" to "Anyone" so particants can access it without a Google account. Authorize the script (as described in the quick start guide).
7. Open the web app URL once; the shareable URL is written to the **Setup** tab.

Because the script is created from inside the Sheet, it is bound to that Sheet. All data will be written there, so it is important not to share it with anyone outside your study team or technical support.


### Code maintenance notes
+ This repository is the source of truth for the code. There is no build step or clasp project; the maintainer syncs these files into the template's bound Apps Script project by hand.
+ **Once deployed, the script is independent of this repository.** Changes to the code here will not affect any deployed copies of MiNap Go. To update a deployed copy, you must manually copy the new code into the bound Apps Script project and redeploy it. This ensures that each study's data remains private and secure, and that the researcher has full control over when and how to update their deployed copy of MiNap Go.




## Additional Resources
+ [MiNap: Facilitating Sleep Medicine Research with Smartwatch Technology](https://teamdynamix.umich.edu/TDClient/210/DepressionCenter/KB/Article/10603/MiNap-Facilitating-Sleep-Medicine-Research-with-Smartwatch-Technology) - Article describing the original MiNap smartwatch sleep diary, with full documentation for the smartwatch, iPhone, and server-side components.
+ Google Apps Script documentation: [https://developers.google.com/apps-script](https://developers.google.com/apps-script)


## About the Team
The [Mobile Technologies Core](https://depressioncenter.org/mobiletech) provides investigators across the University of Michigan the support and guidance needed to utilize mobile technologies and digital mental health measures in their studies. Experienced faculty and staff offer hands-on consultative services to researchers throughout the University – regardless of specialty or research focus.

Learn more at: [https://depressioncenter.org/mobiletech](https://depressioncenter.org/mobiletech).




## Contact
To get in touch, contact the individual developers in the check-in history.

If you need assistance identifying a contact person, email the EFDC's Mobile Technologies Core at: efdc-mobiletech@umich.edu.




## Credits
#### Contributors:
+ [Eisenberg Family Depression Center](https://depressioncenter.org) [(@DepressionCenter)](https://github.com/DepressionCenter)
+ [Gabriel Mongefranco](https://gabriel.mongefranco.com) [(@gabrielmongefranco)](https://github.com/gabrielmongefranco)



#### This work is based in part on the following projects, libraries and/or studies:
+ [MiNap](https://github.com/DepressionCenter/MiNap) - MiNap Go is a browser-based, standalone edition of the MiNap smartwatch sleep diary.
+ [Google Apps Script](https://developers.google.com/apps-script) - MiNap Go is built entirely on Google Apps Script, a cloud-based scripting platform for light-weight application development in the G Suite platform.


## License
### Copyright Notice
Copyright © 2026 The Regents of the University of Michigan


### Software and Library License Notice
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0-standalone.html>.


### Documentation License Notice
Permission is granted to copy, distribute and/or modify this document 
under the terms of the GNU Free Documentation License, Version 1.3 
or any later version published by the Free Software Foundation; 
with no Invariant Sections, no Front-Cover Texts, and no Back-Cover Texts. 
You should have received a copy of the license included in the section entitled "GNU 
Free Documentation License". If not, see <https://www.gnu.org/licenses/fdl-1.3-standalone.html>



## Citation
If you find this repository, code or paper useful for your research, please cite it.

#### Citation Example:
>_Mongefranco, Gabriel (2026). MiNap Go. University of Michigan. Software. https://github.com/DepressionCenter/MiNap-Go_  
​​​​​​​     _DOI: [10.5281/zenodo.21302686](https://doi.org/10.5281/zenodo.21302686)_


----

Copyright © 2026 The Regents of the University of Michigan
