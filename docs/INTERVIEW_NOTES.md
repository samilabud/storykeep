# Interview notes

How I explain each part of StoryKeep. Short points I can say out loud.

> These notes are a first draft, written from what was really built and
> tested. Before an interview I should say each point aloud and rewrite any
> that does not sound like me. If I cannot explain a point without reading
> it, I open the file it names and read the code again.

---

## 1. How I prevent double charges and double processing

1. Stripe delivers webhooks "at least once". The same event can arrive twice:
   their retry, a timeout on my side, or someone pressing "resend".
2. So my handler must be **idempotent**: running it twice gives the same
   result as running it once.
3. I store every event in a `stripe_events` table. The primary key is
   Stripe's own event id.
4. The handler first does `INSERT ... ON CONFLICT DO NOTHING`. If no row was
   inserted, I have seen this event, and I stop.
5. The insert and the business change run in **one transaction**. If the
   change fails, the insert is rolled back too, so Stripe's retry gets a
   clean second chance.
6. Without that shared transaction, a crash after the insert would mark the
   event as "seen" and lose it forever.
7. I answer 200 for a duplicate, so Stripe stops sending it. I answer 500 for
   a real failure, so Stripe retries.
8. A second guard: `orders.stripe_checkout_session_id` is UNIQUE and the order
   is an upsert. A different event about the same session still gives one
   order.
9. Before any of that, I verify Stripe's **signature** on the raw request
   body. The URL is public, so anyone could post a fake "paid" event.
10. Access never comes from the browser. After paying, the user returns to
    `?checkout=success`, but that URL unlocks nothing. The page waits until
    the webhook has marked the order as paid.
11. The price is set on the server. The browser only says which story it
    wants to pay for.
12. One payment buys one generation. The order is marked used in the same
    transaction that creates the job, with the row locked. Five clicks start
    one job.
13. Background jobs use the same idea. Each job has a unique idempotency key,
    and the saved draft carries the same key with a UNIQUE constraint. A
    retried job finds its draft and stops.
14. I proved it with a real test-mode payment, then replayed the real event
    twice with `stripe events resend`. The database was the same before and
    after.
15. Known gap: two fast clicks on "Pay" can open two Checkout pages. The user
    would have to pay on both. Reusing the open session would close it.

Where: `src/billing/events.ts`, `src/billing/webhook-handlers.ts`,
`src/app/api/stripe/webhook/route.ts`. Evidence: `docs/evidence/m4-stripe-one-time.md`.

---

## 2. The dunning state machine, and what I would monitor in production

1. **Dunning** is what happens when a renewal payment fails. You do not cut
   the customer off at once. You retry the card, tell them, give them a few
   days, and only then remove access.
2. My states: `active`, `past_due`, `canceled` (and `unpaid`, which I treat
   the same as canceled).
3. `active -> past_due` when a renewal fails. `past_due -> active` when a
   retry succeeds. `past_due -> canceled` when the retries run out.
4. **Stripe owns the retries. My app owns the access.** Stripe decides when
   to try the card again. In my sandbox that was 8 retries over two weeks,
   then cancel. That is a dashboard setting, not my code.
5. My app only decides how long the user keeps access meanwhile: a **3 day
   grace period**, started at the first failure and never extended.
6. Access is **derived, not stored**. There is no `has_access` column. One
   function answers: active is yes, past_due is yes until `grace_until`,
   everything else is no.
7. So the grace period ends with no cron job and no event. The clock passes
   `grace_until` and the next check says no.
8. During the grace period the user sees a banner on every page and gets one
   email with a link to update their card in Stripe's Customer Portal.
9. The email is not sent from the webhook. The webhook inserts an email job
   in the same transaction as the state change. That is the **outbox
   pattern**: no email for a change that was rolled back, and no second email
   for a replayed event.
10. **Stripe does not promise the order of events.** `invoice.paid` can arrive
    before `subscription.updated`. So I keep two timestamps from Stripe's
    `event.created`: the newest subscription snapshot I applied, and the
    newest successful payment. Anything older is ignored.
11. The state machine is a pure function, so I test it hard: for each
    scenario I deliver the events in **every possible order** (5,040 orders
    for the recovery case) and check the final state.
12. That test found a real bug before any real run: a missed recovery payment
    could reopen dunning.
13. I proved the real flow with **Stripe test clocks** and the card
    `4000 0000 0000 0341`, which attaches fine and then fails every charge.
    Scenario A: a retry succeeds. Scenario B: every retry fails and the
    subscription is canceled.
14. What I would monitor: webhook responses that are not 2xx, the age of the
    newest stored event (a silent webhook is the worst failure), how many
    subscriptions are `past_due` past their grace period, the recovery rate,
    and failed email jobs.
15. What I would add for production: a nightly job that compares my rows with
    Stripe and fixes drift. Event timestamps have one-second precision, so
    this is the real safety net.

Where: `src/billing/state-machine.ts`, `src/billing/subscriptions.ts`.
Evidence: `docs/evidence/dunning.md`.

---

## 3. How PDF and DOCX are generated, and what broke first

1. Both files are built on the server, on request. Nothing is stored.
2. There is **one content model**. I parse the story text once into a title,
   sections and paragraphs. Both renderers read that object, never the raw
   text. So the two files cannot disagree about what a heading is.
