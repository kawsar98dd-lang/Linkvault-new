# Database: schema, roles, RLS (implemented; NOT yet verified against a live PostgreSQL)

Source of truth: `packages/db/migrations/0001_init.sql`. `packages/db/src/schema.ts` mirrors it for typed
queries; `test/schema-parity.int.test.ts` fails CI if they diverge.

## Roles (`packages/db/src/provision.ts`, run once by an admin via `pnpm db:provision`)
| role | purpose | notes |
|---|---|---|
| `app_rw` | runtime | LOGIN, NOSUPERUSER, NOBYPASSRLS, no DDL, owns nothing |
| `app_migrator` | migrations only | owns objects; never deployed to runtime |
| `audit_writer` | NOLOGIN | owns `audit_internal.write_event`; only INSERT on `audit_logs` |

`app_rw` MUST NOT have BYPASSRLS. This is asserted by `roles.int.test.ts`, by the CI step "Verify
runtime role cannot bypass RLS (live database)", and at runtime by `/readyz` (fail-closed).

## Tenant context
`withTenant(db, {userId, workspaceId}, fn)` opens a transaction and runs
`set_config('app.user_id', …, true)`, `set_config('app.workspace_id', …, true)` (transaction-local), so
nothing leaks through pooled connections. IDs are validated (UUID / bounded string) **before** any SQL.
`withUser` binds an empty workspace (user-scoped reads such as "my workspaces").

## RLS summary
| table | policy intent |
|---|---|
| workspaces | SELECT for active members; INSERT only for `id = bound workspace AND owner = current user`; UPDATE only inside the bound workspace; no DELETE privilege (soft delete) |
| memberships | own rows anywhere; other rows only in the bound workspace by active members; first (owner) row only via one-time `can_bootstrap_owner`; no DELETE privilege |
| invitations | bound workspace + active member (all commands) |
| idempotency_keys | `actor_user_id = current user` and (no workspace or bound workspace + member) |
| outbox_events | INSERT/SELECT in the bound workspace (system rows with NULL workspace: insert only) |
| audit_logs | SELECT in the bound workspace; INSERT only by `audit_writer` (via function); triggers forbid UPDATE/DELETE/TRUNCATE for everyone |
| users/sessions/accounts/verifications/two_factors | **no RLS** (owned by the auth provider, see limitations) |

`SECURITY DEFINER` helpers (`is_active_member`, `can_bootstrap_owner`, `accept_invitation`,
`audit_internal.write_event`) have `search_path` pinned, `EXECUTE` revoked from PUBLIC, and are the only
controlled exceptions to RLS. `accept_invitation` runs without tenant context (the invitee is not yet a
member); it validates token hash, expiry, state and the caller's verified e-mail, and returns the same
error for every failure mode.

## Invariants enforced by the database
Single active owner per workspace (partial unique index); lowercase unique e-mails; role/status CHECKs;
pending-invitation uniqueness; append-only audit; composite scoping via policies.

## Known limitations / deviations
- `app_rw` can read the auth tables (needed by Better Auth). Core only joins `users` for members of the
  caller's workspace. A dedicated `auth_rw` role is a recommended follow-up.
- UUID v4 (`gen_random_uuid()`) instead of UUID v7 (not available before PostgreSQL 18); public ids are
  random (`ws_…`).
- `audit_logs` is not yet partitioned by month (spec §10); add before volume grows.
- No cleanup job for expired idempotency keys / published outbox rows yet.
- `ALTER SCHEMA public OWNER TO app_migrator` needs admin rights; confirm it is permitted on the chosen
  Neon plan (may need the project owner role).
