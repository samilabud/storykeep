# StoryKeep

Answer a short questionnaire about someone's life, get an LLM-drafted story,
edit it, and download it as PDF or DOCX. Paid with Stripe (test mode only).

This is a learning project. Status: **M4 of 7 done** (auth, per-user access
control, questionnaire, version history, LLM drafts in background jobs, Stripe
one-time payment with replay-safe webhooks). The
full README comes in M7.

## Setup

You need Docker, Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
# set AUTH_SECRET in .env.local:  openssl rand -base64 32
docker compose up -d          # Postgres on 5440, test Postgres on 5441, Mailpit on 8025
pnpm db:migrate
pnpm dev                      # http://localhost:3100
pnpm worker                   # in a second terminal: runs background jobs
pnpm stripe:listen            # in a third terminal: forwards Stripe test webhooks
```

For payments, put a Stripe **test** key (`sk_test_...`) in `.env.local`. Run
`pnpm stripe:listen` once and copy the `whsec_...` value it prints into
`STRIPE_WEBHOOK_SECRET`. Test card: `4242 4242 4242 4242`, any future date,
any CVC.

The LLM is a mock by default (`LLM_PROVIDER=mock`), so no API key is needed.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app on port 3100 |
| `pnpm worker` | Run the background job worker |
| `pnpm test` | Vitest against the test database |
| `pnpm test:e2e` | Playwright browser tests |
| `pnpm stripe:listen` | Forward Stripe test webhooks to the app |
| `pnpm test:e2e:stripe` | A real test-mode payment in a browser (needs `stripe:listen`) |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm llm:smoke` | One real Anthropic API call (needs a key, costs a few cents) |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply migrations |

## Docs

- [docs/DECISIONS.md](docs/DECISIONS.md): what was chosen and why
- [docs/evidence/](docs/evidence/): proof for each claim
