# Getting Construction Calc on the Apple App Store

## 1. Join the Apple Developer Program ($99/year)
Easiest way: on your iPhone, get the free **Apple Developer** app from the App Store →
**Account** → **Enroll now**. It checks your ID with the iPhone camera, which is faster than the website.
(Website option: https://developer.apple.com/programs/enroll/)
- Enroll as an **Individual**. Your legal name shows as the seller on the App Store.
- Pay the $99. Apple usually approves in 1–2 days and emails you.

## 2. Build the iPhone app (tell Claude when you're approved)
Claude opens a window on your PC that runs:
```
npx eas-cli@latest build --platform ios --profile production
```
In that window, sign in with your Apple ID and type the 2-factor code from your iPhone.
Expo then makes Apple's certificates for you automatically.

## 3. Send it to Apple
```
npx eas-cli@latest submit --platform ios
```
This uploads the build to App Store Connect (it can create the app there for you).
Unlike Google, Apple allows this for the very first upload.

## 4. Fill out the listing in App Store Connect (https://appstoreconnect.apple.com)
- **Subtitle** (30 characters): Feet-inch, concrete & rebar
- **Keywords** (100 characters): construction,calculator,feet,inch,fraction,concrete,rebar,slab,framing,stairs,rafter,grade
- **Description:** use the full description in `store/listing.md`
- **Support URL:** https://github.com/dasscooby/construction-calc
- **Privacy policy URL:** https://construction-calc-7815.netlify.app/privacy.html
- **Screenshots (6.9" iPhone):** the 6 pictures in `store/ios-screenshots/`
- **App Privacy:** Data Collected → **Identifiers → Device ID** → used for **App Functionality** → **not** linked to the user → **not** used for tracking. (This is the random install ID the update check sends.)
- **Age rating:** answer None/No to everything → 4+
- **Price:** Free · **Category:** Utilities (or Productivity)

## 5. Test, then go live
- **TestFlight:** add testers by email; they install Apple's TestFlight app and get your app. No 14-day rule on Apple.
- When you're happy: **Add for Review** → **Submit**. Apple usually reviews in 1–2 days.
