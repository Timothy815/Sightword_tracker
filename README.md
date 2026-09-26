# Sight Words — setup guide

The app is a static site on GitHub Pages. It doesn't store any student data itself. Everything goes to a Google Sheet through a Google Apps Script web app.

```
iPad (GitHub Pages app) ──POST JSON──▶ Apps Script web app ──▶ Google Sheet
                                         checks class key / teacher Google sign-in
```

## 1. Create the sheet and script

1. Create a new Google Sheet (e.g. "Sight Words Data"). Keep it private to your school account.
2. **Extensions → Apps Script**. Delete the sample code and paste in `apps-script/Code.gs`.
3. In the editor, choose the `setup` function and click **Run**. Approve the permissions. This creates the `_Students` and `_Lists` tabs and a random class key (shown under **Execution log**).

## 2. Script properties

**Project Settings (gear) → Script properties**:

| Property | Value |
| --- | --- |
| `CLASS_KEY` | Created by `setup`. Change it any time; paras enter it once per tablet. |
| `ADMIN_EMAILS` | Your Google account, e.g. `you@school.org` (comma-separate co-teachers) |
| `CLIENT_ID` | From step 3 |

## 3. Google sign-in client ID (teacher admin)

1. Go to https://console.cloud.google.com and create a project → **APIs & Services → OAuth consent screen**. Choose **Internal** if your school uses Google Workspace, otherwise External (Testing) and add yourself as a test user.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Under **Authorized JavaScript origins**, add `https://<your-github-username>.github.io`.
4. Copy the client ID into the `CLIENT_ID` script property.

## 4. Deploy the web app

**Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone**. The script turns away any request that doesn't carry the class key or a verified admin sign-in.

Copy the `/exec` URL. After editing the code, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## 5. Publish on GitHub Pages

Put these files at the root of `Timothy815/Sightword_tracker`:
- `Sight Words.dc.html`, renamed to `index.html`
- `support.js`
- the `_ds/` folder

Then turn on Pages under **Settings → Pages → Deploy from branch → main / root**. The app will be at `https://timothy815.github.io/Sightword_tracker/`.

## 6. Connect each device

Open the app and go to **Settings**. Paste the web app URL, the class key and the client ID, then click **Save and connect**. These are kept on that device only.
- **Para tablets** open to **Choose a student** and can run and log sessions. They can't see charts.
- **Teacher** clicks **Teacher sign-in**. The Google account must be listed in `ADMIN_EMAILS`. Once signed in you can see the class dashboard, charts, goals, word lists and exports, and delete students.

## Sheet layout

- **`_Students`**: Student ID · List ID · Words per session · Review words · Goals (JSON) · Created
- **`_Lists`**: custom lists only. Dolch, Fry and the Edmark-style levels are built into the app.
- **One tab per student** (named with their ID code): Timestamp · Session ID · Paraprofessional · Activity · Word · Result (`correct`/`incorrect`) · Attempt · Prompted

Accuracy counts only the **first try** (Attempt 1). When a student misses a word, the para models it and the word comes back later in the session. That retry is logged as Attempt 2, marked Prompted, and doesn't count toward accuracy.

You can edit rows by hand in the sheet. Tap **Refresh** in the app to reload.

## How mastery works

A word is **mastered** when its most recent *N* flashcard/phrase/matching attempts (N = the flashcard goal's consecutive sessions):
- meet the accuracy %, and
- happened on at least the set number of different days, and
- were scored by at least the set number of different paras.

Each activity also has its own goal (accuracy % across consecutive sessions). Its status is shown on the student page and on the class dashboard. You set all of these per student under **Mastery goals**.

## Privacy notes

- Use initials or ID codes only. The app rejects anything other than 2–12 letters, numbers or dashes.
- No student data is kept in the browser. It's fetched when the app opens and stays in memory only.
- Deleting a student removes their row and their tab. You get 8 seconds to **Undo** before the request is sent.
- The sheet's revision history (**File → Version history**) is your backup.
