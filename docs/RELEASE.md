# Releasing to Google Play

Everything the repository can do is done: the signed app bundle, the store listing and images, the privacy
policy, and an About sheet whose tester notes testers can paste into their feedback (SPEC section 33). What
is left needs your Google accounts and your key, so it is yours. This page walks through it in order, with
an answer ready for every question the Play Console asks.

| What | Where |
| --- | --- |
| Listing text | `store/listing/en-US/title.txt`, `short_description.txt`, `full_description.txt` |
| Icon, 512 by 512 | `store/icon-512.png` (`node tools/make-icons.cjs` redraws it) |
| Feature graphic, 1024 by 500 | `store/listing/en-US/images/featureGraphic.jpg` |
| Phone screenshots, 1080 by 1920 | `store/listing/en-US/images/phoneScreenshots/` (upload them in name order) |
| Privacy policy | `store/privacy-policy.md`, online at the URL in step 4 |
| Signed app bundle | the Release workflow's artifact `glimmerdeep-release-aab` |

`npm run build && node tools/store-art.cjs` redraws the feature graphic and screenshots from the game, and
`test/store-kit.test.js` keeps the listing inside Play's limits and true to the game.

## 1. The upload key (once)

Google Play signs the app people install with its own key (Play App Signing). You sign each upload with an
**upload key**, which only you hold. On your Mac, from the repository folder:

```sh
tools/make-upload-key.sh
```

It asks for a password (use the same one for the store and the key when keytool asks twice) and a name for
the certificate, writes `~/glimmerdeep-upload.jks`, and prints its fingerprint. Put the `.jks` file and the
password in your password manager. If the key is ever lost, Google can reset it, but that takes days.

## 2. The secrets (once)

The script prints four `gh secret set` commands. Run them, or add the same four secrets by hand under the
repository's Settings, Secrets and variables, Actions:

| Secret | Value |
| --- | --- |
| `GLIMMERDEEP_UPLOAD_KEYSTORE_BASE64` | `base64 < ~/glimmerdeep-upload.jks` |
| `GLIMMERDEEP_UPLOAD_STORE_PASSWORD` | the password |
| `GLIMMERDEEP_UPLOAD_KEY_PASSWORD` | the same password |
| `GLIMMERDEEP_UPLOAD_KEY_ALIAS` | `upload` |

## 3. A signed bundle

Actions, Release, Run workflow (or push a tag such as `v1.0.1`). It runs the unit tests and level check,
builds the release bundle, signs it with the upload key, checks the signature, and uploads
`glimmerdeep-release-aab`. Every run takes a higher version code (run number plus 100) and the version
name `1.0.<run number>`, so each upload is newer than the last. The About sheet shows both, so a tester's
notes say which build they played.

Release builds sell through Google Play Billing. Debug builds use the game's free test store and install
as a separate app, **Glimmerdeep Dev** (`com.codeenzyme.glimmerdeep.debug`), so a phone can hold both.
The debug build installed before this change is `com.codeenzyme.glimmerdeep` signed with the debug key,
and Play cannot install over it: uninstall that one before installing from Play (its progress goes with it).

## 4. The Play Console

You need a Google Play developer account (a one-time fee). Personal accounts made after 13 November 2023
must run a **closed test with at least 12 testers, opted in for 14 days in a row**, before they can apply
for production. Organization accounts skip that rule. Testers who leave early do not count, so invite 15
to 20.

### Create the app

All apps, Create app:

- App name: **Glimmerdeep**
- Default language: **English (United States), en-US**
- App or game: **Game**
- Free or paid: **Free** (it is free to download; the purchases come later)
- Tick the two declarations (developer program policies, US export laws).

### Set up your app (Dashboard)

Answer each task on the Dashboard as below.

- **Privacy policy:** `https://github.com/Code-Enzyme/glimmerdeep/blob/main/store/privacy-policy.md`
  (the repository is public, so GitHub shows it to anyone). It names Code Enzyme as the maker; change that
  line if your Play developer name differs.
- **App access:** All functionality is available without special access.
- **Ads:** No, my app does not contain ads.
- **Content rating:** start the questionnaire with your email; category **Game**. Answer **No** to
  violence, fear, sexuality, language, controlled substances, crude humour, gambling and simulated
  gambling, user interaction or communication, sharing location, and unrestricted web access. Answer
  **Yes** to buying digital goods (the Full Expedition and Glimmer jars). Expect Everyone, PEGI 3, USK 0.
