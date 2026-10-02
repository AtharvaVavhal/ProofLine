# Proofline

**Trace the Evidence. Build the Case.**

The product and engineering specifications are in [`docs/`](docs/) (01–16 plus `DECISIONS.md`).
This README covers only what is implemented so far.

## Status

| Phase (docs/14)         | State                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 Repository bootstrap | Minimal: pnpm workspace, `apps/api` (NestJS), `packages/shared` placeholder, lint/format, Docker Compose (PostgreSQL), CI workflow. `apps/web` and the storage emulator are not created yet. |
| P1 Database foundation  | Implemented: the full `docs/03` schema, initial migration, Prisma client module, health check.                                                                                               |
| P2 Authentication       | Implemented: email-code sign-in (`POST /api/auth/request-code`, `/verify-code`, `/logout`), httpOnly session cookie, global session guard, Origin check, audit writer, rate limits.          |
| P3+                     | Not started. There are no case, evidence, processing, AI, report or frontend features.                                                                                                       |

## Layout

```text
apps/api/                    NestJS API (+ worker in later phases)
  prisma/schema.prisma       Prisma models for the 30 tables of docs/03
  prisma/migrations/         One initial migration (generated DDL + hand-written SQL)
  src/config/                zod-validated environment (fails fast at boot)
  src/database/              PrismaService / DatabaseModule (one client per process)
  src/common/                error envelope, request ID + security headers, Origin check, validation
  src/auth/                  sign-in codes, sessions, AuthGuard, EmailTransport port (console in dev)
  src/users/ src/audit/      users table owner; same-transaction audit writer with metadata whitelist
  src/health/                GET /api/health (SELECT 1, public)
  test/                      config, health, schema-inspection and constraint tests
packages/shared/             shared zod schemas and types (empty until a phase defines them)
docker/postgres/init/        creates the least-privilege application role on a fresh volume
docker-compose.yml           local PostgreSQL 16
```

## Requirements

- Node.js 22+ and pnpm 11 (`corepack enable`)
- PostgreSQL 15+ (the schema uses `UNIQUE NULLS NOT DISTINCT` and `ON DELETE SET NULL (column)`)

## Local setup

```bash
pnpm install
docker compose up -d                      # PostgreSQL 16; creates proofline_dev and the app role
cp apps/api/.env.example apps/api/.env
pnpm db:generate                          # Prisma client
pnpm db:migrate                           # prisma migrate deploy (as the migration role)
pnpm dev                                  # builds packages/shared, then the API in watch mode → http://localhost:3001/api/health
```

When using an existing PostgreSQL server instead of Docker, run
`docker/postgres/init/01-app-role.sql` once as a role with `CREATEROLE`. Then create
`proofline_dev`, owned by the migration role.

### Database roles

| Role                                                              | Used by                  | Privileges                                                           |
| ----------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| Migration role (`DATABASE_MIGRATION_URL`)                         | Prisma CLI (`directUrl`) | Owns the schema (DDL)                                                |
| `proofline_app` (NOLOGIN) / `proofline_app_user` (`DATABASE_URL`) | The API at runtime       | DML on domain tables; **INSERT/SELECT only on `audit_logs`**; no DDL |

`audit_logs` also has a trigger that rejects `UPDATE`, `DELETE` and `TRUNCATE` for every role.

### Seed data

There is no seed, by design. `docs/03` §28.3 and `docs/14` Phase 1 specify no seeded product
data. The synthetic demo case is uploaded through the product, so its fingerprints are computed
by the real path (Phase 17).

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
pnpm test                                  # needs a migrated database; see below
pnpm --filter @proofline/api db:drift      # migrations ↔ schema.prisma must be identical
```

The tests read `apps/api/.env.test` and refuse to run unless `DATABASE_URL` names a database containing "test". Point it at a **separate**
database, because audit rows written by the tests cannot be deleted. Example: create
`proofline_test`, copy `.env.example` to `.env.test` with that database name, then run
`pnpm db:migrate` with that environment.

## Schema notes

- Prisma cannot express everything in `docs/03`. The CHECK constraints, partial indexes,
  generated columns, `UNIQUE NULLS NOT DISTINCT`, `ON DELETE SET NULL (column)`, triggers,
  views and grants live in the hand-written section of the initial migration. They are listed
  at the top of `schema.prisma`.
- Prisma's drift detection ignores those constructs but not foreign keys or plain indexes, so
  every FK and non-partial index is declared in `schema.prisma`. `db:drift` must stay empty.
- Two relations (`extractions.entity_id`, `agent_steps.evidence_id`) are declared `SetNull` in
  Prisma. This prints a warning, because `case_id` is required. The migration narrows them to
  `SET NULL (entity_id)` / `SET NULL (evidence_id)`.
- Future migrations: create them with `prisma migrate dev --create-only`, then review them.
  Grant privileges on any new table to `proofline_app` explicitly.
