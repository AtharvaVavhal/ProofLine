// Installs or upgrades the pg-boss queue schema and creates the analysis queue, as the
// migration role (DATABASE_MIGRATION_URL), then grants the runtime role row access only
// (03 §20: no DDL for the application role; the queue schema is outside Prisma, 03 §28.3).
// Run after `pnpm db:migrate`. Idempotent.
import PgBoss from 'pg-boss';

const QUEUE = 'analyze-case';
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('queue:install: DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}

const boss = new PgBoss({ connectionString: url, schedule: false, supervise: false });
await boss.start();
if (!(await boss.getQueue(QUEUE))) await boss.createQueue(QUEUE, { policy: 'singleton' });
await boss.getDb().executeSql(
  `GRANT USAGE ON SCHEMA pgboss TO proofline_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO proofline_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO proofline_app;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO proofline_app;`,
  [],
);
await boss.stop({ graceful: false });
console.log(`queue:install: pg-boss schema ready; queue ${QUEUE} exists; runtime grants applied`);
