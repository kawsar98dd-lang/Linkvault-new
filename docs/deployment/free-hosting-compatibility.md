# Hosting compatibility — current architecture

## Current requirements

The repository currently contains a Next.js application and PostgreSQL/Drizzle migrations with PostgreSQL-specific roles and Row-Level Security. It is not a static website.

## Cloudflare

- Cloudflare Pages static hosting alone is not sufficient for the current backend.
- Cloudflare Workers can host supported Next.js applications through an adapter such as OpenNext, but the adapter, runtime compatibility, and all dependencies must be tested before claiming support.
- Cloudflare D1 is not a drop-in replacement for the PostgreSQL schema/migrations in this repository. Switching to D1 requires a planned database and RLS/security redesign, not a simple environment-variable change.
- A separate PostgreSQL provider is required unless the architecture is deliberately migrated. Free-tier terms, sleep limits, and card requirements change and must be checked at deployment time.

## Release rule

Do not publish a Cloudflare deployment guide as verified until a real deployment has passed login, database migration, tenant-isolation, API, redirect, and production smoke tests. No Cloudflare adapter or production deployment is claimed by this preparation package.
