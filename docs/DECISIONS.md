# Decisions

Short notes on what was chosen, why, and what was cut. Newest milestone last.

## M1. Foundation

**Drizzle, not Prisma.** Drizzle reads like SQL. This project depends on
unique constraints and `ON CONFLICT DO NOTHING`, and they are visible in the
code instead of hidden behind an ORM.

**`pg` driver.** The plain Postgres driver. The job queue in M3 needs
`FOR UPDATE SKIP LOCKED` inside a transaction, and `pg` does that simply.

**Auth.js v5 with email and password.** A magic link needs a mail flow before
anything else works. A password is faster to build and easy to drive in
Playwright. Trade-off: Auth.js v5 is still a beta release (`5.0.0-beta.32`).
Its v4 line is stable but does not fit the App Router as well. For production
I would pin the version and watch its changelog.

**Sessions are JWTs in an httpOnly cookie.** No session table. Trade-off: a
session cannot be revoked on the server before it expires. That is acceptable
here. A database session would fix it.

**Access control lives in the data layer.** Every function in
`src/stories/data.ts` takes a `userId` and puts it in the `WHERE` clause.
There is no "get story by id" function without a user. A page or route cannot
forget the check, because the query will not run without it.

**404, not 403, for someone else's story.** A 403 tells a stranger that the id
is real. A 404 tells them nothing.

**One wrapper for reading the session (`src/auth/session.ts`).** Two reasons.
First, Next.js 16 with Cache Components tries to prerender pages at build
time. `connection()` tells it that this code needs a live request. Second,
tests replace this one module to choose who is signed in. Everything else in
the tests is real.

**Tests use a real Postgres, not mocks.** A second container on port 5441,
held in memory. The real migrations run before the tests. Access control and,
later, idempotency are enforced by the database, so a mocked database would
prove nothing.

**Ports 5440 / 5441 / 3100.** The usual 5432 and 3000 were already taken on
my machine. Fixed, unusual ports avoid a confusing clash.

**Kept the Next.js 16 defaults (Cache Components, Partial Prefetching).** Cost:
any component that reads the session must sit inside `<Suspense>`. Known
effect: a page redirect or "not found" that happens inside `<Suspense>` is
sent after the response has started, so the HTTP status of the *page* is 200
even though the browser shows the 404 page or lands on `/login`. The JSON API
returns true 401 and 404 status codes, and that is what the tests assert on.

### Bug found by the tests

After a failed login, the email field was empty. React 19 resets a form when
its action finishes. Fix: the action returns the typed email and the input
uses it as `defaultValue`. The Playwright test now checks this.

### Cut or postponed

- No password reset and no email verification. Out of scope for the weekend.
- No rate limit on login. I would add one for production.
- No `proxy.ts` redirect for anonymous visitors. The guards already protect
  the data. A proxy would only make the redirect a little faster.

## M2. Questionnaire and versions

**Append-only history.** An answer is never updated. A changed answer is a
new row with `revision + 1`. Story text works the same way: every save is a
new row in `story_versions`. Reason: history is free, nothing can be lost by
a bad save, and "undo" needs no extra code.

**Restore is a new version.** Restoring version 1 copies its text into a new
version 3. Version 2 stays. A restore can itself be undone.

**A row lock keeps the numbers unique.** To get the next number the code
reads the highest one and adds 1. Two saves at the same moment would both
read "3" and both write "4". So every write first runs
`SELECT ... FOR UPDATE` on the story row. The second save waits until the
first has committed. The same query also checks that the user owns the story.
The `UNIQUE (story_id, version_no)` constraint is the safety net if the lock
is ever removed. I removed the lock as an experiment and the concurrency
tests failed with a duplicate key error.

**Trade-off of the lock.** All writes to one story wait in line. That is fine
here, because one person edits one story. For many writers on one document I
would use a sequence or retry on conflict instead.

**Saving the same value again does nothing.** No new row. The history shows
real changes only, and a double click cannot create a duplicate.

**A skip is a saved row.** `skipped = true`, `answer_text = NULL`. So "skipped"
and "not reached yet" are different, and resume can tell them apart. An empty
answer is stored as a skip.

**Resume is computed, not stored.** There is no "current step" column. The
page finds the first question with no row. One fewer thing that can get out
of sync with the answers.

**Questions live in code, answers are stored by key.** The wording can change
without a migration. Trade-off: removing a question leaves old rows behind,
which are ignored.

**`story_versions.idempotency_key` is already written by `saveVersion`.** M3
uses it so a retried LLM job cannot insert a second draft.

### Cut or postponed

- No rich text editor. A plain textarea is enough to prove versions.
- No diff view between versions.
- No autosave while typing. The user saves each answer with a button.
