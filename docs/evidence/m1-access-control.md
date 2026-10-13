# M1 evidence: per-user access control

**Claim:** a signed-in user can read only their own stories.

## Automated tests

| Test | File | What it proves |
|---|---|---|
| Vitest, 8 tests | `tests/integration/story-access.test.ts` | Against a real Postgres: user A gets `null` from the data layer and `404` from `GET /api/stories/:id` for user B's story. The owner gets `200`. No session gives `401`. A malformed id gives "not found", not a crash. |
| Playwright, 2 tests | `tests/e2e/story-access.spec.ts` | In a real browser: Alice registers and creates a story. Bob registers, opens Alice's URL and sees the 404 page. The API returns 404 to Bob and 200 to Alice. A visitor with no session lands on `/login`. A wrong password is rejected. |

Full output: [m1-test-output.log](m1-test-output.log)

## The test can fail

I removed the `user_id` condition from the query in `src/stories/data.ts` and
ran the tests again. Two tests failed, as they should:

```
× does not let user A read user B's story
× returns 404 when user A asks for user B's story
Tests  2 failed | 6 passed (8)
```

I then restored the condition and all 8 passed.

## Screenshots

- [m1-owner-sees-story.png](m1-owner-sees-story.png): Alice sees her own story.
- [m1-other-user-gets-404.png](m1-other-user-gets-404.png): Bob opens the same URL and gets the 404 page.

## How to repeat it

```bash
docker compose up -d
pnpm db:migrate
pnpm test        # Vitest, uses the test database on port 5441
pnpm test:e2e    # Playwright, starts the app on port 3100 if needed
```
