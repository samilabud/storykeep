#!/usr/bin/env bash
# Evidence script: replays the newest real checkout.session.completed event
# twice with the Stripe CLI and shows that nothing changes in the database.
# Needs `pnpm dev` and `pnpm stripe:listen` running, and one test payment made.
set -euo pipefail
set -a; . ./.env.local; set +a

sql() { docker compose exec -T postgres psql -U storykeep -d storykeep "$@"; }
state() {
  sql -c "select id, type, received_at, processed_at is not null as processed from stripe_events where id='$EVT'" \
      -c "select status, amount_cents, consumed_at is not null as used from orders where stripe_checkout_session_id='$SESS'" \
      -c "select (select count(*) from stripe_events) as events_total, (select count(*) from orders) as orders_total, (select count(*) from orders where status='paid') as orders_paid"
}

EVT=$(sql -t -A -c "select id from stripe_events where type='checkout.session.completed' order by received_at desc limit 1")
SESS=$(sql -t -A -c "select payload->'data'->'object'->>'id' from stripe_events where id='$EVT'")

echo "# Replay of a REAL Stripe test-mode event, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# event: $EVT"
echo
echo "## Before the replay"
state
echo "## Replay it twice with the Stripe CLI"
for i in 1 2; do
  echo "\$ stripe events resend $EVT"
  stripe events resend "$EVT" --api-key "$STRIPE_SECRET_KEY" | grep -E '"(id|type)":' | head -2
  sleep 3
done
echo
echo "## After the replay: same rows, same counts"
state