3. PDF and Word are different engines, so the renderers are separate. But
   they share one file of numbers: font sizes, margins, spacing, paper size.
4. For the PDF I use `@react-pdf/renderer`. It is pure Node, so it runs in a
   serverless function. A headless browser gives better CSS, but Chromium is
   about 150 MB and slow to start.
5. For Word I use the `docx` library. It writes real structure: heading
   styles, a footer with Word's page-number field, and sections.
6. The PDF **embeds its font** (DejaVu Serif). That is why `Łódź` and `Dvořák`
   print correctly and the file looks the same on every computer.
7. The Word file names a font (Georgia) and does not embed it. That is normal
   for Word. So the two files share sizes and spacing, not the exact typeface.
8. **No orphan headings.** In the PDF the heading and its first paragraph are
   one block that cannot be split. In Word each heading has "keep with next".
9. The cover has no page number. The body starts at 1.
10. Emoji: the PDF font has none, so I leave them out instead of printing
    empty boxes. Word keeps them.
11. The route checks four things in order: signed in (401), owner (404), paid
    (402), has text (409). The download link is hidden when unpaid, but that
    is only for looks. The server refuses the request itself.
12. **What broke first:** page numbers vanished. A line-height setting on the
    page made the library drop them. I found it because my test reads the
    text of each page back, and no page ended in a number.
13. **Second:** a heading sat alone at the bottom of a page. The library's own
    setting for this did not work, so I made the unbreakable block.
14. **Third, and the best lesson:** my first test for orphan headings could
    not fail. It passed with the fix removed, because no heading happened to
    land at a page bottom. Now the test pushes a heading across the page
    boundary one line at a time, and it does fail without the fix.
15. My tests open the files. The PDF text is extracted page by page. The DOCX
    is unzipped and its XML is read. A browser test downloads both files
    through the real UI.

Where: `src/export/`. Evidence: `docs/evidence/m6-export.md` and the files in
`docs/evidence/samples/`.

---

## 4. Trade-offs I chose, and what I would change for production

1. **A Postgres table as the job queue.** No extra service, and I understand
   every line. For high volume I would use a real queue. The worker polls
   once a second, so a job can wait up to a second.
2. **`FOR UPDATE SKIP LOCKED`** lets several workers share the queue. A worker
   locks the row it takes and the others skip it.
3. **At-least-once delivery.** A queue cannot promise "exactly once". It can
   promise "never forgotten". So I made the handlers safe to repeat.
4. **Retries with exponential backoff:** 3 tries, waiting 5 then 10 seconds.
   The error type decides: a rate limit is retried, a bad key or a refusal
   fails at once.
5. **A stale lock is 5 minutes.** A job "running" longer than that is taken
   again. A job that truly needs more than 5 minutes would run twice. A
   heartbeat would fix it.
6. **The cost cap is per user and soft.** Two jobs at the same moment can both
   pass the check. For production I would reserve the budget in the same
   transaction, and add a global cap.
7. **Event timestamps to order webhooks.** The other common design is to fetch
   the subscription from Stripe on every event. That is simpler to reason
   about, but adds an API call to each webhook and is harder to test offline.
   I would add the nightly reconcile as the safety net.
8. **A row lock on the story** keeps version numbers unique. All writes to one
   story wait in line. Fine for one author. For many editors I would use a
   sequence or retry on conflict.
9. **Append-only data.** Answers and story text are never updated. History is
   free and nothing is lost by a bad save. The cost is more rows.
10. **Sessions are JWT cookies.** No session table. I cannot revoke a session
    before it expires. A database session would fix that.
11. **Auth.js v5 is a beta.** It fits the App Router. For production I would
    pin the version and watch its changelog.
12. **Files are built on each request.** No storage to secure. For big
    documents I would build them in a job and store them.
13. **On Vercel there is no worker process.** The app runs waiting jobs after
    it sends the response, and a daily cron is the safety net. A retry waits
    for the next trigger. With real traffic I would run a real worker.
14. **Missing for a real product:** password reset, email verification, login
    rate limiting, tax, refunds beyond the basic case, and error monitoring.
15. **The thing I am most glad I did:** for each important rule I removed the
    protection on purpose and checked that a test failed. Once, the test
    turned out to be unable to fail, and I had to write a better one.

Where: `docs/DECISIONS.md` has the same trade-offs per milestone, with the
"what broke first" lists.

---

## Words I should be able to define in one sentence

| Word | One sentence |
|---|---|
| Idempotent | Doing it twice gives the same result as doing it once. |
| Idempotency key | A unique name for one piece of work, so a repeat can be recognised. |
| At-least-once | A message is never lost, but may arrive more than once. |
| Webhook | An HTTP request that another service sends to me when something happens. |
| Signature verification | Checking an HMAC of the request body with a shared secret, to prove who sent it. |
| Dunning | Chasing a failed recurring payment: retry, notify, grace period, then cancel. |
| Grace period | Time after a failed payment during which the user keeps access. |
| Test clock | A Stripe tool that moves time forward for test customers. |
| Outbox pattern | Saving a message in the same transaction as the change, and sending it later. |
| `SKIP LOCKED` | A Postgres option: skip rows another transaction has locked, do not wait. |
| Exponential backoff | Waiting longer after each failed try. |
| Orphan heading | A heading left alone at the bottom of a page. |
