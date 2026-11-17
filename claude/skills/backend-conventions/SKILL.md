---
name: backend-conventions
description: Conventions for Supabase/Postgres backends and API contracts (migrations, RLS, edge functions, shared Zod contracts). Use before changing schema, migrations, RLS policies, SQL functions, edge functions or any request/response shape.
---

# Backend conventions

`AGENTS.md` holds the repo's paths, test harness (pgTAP, Deno) and approval rules. Read it first; it wins on conflict.

## Migrations

- Schema changes are migrations. Append-only: never edit an applied migration.
- Backward-aware: check existing rows and every consumer before changing a type, nullability, default or relationship. Plan backfill or compatibility first.
- App code never assumes a shape the deployed DB does not have yet.
- Destructive migrations (drop, narrowing type, data delete) need explicit human approval.

## Security

- Every table has RLS and a test for it. Never disable or weaken a policy to make a query work.
- Security-definer functions `set search_path` and are revoked from `public`/`anon` unless meant to be called.
- Authorize on the authenticated identity plus the resource. Possessing an id grants nothing. Never trust frontend checks.
- Secrets only in the platform's secret stores (function secrets, Vault, hosting env). Never in client-exposed env vars.

## Queries

- Keep queries in the data layer. `.select()` only needed columns.
- Filter, sort, paginate and aggregate in the DB. No queries in loops; use joins, relational selects or batching.
- Invariants that must always hold are DB constraints / FKs, not app checks.
- Multi-step writes use a DB-side mechanism (transaction, RPC), not several client calls. No RPC for trivial logic.

## API contracts

- The contract is shared. Source of truth: schema/spec → backend validation → shared contract (e.g. Zod in `shared/`) → frontend types.
- Validate untrusted input at the boundary before business logic. Do not silently coerce.
- Optional ≠ nullable: omitted means "no value", `null` means "cleared". State which for each field.
- Errors carry a stable code, status and message; consumers branch on code. 401 = not authenticated, 403 = not allowed, 404 = missing or hidden. Never leak internals.
- Safe: add optional response field, endpoint or error code; widen input. Breaking: remove/rename/retype a field, tighten input, change auth, status, error meaning or pagination. Breaking changes update every consumer in the same change.

## Logic in two places

When a rule exists in SQL (authoritative) and in the client (instant feedback), change both together and keep their worked-example tests identical.