- **Target audience and content:** **13 to 15, 16 to 17, and 18 and over.** Picking any age under 13 puts
  the app under the Families policy, with its own review and rules. The game would pass them (no ads, no
  data), but that is a separate decision, best made after the closed test. If asked whether the listing
  could unintentionally appeal to children, answer honestly; the art is soft and the creatures are cute.
- **News app:** No.
- **Data safety:** **No**, the app does not collect or share any of the required user data types. The game
  sends nothing off the phone: no server, no analytics, no ads, no accounts. Payments are handled by Google
  Play's billing system, which takes them from the player directly; the game only learns which products the
  player owns. Google's help counts data as collected only when it leaves the phone from your app. If you
  would rather be cautious, declare Financial info, Purchase history: collected, not shared, required, for
  app functionality. Either way, the privacy policy already covers it.
- **Government app:** No. **Financial features:** none. **Health:** none.
- **Advertising ID:** No, the app does not use an advertising ID.

### Store listing (Grow users, Store presence, Main store listing)

- App name, short description, full description: paste from `store/listing/en-US/`.
- App icon: `store/icon-512.png`. Feature graphic: `featureGraphic.jpg`.
- Phone screenshots: the seven files in `phoneScreenshots/`, in name order (the boards first, the title last).
- Store settings: category **Game, Puzzle**; tags such as Puzzle and Casual; your contact email (shown on
  the listing; the privacy policy points people to it).

### In-app products (Monetize with Play)

First set up a payments profile (Settings, Payments profile), which Google needs before you can sell
anything. The Play Console lets you add products only after a bundle that uses Billing is uploaded to a
track, so do this after the first upload in the next step, then create two one-time products. The ids must
match `src/ui/shop.js` exactly:

| Product id | Name | Description | Price |
| --- | --- | --- | --- |
| `full_expedition` | Full Expedition | Opens chapters 2 to 7 and the Night Garden. | $4.99 |
| `glimmer_10` | Jar of Glimmer | 10 Glimmer, for instant hints. | $0.99 |

The game consumes each Glimmer jar itself after granting it, so the jar can be bought again; the Full
Expedition is kept. Prices are placeholders (SPEC section 14); Play converts them for other countries.
Activate both.

**License testing** (Settings, License testing): add every tester's Gmail address, and your own. Their
purchases then use a test card and are never charged. Do this before the closed test starts, or testers
pay real money for the Full Expedition.

### Internal test first (minutes, no review)

Test and release, Testing, Internal testing: create a release, upload `app-release.aab`, add yourself to
the testers list, and roll it out. It reaches you within minutes, with no review. Install it from the
opt-in link, and check a test purchase of the Full Expedition and of a Glimmer jar. Create the in-app
products now if you have not.

### The closed test

Test and release, Testing, Closed testing: use the default track (or create one).

1. **Countries/regions:** add the countries your testers are in (or all).
2. **Testers:** create an email list with your testers' Gmail addresses (at least 12; 15 to 20 is safer),
   and set a feedback email or URL. Copy the opt-in link.
3. **Create a release:** upload the same `app-release.aab` (or a newer one), and add release notes:

   > First closed test of Glimmerdeep. Play as far as you like. When you send feedback, open About on the
   > title screen, tap Copy tester notes, and paste them in: they show which caverns were hard.

4. Review the release, then **Start rollout to Closed testing**. In Publishing overview, **Send changes for
   review**. The first review can take a few days.

Send testers the opt-in link with something like:

> I'm testing my puzzle game Glimmerdeep before it goes on Google Play, and Google needs 12 people to try it
> for two weeks. Open this link on your Android phone, tap Become a tester, then install it from Play.
> Please keep it installed for 14 days and play now and then; nothing is collected, and purchases are free
> for testers. When you have thoughts, open About on the title screen, tap Copy tester notes, and send them
> to me with what you liked or found hard.

### After 14 days

Dashboard, **Apply for production**. Google asks how recruiting testers went, how engaged they were
(whether they used the features), a summary of their feedback, who the game is for, and what you changed
because of the test. The tester notes answer most of it. Review usually takes up to seven days. If Google
says engagement was too low, the closed test keeps running and you apply again later.

## Updates

Every Release workflow run makes a new, higher version code. Upload its bundle to the same track (or
promote a tested release to the next track). Keep the upload key: every update must be signed with it.
