import { prisma } from './db';

// Inspects the live database catalogue against docs/03-DATABASE-SCHEMA.md rather than trusting
// `prisma validate`.

const TABLES = [
  'users',
  'otp_challenges',
  'sessions',
  'cases',
  'evidence_items',
  'parse_results',
  'source_pages',
  'source_lines',
  'sensitive_detections',
  'extractions',
  'extraction_source_lines',
  'user_statements',
  'entities',
  'relationships',
  'fact_sources',
  'timeline_events',
  'timeline_event_entities',
  'analysis_runs',
  'agent_steps',
  'scam_signals',
  'missing_information_items',
  'action_items',
  'urgency_assessments',
  'urgency_reasons',
  'reports',
  'review_confirmations',
  'exports',
  'export_evidence_items',
  'integrity_verifications',
  'audit_logs',
];

// Tables that carry case_id (every table except identity and audit, 03 §20).
const CASE_OWNED = TABLES.filter(
  (t) => !['users', 'otp_challenges', 'sessions', 'cases'].includes(t),
);

async function rows<T>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('schema objects', () => {
  it('has exactly the 30 specified tables', async () => {
    const found = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`,
    );
    expect(found.map((r) => r.table_name).sort()).toEqual([...TABLES].sort());
  });

  it('has the 2 derived views', async () => {
    const found = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(found.map((r) => r.table_name)).toEqual(['case_overview', 'entity_evidence_links']);
  });

  it('has case_reference_seq starting at 10001', async () => {
    const [seq] = await rows<{ start_value: bigint }>(
      `SELECT start_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'case_reference_seq'`,
    );
    expect(seq?.start_value).toBe(10001n);
  });

  it('has the 48 column enum types from 03 §4.1 (upload_rejection_code has no column)', async () => {
    const found = await rows<{ typname: string }>(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    );
    expect(found).toHaveLength(48);
    expect(found.map((r) => r.typname)).not.toContain('upload_rejection_code');
  });

  it('declares case_status values in spec order', async () => {
    const found = await rows<{ v: string }>(
      `SELECT unnest(enum_range(NULL::case_status))::text AS v`,
    );
    expect(found.map((r) => r.v)).toEqual([
      'NEW',
      'INGESTING',
      'EXTRACTED',
      'ANALYZING',
      'CORRELATED',
      'TIMELINE_READY',
      'ACTIONS_READY',
      'REPORT_DRAFT',
      'USER_REVIEW',
      'EXPORTED',
    ]);
  });

  it('has exactly the 8 relation types and 10 timeline event types', async () => {
    const rel = await rows<{ v: string }>(
      `SELECT unnest(enum_range(NULL::relation_type))::text AS v`,
    );
    const tl = await rows<{ v: string }>(
      `SELECT unnest(enum_range(NULL::timeline_event_type))::text AS v`,
    );
    expect(rel).toHaveLength(8);
    expect(tl).toHaveLength(10);
  });

  it('gives every case-owned table a NOT NULL case_id', async () => {
    const found = await rows<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'case_id'`,
    );
    const byTable = new Map(found.map((r) => [r.table_name, r.is_nullable]));
    for (const table of CASE_OWNED) {
      // audit_logs.case_id is nullable and has no FK by design (03 §19.1).
      expect(byTable.get(table)).toBe(table === 'audit_logs' ? 'YES' : 'NO');
    }
  });

  it('generates evidence_ref and has_usable_text_layer as stored generated columns', async () => {
    const found = await rows<{ column_name: string; is_generated: string }>(
      `SELECT column_name, is_generated FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('evidence_ref', 'has_usable_text_layer')`,
    );
    expect(found.every((r) => r.is_generated === 'ALWAYS')).toBe(true);
    expect(found).toHaveLength(2);
  });
});

