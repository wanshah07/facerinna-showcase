# Event registration and tickets — setup

The events page carries its own three-step form. It posts to an Apps Script
web app, which writes the row, issues a ticket code, and emails it back. The
code appears on screen straight away, so somebody who mistypes their email
still leaves with a ticket.

No Google Form is involved. Nothing is stored by the page itself.

Cost: nothing. No server, no third-party account.

---

## Already done

**The response sheet exists**, in `ridzuan@skintificmalaysia.com`, with the
header row the script expects:

**[FACERINNA — Event Registrations (live)](https://docs.google.com/spreadsheets/d/1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso/edit)**

| Timestamp | Name | Email | Phone | Which event are you attending? | Ticket code | Ticket sent | Checked in |
|---|---|---|---|---|---|---|---|

Do not rename those headers. The script matches on them by name, and a rename
is the failure that looks like nothing is wrong until the first ticket goes
out addressed to nobody.

---

## 1. Paste the script

Open that sheet → **Extensions → Apps Script**. Delete the placeholder, paste
all of `Code.gs`, save.

Run **`setup`** once from the toolbar. Google asks you to authorise it: it
needs to read the sheet, send email, and fetch the QR image. It warns that the
app is unverified, which is what Google says about any script you wrote
yourself; you reach it through *Advanced → Go to (project name)*.

Because the sheet already has its headers, `setup` will report that the fields
were found and simply confirm. If it lists anything as NOT FOUND, a header has
been changed — put it back rather than editing the script.

**Save before you run.** Apps Script runs the *saved* file, not what is on
screen. Pasting and pressing Run without Ctrl+S runs the old code, and
everything looks fine because the editor shows the new version.

`setup` now reads the formats back and shows them in its alert:

    Phone column format: TEXT  (correct)
    Ticket sent format: yyyy-mm-dd hh:mm  (correct)

If the phone line says anything else, run **`fixFormats`** on its own. It
applies the formats and reports what it finds afterwards, so the answer is
evidence rather than a claim.

## 2. Deploy it as a web app

**Deploy → New deployment → Web app.**

| Setting | Value |
|---|---|
| Execute as | **Me** (ridzuan@skintificmalaysia.com) |
| Who has access | **Anyone** |

"Anyone" is required: the people registering are not signed in to your
Workspace. Read the note on what that exposes below before you accept it.

Copy the **/exec** URL it gives you.

### Editing the script later does NOT change what /exec runs

This is the one that catches people. A deployment is frozen to the version it
was made from. Paste new code, save it, run `setup` — and `/exec` still serves
the old code, because nothing told it otherwise. The editor and the live
endpoint are two different things.

After any change to `doPost`, `sendTicket` or anything else the page reaches:

**Deploy → Manage deployments → (pencil) Edit → Version: New version → Deploy**

The URL stays the same. Skip this and the fix you just pasted is not live, and
the only way you find out is by testing a registration and reading the row.

## 3. Point the page at it

In `events/index.html`, near the top of the script block:

```js
var REGISTER_ENDPOINT = "";   // paste the /exec URL between the quotes
```

Until that is filled in the button falls back to embedding the old Google
Form, so the booth keeps working rather than offering a form with nowhere to
send anything.

Set `PRIVACY_URL` in the same place once the privacy notice has a home. The
consent line renders without a link if it is left blank, which is worse.

## 4. Test it before the event, not at it

- Run **`sendTestTicket`** in the editor. A ticket should arrive in your inbox.
- Open the events page, tap **Register here**, and complete the three steps
  with your own details. A row should appear in the sheet, a code on screen,
  and an email within a minute.
- Submit the same email for the same event again. You should get the *same*
  code back, not a second row.

## 5. Check-in at the door

Scan the QR with any phone camera; it reads out the code. To mark someone
present, run `checkIn("FCR-XXXX-XXXX")` from the editor.

`checkIn` refuses a code that has already been used and says so, rather than
letting one ticket through twice.

---

## If registrations appear far down the sheet

Rows are written after the last filled cell in the **Timestamp** column, not
after the last used cell anywhere on the sheet. That means a note typed in a
spare column no longer pushes the next registration hundreds of rows down.

It is narrower, not bulletproof: something left in the Timestamp column itself,
below the data, still shifts the next write. Run **`compactRows`** to pull the
registrations back up. It moves every row that has a ticket code, in order,
from row 2 with no gaps, and it leaves anything without a ticket code where it
is and names it in the result rather than deleting what it does not recognise.

## What to know before you rely on it

**The endpoint is public.** It is in the page source, so treat it as such.
It only ever appends a row and sends one email; it returns nothing about
anybody else, and it cannot be used to read the sheet. Every field is
re-validated server-side, because the checks in the page are a courtesy to the
visitor, not a control. A repeat of the same email for the same event returns
the existing code instead of creating a second row, so a refresh or a double
tap cannot produce two tickets.

If it is ever abused, redeploy with a new URL and update `REGISTER_ENDPOINT`;
the old URL dies with the old deployment.

**Sending limits.** A Workspace account sends 1500 emails a day. A pop-up that
registers 200 people in a morning is fine; a campaign that registers 2000 is
not.

**Where the QR is drawn.** `quickchart.io` renders it, and the only thing sent
there is the ticket code — an opaque string like `FCR-7K2M-9XQ4`. No name,
phone or email leaves Google. Set `CONFIG.QR_PROVIDER = 'none'` and even that
stops; the email still carries the code in text.

**If the email fails**, the visitor still gets their code on screen and the
sheet records `EMAIL FAILED` against that row, so you can see who to chase.

**Failures are not silent.** If the script throws, it emails the owner with the
row number and the stack.

**Codes** are two groups of four from a 32-character alphabet with no O/0 or
I/1, because they get read aloud and typed by hand at a busy door. That is
32^8 combinations; 20,000 generated in testing produced no collision.

---

## PDPA

Name, phone and email are personal data under Malaysia's PDPA. The form
carries a consent tickbox and will not submit without it, and the wording says
what the data is used for. That is the mechanism; the policy is yours.

You still need a privacy notice somewhere the link can point at. It has to say
what you collect, why, how long you keep it, who sees it, and how someone asks
for it back. A starting point, **not legal advice**:

> We collect your name, email and phone number to issue your event ticket and
> to contact you about this event. Your details are held by MY Virtue Rinna
> Sdn. Bhd. and are not sold or shared with third parties. We keep them for
> [12 months] after the event, then delete them. To see, correct or delete
> your details, email [contact@…].

Fill in the brackets before it goes live. A notice with placeholders left in
is worse than none, and somebody at Facerinna has to own the retention period
and the contact address.

---

## What has not been tested

**The Apps Script has never been run.** It is syntax-checked, and the code
generator and the email validator are unit-tested, but nothing in the sandbox
this was written in can execute Apps Script, send Gmail, or deploy a web app.

**The page side has been tested end to end** against a mock of this endpoint:
the three steps, the per-step validation, the consent gate, a successful
submission returning a code, and a server error leaving the form intact with a
retry. What has not been proven is that the two halves agree — that is step 4,
and it takes two minutes.
