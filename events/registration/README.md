# Event tickets — setup

Google Form collects the registration. A Google Sheet holds the responses.
Apps Script watches that sheet, issues a ticket code, draws a QR for it, and
emails the registrant. Scanning the QR at the door marks them present.

Cost: nothing. No server, no third-party account.

---

## Before you start: which account owns this

Install everything under **the mailbox you want on the ticket**. Apps Script
sends as whoever owns the script, and it cannot send as somebody else without
a Workspace-wide delegation.

So if tickets should come from `ridzuan@skintificmalaysia.com`, sign in as
that account and create the Form there. Do not create it under one account and
try to point the script at it from another.

The registration form the booth page currently links to
(`1FAIpQLSew0h9ZES…`) is owned by a different account. Either move ticketing to
that account, or make a new form under `ridzuan@` and put its link in the
`form_url` column of the events sheet. Pick one before you build anything on
top of it.

---

## 1. The form

New Google Form under the right account. Add these questions, and note the
exact wording — the script matches on it.

| Question | Type | Required |
|---|---|---|
| Name | Short answer | yes |
| Email | Short answer, with email validation | yes |
| Phone | Short answer | yes |
| Which event are you attending? | Dropdown, one option per event | yes |

Under **Settings → Responses**, turn *Collect email addresses* off if you are
asking for it yourself — two email columns is how the wrong one ends up used.

### The PDPA notice

Name, phone and email are personal data under Malaysia's PDPA. Put a notice on
the form itself, as a description under the title, before you collect anything.
It has to say what you collect, why, how long you keep it, who sees it, and how
someone asks for it back. Below is a starting point, **not legal advice** — the
retention period and the contact are yours to decide, and somebody at Facerinna
has to own it:

> We collect your name, email and phone number to issue your event ticket and
> to contact you about this event. Your details are kept by MY Virtue Rinna
> Sdn. Bhd. and are not sold or shared with third parties. We keep them for
> [12 months] after the event, then delete them. To see, correct or delete
> your details, email [contact@…].

Fill in the brackets. A notice with placeholders left in is worse than none.

## 2. The response sheet

In the form: **Responses → Link to Sheets → Create a new spreadsheet**.

## 3. The script

In that sheet: **Extensions → Apps Script**. Delete the placeholder, paste all
of `Code.gs`, save.

Check `CONFIG.FIELDS` at the top. The left side is what the script needs; the
right side must match your form questions **exactly**, including capitals and
the question mark. This is the single most common thing to get wrong.

Run **`setup`** once from the editor toolbar. Google will ask you to authorise
it — it needs to read the sheet, send email, and fetch the QR image. It will
warn that the app is unverified; that is expected for a script you wrote
yourself, and you reach it through *Advanced → Go to (project name)*.

`setup` adds three columns (`Ticket code`, `Ticket sent`, `Checked in`) and
installs the trigger. If it reports fields NOT FOUND, fix `CONFIG.FIELDS` and
run it again. Running it twice is safe — it clears its own old trigger first,
so nobody gets two tickets.

## 4. Test it before the event, not at it

Run **`sendTestTicket`** to send one to yourself. Then submit the real form
once and check that a code appears in the sheet and an email arrives.

## 5. Check-in at the door

Scan the QR with any phone scanner; it reads out the code. To mark someone
present, run `checkIn("FCR-XXXX-XXXX")` from the Apps Script editor, or build a
small web app around it later.

`checkIn` refuses a code that has already been used and says so, rather than
letting one ticket through twice.

---

## What to know before you rely on it

**Sending limits.** A free gmail.com account sends 100 emails a day; a
Workspace account sends 1500. A pop-up that registers 200 people in a morning
will hit the free limit and stop.

**Where the QR is drawn.** `quickchart.io` renders it, and the only thing sent
there is the ticket code — an opaque string like `FCR-7K2M-9XQ4`. No name,
phone or email leaves Google. If you want nothing at all to leave, set
`CONFIG.QR_PROVIDER = 'none'`; the email still carries the code in text and the
door can type it in.

**If the QR service is down**, the ticket still sends, without the image. That
is deliberate: the code is what checks someone in, the picture is convenience.

**Failures are not silent.** If the script throws, it emails the script owner
with the row number and the stack. A ticket that quietly fails to send is a
person turned away at the door.

**Codes.** Two groups of four from a 32-character alphabet with no O/0 or I/1,
because these get read aloud and typed by hand. That is 32^8 combinations;
20,000 generated in testing produced no collision.

**This script has not been run.** It was written and syntax-checked here, and
the code generator and validators were unit-tested, but nothing in this
sandbox can execute Apps Script or send Gmail. Step 4 is the real test.