describe('foreign keys', () => {
  type Fk = { table_name: string; def: string };
  let fks: Fk[];

  beforeAll(async () => {
    fks = await rows<Fk>(
      `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
  });

  const has = (table: string, pattern: RegExp) =>
    fks.some((fk) => fk.table_name === table && pattern.test(fk.def));

  it('has no foreign key on audit_logs (survives case deletion)', () => {
    expect(fks.filter((fk) => fk.table_name === 'audit_logs')).toHaveLength(0);
  });

  it.each([
    ['sessions', /\(user_id\) REFERENCES users\(id\) ON UPDATE CASCADE ON DELETE CASCADE/],
    ['cases', /\(user_id\) REFERENCES users\(id\) ON UPDATE CASCADE ON DELETE RESTRICT/],
    ['evidence_items', /\(case_id\) REFERENCES cases\(id\).*ON DELETE CASCADE/],
    [
      'parse_results',
      /\(evidence_id, case_id\) REFERENCES evidence_items\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'source_lines',
      /\(parse_result_id, page_number\) REFERENCES source_pages\(parse_result_id, page_number\)/,
    ],
    [
      'extractions',
      /\(entity_id, case_id\) REFERENCES entities\(id, case_id\).*ON DELETE SET NULL \(entity_id\)/,
    ],
    [
      'extraction_source_lines',
      /\(source_line_id, case_id\) REFERENCES source_lines\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'relationships',
      /\(from_entity_id, case_id\) REFERENCES entities\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'fact_sources',
      /\(user_statement_id, case_id\) REFERENCES user_statements\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'fact_sources',
      /\(urgency_reason_id, case_id\) REFERENCES urgency_reasons\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'agent_steps',
      /\(evidence_id, case_id\) REFERENCES evidence_items\(id, case_id\).*ON DELETE SET NULL \(evidence_id\)/,
    ],
    ['scam_signals', /\(agent_step_id\) REFERENCES agent_steps\(id\).*ON DELETE CASCADE/],
    [
      'review_confirmations',
      /\(report_id, case_id\) REFERENCES reports\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'exports',
      /\(review_confirmation_id, report_id\) REFERENCES review_confirmations\(id, report_id\)/,
    ],
    [
      'export_evidence_items',
      /\(evidence_id, case_id\) REFERENCES evidence_items\(id, case_id\).*ON DELETE CASCADE/,
    ],
    [
      'integrity_verifications',
      /\(evidence_id, case_id\) REFERENCES evidence_items\(id, case_id\).*ON DELETE CASCADE/,
    ],
  ])('%s has %s', (table, pattern) => {
    expect(has(table, pattern)).toBe(true);
  });

  it('references fact_sources owners and targets through composite case FKs only', () => {
    const own = fks.filter((fk) => fk.table_name === 'fact_sources');
    expect(own).toHaveLength(11);
    expect(own.every((fk) => /, case_id\) REFERENCES \w+\(id, case_id\)/.test(fk.def))).toBe(true);
  });
});

describe('indexes and unique constraints (03 §21)', () => {
  type Ix = { tablename: string; indexdef: string };
  let indexes: Ix[];

  beforeAll(async () => {
    indexes = await rows<Ix>(
      `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
  });

  it.each([
    ['cases', /\(user_id, updated_at DESC\)/],
    ['cases', /UNIQUE INDEX .* \(case_reference\)/],
    ['cases', /UNIQUE INDEX .* \(id, user_id\)/],
    ['sessions', /UNIQUE INDEX .* \(token_hash\)/],
    ['sessions', /\(expires_at\)/],
    ['otp_challenges', /\(email, created_at DESC\)/],
    ['otp_challenges', /\(requester_fingerprint\)/],
    ['evidence_items', /UNIQUE INDEX .* \(case_id, sequence_no\)/],
    ['evidence_items', /\(case_id, processing_status\)/],
    ['evidence_items', /\(case_id, sha256\)/],
    ['evidence_items', /UNIQUE INDEX .* \(storage_key\)/],
    ['evidence_items', /\(processing_status, created_at\) WHERE \(processing_status = 'UPLOADING'/],
    ['parse_results', /UNIQUE INDEX .* \(evidence_id\)/],
    ['source_lines', /UNIQUE INDEX .* \(parse_result_id, page_number, line_number\)/],
    ['source_lines', /\(evidence_id\)/],
    ['extractions', /\(case_id, field_type\)/],
    ['extractions', /\(entity_id\)/],
    ['extraction_source_lines', /\(source_line_id\)/],
    ['entities', /UNIQUE INDEX .* \(case_id, entity_type, canonical_value\)/],
    ['relationships', /UNIQUE INDEX .* \(case_id, from_entity_id, relation_type, to_entity_id\)/],
    ['relationships', /\(to_entity_id\)/],
    ['fact_sources', /UNIQUE INDEX .* NULLS NOT DISTINCT/],
    ['fact_sources', /\(extraction_id\) WHERE \(extraction_id IS NOT NULL\)/],
    ['timeline_events', /\(case_id, sort_order\)/],
    ['timeline_events', /UNIQUE INDEX .* \(case_id, event_key\)/],
    ['timeline_event_entities', /\(entity_id\)/],
    ['analysis_runs', /UNIQUE INDEX .* \(case_id\) WHERE \(status = ANY/],
    ['analysis_runs', /\(case_id, created_at DESC\)/],
    ['agent_steps', /\(run_id, sequence_no\)/],
    ['agent_steps', /\(case_id, step_name, evidence_id, input_hash\) WHERE \(status = 'SUCCEEDED'/],
    ['scam_signals', /UNIQUE INDEX .* \(case_id\) WHERE is_primary/],
    ['scam_signals', /UNIQUE INDEX .* \(case_id, label\)/],
    ['missing_information_items', /UNIQUE INDEX .* \(case_id, finding_key\)/],
    ['action_items', /UNIQUE INDEX .* \(case_id, action_code\)/],
    ['urgency_assessments', /UNIQUE INDEX .* \(case_id\) WHERE is_current/],
    ['urgency_assessments', /\(case_id, computed_at DESC\)/],
    ['urgency_reasons', /UNIQUE INDEX .* \(assessment_id, ordinal\)/],
    ['reports', /UNIQUE INDEX .* \(case_id, version_number\)/],
    ['reports', /\(case_id, status\)/],
    ['review_confirmations', /UNIQUE INDEX .* \(report_id\) WHERE \(voided_at IS NULL\)/],
    ['review_confirmations', /UNIQUE INDEX .* \(id, report_id\)/],
    ['exports', /\(case_id, created_at DESC\)/],
    ['exports', /\(report_id\)/],
    ['integrity_verifications', /\(evidence_id, verified_at DESC\)/],
    ['audit_logs', /\(case_id, occurred_at DESC\)/],
    ['audit_logs', /\(actor_user_id, occurred_at DESC\)/],
    ['audit_logs', /\(request_id\)/],
  ])('%s has index %s', (table, pattern) => {
    expect(indexes.some((ix) => ix.tablename === table && pattern.test(ix.indexdef))).toBe(true);
  });

  it('exposes UNIQUE (id, case_id) on every case-owned parent', () => {
    const parents = [
      'evidence_items',
      'parse_results',
      'source_lines',
      'extractions',
      'user_statements',
      'entities',
      'relationships',
      'timeline_events',
      'analysis_runs',
      'agent_steps',
      'scam_signals',
      'missing_information_items',
      'action_items',
      'urgency_assessments',
      'urgency_reasons',
      'reports',
      'exports',
    ];
    for (const table of parents) {
      expect(
        indexes.some(
          (ix) => ix.tablename === table && /UNIQUE INDEX .* \(id, case_id\)/.test(ix.indexdef),
        ),
      ).toBe(true);
    }
  });
});

describe('triggers and privileges', () => {
  it('has the immutability and append-only triggers', async () => {
    const found = await rows<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
    );
    expect(found.map((r) => r.tgname)).toEqual([
      'audit_logs_append_only_row',
      'audit_logs_append_only_truncate',
      'evidence_items_fingerprint_immutable',
      'timeline_events_originals_immutable',
    ]);
  });

  it('grants the application role INSERT/SELECT only on audit_logs', async () => {
    const found = await rows<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'proofline_app' AND table_name = 'audit_logs' ORDER BY privilege_type`,
    );
    expect(found.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });
});
