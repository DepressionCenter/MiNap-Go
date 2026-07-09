<!--
This file is part of MiNap Go.
README.md
Author(s): Gabriel Mongefranco
Created: 2026-06-26
Last Modified: 2026-07-09
Summary: Provides an overview of the project, in Markdown format.
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

# MiNap Go

## Description
MiNap Go: a standalone, ready-to-run version of MiNap with no additional technology required. A Google account is required to host the Apps Script web app and the Google Sheet it writes to.

MiNap Go is a browser-based sleep diary: participants tap Sleep and Wake, and each timestamped event is saved to a private, researcher-owned Google Sheet. It runs entirely as a single Google Apps Script web app, with no server, no database, and no code editing needed to deploy a new study.



## Quick Start Guide
Written for non-technical researchers deploying their own copy of MiNap Go. No coding is required.

1. A Google account is required. Each study gets its own copy of MiNap Go, and data lives in the researcher's own Google Drive.
2. Open the < MiNap Go template Sheet link > and choose **File > Make a copy**.
3. In your copy: **Extensions > Apps Script > Deploy > New deployment > Web app**. Set "Execute as" to **Me** and "Who has access" to **Anyone**. Click **Deploy** and authorize the script.
4. The first authorization shows a Google "unverified app" screen: click **Advanced**, then "**Go to < project > (unsafe)**". This is expected -- it is your own copy of the script. (Screenshots are in the KB article below.)
5. Open your new web app URL once. A **Setup** tab appears in the Sheet with the URL to share with participants. Also copy that URL somewhere safe as a backup.
6. Share the URL with participants. To start another study, make another copy of the template Sheet and repeat these steps.



## Documentation
+ The full documentation is available at: https://michmed.org/efdc-kb
+ __OR__ Detailed setup and usage instructions are available at: [ article_title ](https://link).

### Optional: manual deployment into a blank project
Only needed if you want to rebuild the app in a fresh, empty project instead of copying the template Sheet:

1. Create a new Google Sheet. This becomes the bound data store.
2. **Extensions > Apps Script** to open the bound script project.
3. Replace the default `Code.gs` contents with this repo's `Code.gs`.
4. **File > New > HTML file**, three times; name them exactly `Index`, `Stylesheet`, and `JavaScript`, and paste in the matching repo files.
5. Open Project Settings (gear icon) and enable "Show `appsscript.json` manifest file in editor"; open `appsscript.json` and paste in this repo's manifest.
6. **Deploy > New deployment > Web app** (Execute as: Me; Who has access: Anyone); authorize the script (same unverified-app screen as above).
7. Open the web app URL once; the shareable URL is written to the **Setup** tab.

Because the script is created from inside the Sheet, it is bound to that Sheet and needs no spreadsheet ID.

Maintainer note: this repository is the source of truth. There is no build step or clasp project; the maintainer syncs these files into the template's bound Apps Script project by hand.




## Additional Resources
+ < Links to study website, related projects, etc. >



## About the Team
< 1-2 paragraphs about your department, core, lab, study team, class or project. This is your marketing space! >

Learn more at: < link to dept/lab/project website >



## Contact
To get in touch, contact the individual developers in the check-in history.

If you need assistance identifying a contact person, email the project maintainers at: < dept/lab/mcommunity group email address >.



## Credits
#### Contributors:
+ [Eisenberg Family Depression Center](https://depressioncenter.org) [(@DepressionCenter)](https://github.com/DepressionCenter)
+ [Gabriel Mongefranco](https://gabriel.mongefranco.com) [(@gabrielmongefranco)](https://github.com/gabrielmongefranco)
+ Name [ @githubusername ]( link to github profile or website )
+ Name [ @githubusername ]( link to github profile or website )
+ [ Name ]( link to profile or website ) [ @githubusername ]( link to github profile )
+ [ Name ]( link to profile or website ) [ @githubusername ]( link to github profile )



#### This work is based in part on the following projects, libraries and/or studies:
+ [MiNap](https://github.com/DepressionCenter/MiNap) - MiNap Go is a browser-based, standalone edition of the MiNap smartwatch sleep diary.

MiNap Go has no runtime dependencies: no external JavaScript or CSS frameworks, and no build tooling.



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
>_Last, first; Last, First; Last, First (2026). < Project Name >. University of Michigan. Software. https://github.com/DepressionCenter/< Project URL >_  
​​​​​​​     _DOI: [< DOI # e.g. 10.6084/m9.figshare.xxxxxx.v1 >](https://doi.org/...)_

#### __OPTIONAL__ Release History and DOI #:
* 2026-01-01: v1.0. [< DOI # e.g. 10.6084/m9.figshare.xxxxxx.v1 >](https://doi.org/...)
* 2026-06-30: v1.5. [< DOI # e.g. 10.6084/m9.figshare.xxxxxx.v1_5 >](https://doi.org/...)
* 2026-01-01: v2.0. [< DOI # e.g. 10.6084/m9.figshare.xxxxxx.v2 >](https://doi.org/...)


----

Copyright © 2026 The Regents of the University of Michigan
