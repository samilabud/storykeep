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
