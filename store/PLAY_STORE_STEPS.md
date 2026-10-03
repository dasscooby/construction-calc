# Getting Construction Calc on Google Play

The app file for Google Play (an `.aab`) is built on Expo. Download it from:
https://expo.dev/accounts/dasscoobys-team/projects/aaron/builds
(open the newest Android build → **Download**)

## 1. Make a Google Play developer account (one time, $25)
1. Go to https://play.google.com/console/signup and sign in with a Google account.
2. Pick **Personal** (or **Organization** if you have a registered business with a D-U-N-S number).
3. Pay the $25 fee and do the ID check. Google can take a few days to verify you.

> New **personal** accounts must test the app with **at least 12 people for 14 days in a row**
> before Google lets it go public (step 4). Organization accounts skip this.

## 2. Create the app
1. Play Console → **Create app**.
2. App name: **Construction Calc** · Language: English (US) · **App** · **Free**.
3. Check the two declaration boxes → **Create app**.

## 3. Fill out "Set up your app" (Dashboard)
Answers for this app:
- **Privacy policy:** https://construction-calc-7815.netlify.app/privacy.html
- **App access:** All functionality is available without special access.
- **Ads:** No, my app does not contain ads.
- **Content rating:** start the questionnaire, category **Utility, Productivity, Communication, or Other**, answer **No** to everything → rating comes out "Everyone".
- **Target audience:** **18 and over**.
- **Data safety:** "Does your app collect or share any of the required user data types?" → **No**.
- **Government app:** No. **Financial features:** None. **Health:** None.
- **Store listing:** copy the text from `store/listing.md`, upload `store/icon-512.png`, `store/feature-graphic.png`, and the 6 pictures in `store/screenshots/`. Category: **Tools**. Add your contact email.

## 4. Closed test (12 testers, 14 days)
1. Play Console → **Testing → Closed testing → Create track** (or use the default "Closed testing - Alpha").
2. **Testers:** make an email list with at least 12 people who have Android phones (their Gmail/Google emails). Save.
3. **Create new release** → upload the `.aab` file you downloaded from Expo → release name can stay as is → **Next → Save → Send for review**.
4. When Google approves it (usually a day or two), copy the **opt-in link** from the Testers tab and send it to your testers. Each one opens it on their Android phone, taps **Become a tester**, then installs the app from Play.
5. Keep at least 12 of them opted in for 14 days straight.

## 5. Go live
1. After 14 days: Dashboard → **Apply for production** → answer the short questions.
2. Once approved: **Production → Create new release** → **Add from library** (pick the same build) → **Send for review**.
3. Google reviews it (usually a few days). Then anyone can find it on Google Play.

## Updates later
Ask Claude to make the change and run a new build. Then in Play Console upload the new `.aab` to the same track.
(After the first manual upload, `eas submit` can upload builds for you once a Google "service account" key is set up.
Google doesn't allow the very first upload through `eas submit`.)
