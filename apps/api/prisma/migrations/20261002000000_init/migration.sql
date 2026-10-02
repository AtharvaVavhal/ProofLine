-- Proofline initial schema (docs/03-DATABASE-SCHEMA.md v1.1): 30 tables, 2 views, 1 sequence.
-- Requires PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT, ON DELETE SET NULL (column list),
-- gen_random_uuid(), generated columns).
--
-- Sections:
--   1. Sequence for case references (must exist before the cases.case_reference default)
--   2. Prisma-generated DDL (enums, tables, indexes, foreign keys), with four hand edits marked
--      [03 HAND EDIT]: two generated columns, two ON DELETE SET NULL (column) composite FKs,
--      and NULLS NOT DISTINCT on fact_sources_link_key
--   3. Hand-authored SQL: CHECKs, partial indexes, triggers, views, grants

-- 1. case_reference_seq: 'CF-' || nextval(...) starting at CF-10001 (03 §5.1).
CREATE SEQUENCE "case_reference_seq" AS bigint START WITH 10001;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_auth_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "case_status" AS ENUM ('NEW', 'INGESTING', 'EXTRACTED', 'ANALYZING', 'CORRELATED', 'TIMELINE_READY', 'ACTIONS_READY', 'REPORT_DRAFT', 'USER_REVIEW', 'EXPORTED');

-- CreateEnum
CREATE TYPE "incident_time_precision" AS ENUM ('EXACT', 'APPROXIMATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "scam_label" AS ENUM ('PHISHING', 'KYC_IMPERSONATION', 'FAKE_INVESTMENT', 'FAKE_JOB_OR_LOAN', 'UPI_FRAUD', 'ACCOUNT_TAKEOVER', 'DIGITAL_ARREST_IMPERSONATION', 'MARKETPLACE_FRAUD', 'UNKNOWN_OTHER');

-- CreateEnum
CREATE TYPE "evidence_type" AS ENUM ('PNG', 'JPEG', 'PDF', 'TXT', 'EML', 'TEXT', 'URL');

-- CreateEnum
CREATE TYPE "paste_kind" AS ENUM ('MESSAGE', 'CHAT_TRANSCRIPT', 'URL');

-- CreateEnum
CREATE TYPE "evidence_processing_status" AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "evidence_failure_code" AS ENUM ('TRANSFER_FAILED', 'FINGERPRINT_FAILED', 'STORAGE_UNAVAILABLE', 'NO_READABLE_TEXT', 'OCR_FAILED', 'PDF_NO_TEXT_LAYER', 'EMAIL_UNPARSEABLE', 'EMAIL_ENCRYPTED', 'EXTRACTION_FAILED');

-- CreateEnum
CREATE TYPE "parser_kind" AS ENUM ('IMAGE_OCR', 'PDF_TEXT_LAYER', 'PLAIN_TEXT', 'EMAIL_MIME', 'URL_STRING');

-- CreateEnum
CREATE TYPE "parse_status" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "line_location_kind" AS ENUM ('TEXT_LINE', 'EMAIL_HEADER', 'EMAIL_BODY_LINE');

-- CreateEnum
CREATE TYPE "sensitive_kind" AS ENUM ('OTP', 'CARD_NUMBER');

-- CreateEnum
CREATE TYPE "entity_type" AS ENUM ('PERSON', 'PHONE', 'EMAIL', 'URL', 'DOMAIN', 'UPI_ID', 'TRANSACTION', 'AMOUNT', 'BANK_OR_WALLET', 'ACCOUNT_HINT', 'SMS_SENDER_HEADER', 'MESSAGING_HANDLE', 'DATETIME');

-- CreateEnum
CREATE TYPE "extraction_method" AS ENUM ('OCR', 'PDF_TEXT', 'TEXT_PARSE', 'RULE', 'LLM', 'USER');

-- CreateEnum
CREATE TYPE "confidence_band" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "confidence_basis" AS ENUM ('SOURCE_VALIDATION', 'MODEL_JUDGEMENT');

-- CreateEnum
CREATE TYPE "normalization_status" AS ENUM ('NORMALIZED', 'NOT_NORMALIZED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "correction_status" AS ENUM ('UNMODIFIED', 'USER_CORRECTED');

-- CreateEnum
CREATE TYPE "statement_kind" AS ENUM ('CASE_METADATA', 'FOLLOW_UP_ANSWER', 'CORRECTION', 'ADDED_EVENT');

-- CreateEnum
CREATE TYPE "relation_type" AS ENUM ('HOSTED_ON', 'SENT_LINK', 'REQUESTED_PAYMENT_TO', 'PAID_TO', 'AMOUNT_OF', 'DEBITED_FROM', 'MESSAGE_CONTAINED', 'CONTACTED_FROM');

-- CreateEnum
CREATE TYPE "timeline_event_type" AS ENUM ('MESSAGE_RECEIVED', 'MESSAGE_SENT', 'CALL', 'LINK_OPENED', 'CREDENTIAL_OTP_REQUEST', 'CREDENTIALS_OR_OTP_SHARED', 'PAYMENT_REQUESTED', 'PAYMENT_INITIATED', 'DEBIT_NOTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "timestamp_precision" AS ENUM ('EXACT', 'APPROXIMATE', 'INFERRED_ORDER_ONLY');

-- CreateEnum
CREATE TYPE "event_origin" AS ENUM ('AI_GENERATED', 'USER_ADDED');

-- CreateEnum
CREATE TYPE "run_kind" AS ENUM ('ANALYSIS', 'REPORT_GENERATION');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "run_trigger" AS ENUM ('USER_START', 'USER_RETRY', 'ANSWER', 'CORRECTION', 'EVIDENCE_DELETION');

-- CreateEnum
CREATE TYPE "step_name" AS ENUM ('PLAN', 'PARSE', 'EXTRACT', 'NORMALIZE', 'SCAM_ANALYSIS', 'CORRELATE', 'TIMELINE', 'MISSING_INFO', 'ACTIONS', 'URGENCY', 'REPORT');

-- CreateEnum
CREATE TYPE "step_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "finding_kind" AS ENUM ('MISSING_FIELD', 'CONTRADICTION', 'MISSING_TIMESTAMP', 'MISSING_EVIDENCE');

-- CreateEnum
CREATE TYPE "checklist_field" AS ENUM ('INCIDENT_DATETIME', 'INCIDENT_DETAILS', 'IDENTITY_DOCUMENT', 'BANK_WALLET_MERCHANT', 'TRANSACTION_ID_UTR', 'TRANSACTION_DATE', 'FRAUD_AMOUNT', 'RELEVANT_EVIDENCE', 'SUSPECT_DETAILS');

-- CreateEnum
CREATE TYPE "checklist_variant" AS ENUM ('FINANCIAL', 'ALL_INCIDENTS');

-- CreateEnum
CREATE TYPE "finding_status" AS ENUM ('OPEN', 'RESOLVED', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "finding_resolution" AS ENUM ('USER_ANSWER', 'USER_CORRECTION', 'NEW_EVIDENCE', 'NO_LONGER_APPLICABLE');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('NONE', 'OPEN', 'ANSWERED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "action_status" AS ENUM ('TODO', 'DONE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "urgency_level" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "urgency_signal" AS ENUM ('U1_FINANCIAL_LOSS', 'U2_CREDENTIAL_EXPOSURE');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('GENERATING', 'GENERATED', 'FAILED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "report_invalidation_reason" AS ENUM ('EVIDENCE_DELETED');

-- CreateEnum
CREATE TYPE "confirmation_void_reason" AS ENUM ('CASE_CHANGED', 'REPORT_REGENERATED', 'EVIDENCE_DELETED');

-- CreateEnum
CREATE TYPE "export_format" AS ENUM ('REPORT_PDF', 'ZIP_BUNDLE');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "verification_result" AS ENUM ('MATCH', 'MISMATCH', 'COULD_NOT_COMPLETE');

-- CreateEnum
CREATE TYPE "verification_failure_code" AS ENUM ('STORAGE_UNAVAILABLE', 'OBJECT_MISSING');

-- CreateEnum
CREATE TYPE "attestation_result" AS ENUM ('MATCH', 'MISMATCH', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "fact_ref_kind" AS ENUM ('EXTRACTION', 'EVIDENCE', 'USER_STATEMENT');

-- CreateEnum
CREATE TYPE "audit_actor_kind" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCEEDED', 'FAILED', 'DENIED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "auth_status" "user_auth_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(6),
    "requester_fingerprint" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "case_reference" TEXT NOT NULL DEFAULT ('CF-'::text || nextval('case_reference_seq'::regclass)),
    "status" "case_status" NOT NULL DEFAULT 'NEW',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incident_time" TIMESTAMPTZ(6),
    "incident_time_precision" "incident_time_precision",
    "contact_text" TEXT,
    "location_text" TEXT,
    "summary" TEXT,
    "incident_type" "scam_label",
    "financial_loss_reported" BOOLEAN,
    "checklist_variant" "checklist_variant",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "sequence_no" SMALLINT NOT NULL,
    "evidence_ref" TEXT NOT NULL GENERATED ALWAYS AS ('E' || lpad(sequence_no::text, 2, '0')) STORED, -- [03 HAND EDIT]
    "evidence_type" "evidence_type" NOT NULL,
    "paste_kind" "paste_kind",
    "label" TEXT,
    "original_filename" TEXT,
    "declared_content_type" TEXT,
    "detected_content_type" TEXT,
    "byte_size" BIGINT,
    "text_char_count" INTEGER,
    "page_count" SMALLINT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "storage_key" TEXT NOT NULL,
    "sha256" CHAR(64),
    "uploaded_at" TIMESTAMPTZ(6),
    "processing_status" "evidence_processing_status" NOT NULL DEFAULT 'UPLOADING',
    "failure_code" "evidence_failure_code",
    "failure_retryable" BOOLEAN,
    "failure_detail" JSONB,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "attestation_ref" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parse_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "agent_step_id" UUID,
    "parser_kind" "parser_kind" NOT NULL,
    "engine" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "status" "parse_status" NOT NULL,
    "page_count" SMALLINT NOT NULL,
    "failure_code" "evidence_failure_code",
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parse_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_pages" (
    "parse_result_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "page_number" SMALLINT NOT NULL,
    "non_whitespace_char_count" INTEGER,
    "has_usable_text_layer" BOOLEAN GENERATED ALWAYS AS (non_whitespace_char_count >= 10) STORED, -- [03 HAND EDIT]
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_pages_pkey" PRIMARY KEY ("parse_result_id","page_number")
);

-- CreateTable
CREATE TABLE "source_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "parse_result_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "page_number" SMALLINT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "location_kind" "line_location_kind" NOT NULL DEFAULT 'TEXT_LINE',
    "header_name" TEXT,
    "text" TEXT NOT NULL,
    "bbox" JSONB,
    "ocr_confidence" DECIMAL(4,3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitive_detections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "source_line_id" UUID NOT NULL,
    "kind" "sensitive_kind" NOT NULL,
    "char_start" INTEGER NOT NULL,
    "char_end" INTEGER NOT NULL,
    "detector_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensitive_detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "parse_result_id" UUID NOT NULL,
    "agent_step_id" UUID,
    "field_type" "entity_type" NOT NULL,
    "raw_value" TEXT NOT NULL,
    "normalized_value" TEXT,
    "normalization_status" "normalization_status" NOT NULL,
    "value_amount_minor" BIGINT,
    "value_currency" CHAR(3),
    "value_datetime" TIMESTAMPTZ(6),
    "value_datetime_precision" "timestamp_precision",
    "source_label" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "method" "extraction_method" NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "confidence_basis" "confidence_basis" NOT NULL,
    "confidence_band" "confidence_band" NOT NULL,
    "snippet" TEXT NOT NULL,
    "entity_id" UUID,
    "correction_status" "correction_status" NOT NULL DEFAULT 'UNMODIFIED',
    "corrected_value" TEXT,
    "corrected_normalized_value" TEXT,
    "correction_statement_id" UUID,
    "corrected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_source_lines" (
    "extraction_id" UUID NOT NULL,
    "source_line_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "ordinal" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_source_lines_pkey" PRIMARY KEY ("extraction_id","source_line_id")
);

-- CreateTable
CREATE TABLE "user_statements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "statement_kind" "statement_kind" NOT NULL,
    "subject" TEXT NOT NULL,
    "value_text" TEXT NOT NULL,
    "normalized_value" TEXT,
    "value_datetime" TIMESTAMPTZ(6),
    "value_amount_minor" BIGINT,
    "supersedes_statement_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "entity_type" "entity_type" NOT NULL,
    "canonical_value" TEXT NOT NULL,
    "masked_value" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "is_user_stated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "from_entity_id" UUID NOT NULL,
    "relation_type" "relation_type" NOT NULL,
    "to_entity_id" UUID NOT NULL,
    "agent_step_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "relationship_id" UUID,
    "timeline_event_id" UUID,
    "scam_signal_id" UUID,
    "missing_info_item_id" UUID,
    "action_item_id" UUID,
    "urgency_reason_id" UUID,
    "entity_id" UUID,
    "ref_kind" "fact_ref_kind" NOT NULL,
    "extraction_id" UUID,
    "evidence_id" UUID,
    "source_line_id" UUID,
    "user_statement_id" UUID,
    "ordinal" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "event_key" TEXT,
    "event_type" "timeline_event_type" NOT NULL,
    "event_at" TIMESTAMPTZ(6),
    "timestamp_precision" "timestamp_precision" NOT NULL,
    "time_source_text" TEXT,
    "sort_order" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "confidence_band" "confidence_band" NOT NULL,
    "origin" "event_origin" NOT NULL,
    "correction_status" "correction_status" NOT NULL DEFAULT 'UNMODIFIED',
    "original_event_type" "timeline_event_type",
    "original_event_at" TIMESTAMPTZ(6),
    "original_timestamp_precision" "timestamp_precision",
    "original_description" TEXT,
    "correction_statement_id" UUID,
    "dismissed_at" TIMESTAMPTZ(6),
    "agent_step_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_event_entities" (
    "timeline_event_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_event_entities_pkey" PRIMARY KEY ("timeline_event_id","entity_id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "kind" "run_kind" NOT NULL,
    "trigger" "run_trigger" NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'QUEUED',
    "plan" JSONB,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" TEXT,
    "failure_retryable" BOOLEAN,
    "failed_step_id" UUID,
    "created_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "step_name" "step_name" NOT NULL,
    "evidence_id" UUID,
    "sequence_no" INTEGER NOT NULL,
    "status" "step_status" NOT NULL DEFAULT 'PENDING',
    "input_hash" TEXT,
    "output_summary" JSONB,
    "failure_code" TEXT,
    "failure_retryable" BOOLEAN,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "latency_ms" INTEGER,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "retry_count" SMALLINT NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scam_signals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "agent_step_id" UUID NOT NULL,
    "label" "scam_label" NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "confidence_band" "confidence_band" NOT NULL,
    "explanation" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scam_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missing_information_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "finding_key" TEXT NOT NULL,
    "finding_kind" "finding_kind" NOT NULL,
    "checklist_field" "checklist_field",
    "checklist_variant" "checklist_variant" NOT NULL,
    "subject_entity_id" UUID,
    "subject_timeline_event_id" UUID,
    "reason_text" TEXT NOT NULL,
    "is_high_value" BOOLEAN NOT NULL,
    "status" "finding_status" NOT NULL DEFAULT 'OPEN',
    "resolution" "finding_resolution",
    "question_text" TEXT,
    "question_status" "question_status" NOT NULL DEFAULT 'NONE',
    "answer_statement_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missing_information_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "action_code" TEXT NOT NULL,
    "action_text" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "priority_rank" SMALLINT NOT NULL,
    "official_channel_code" TEXT,
    "status" "action_status" NOT NULL DEFAULT 'TODO',
    "status_changed_by" UUID,
    "status_changed_at" TIMESTAMPTZ(6),
    "agent_step_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urgency_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "rule_version" TEXT NOT NULL,
    "level" "urgency_level" NOT NULL,
    "signal_u1_financial_loss" BOOLEAN NOT NULL,
    "signal_u2_credential_exposure" BOOLEAN NOT NULL,
    "explanation_text" TEXT NOT NULL,
    "disclaimer_text" TEXT NOT NULL,
    "template_params" JSONB NOT NULL,
    "analysis_run_id" UUID,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urgency_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urgency_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "signal" "urgency_signal" NOT NULL,
    "ordinal" SMALLINT NOT NULL,
    "sentence_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urgency_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'GENERATING',
    "schema_version" TEXT NOT NULL,
    "content" JSONB,
    "content_sha256" CHAR(64),
    "pdf_storage_key" TEXT,
    "pdf_sha256" CHAR(64),
    "analysis_run_id" UUID,
    "requested_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6),
    "failure_code" TEXT,
    "invalidated_at" TIMESTAMPTZ(6),
    "invalidation_reason" "report_invalidation_reason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "report_content_sha256" CHAR(64) NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" "confirmation_void_reason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "review_confirmation_id" UUID NOT NULL,
    "format" "export_format" NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'GENERATING',
    "storage_key" TEXT,
    "sha256" CHAR(64),
    "byte_size" BIGINT,
    "requested_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_evidence_items" (
    "export_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_evidence_items_pkey" PRIMARY KEY ("export_id","evidence_id")
);

-- CreateTable
CREATE TABLE "integrity_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "recorded_sha256" CHAR(64) NOT NULL,
    "computed_sha256" CHAR(64),
    "result" "verification_result" NOT NULL,
    "failure_code" "verification_failure_code",
    "attestation_result" "attestation_result",
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "case_id" UUID,
    "actor_kind" "audit_actor_kind" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "outcome" "audit_outcome" NOT NULL,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "otp_challenges_email_created_at_idx" ON "otp_challenges"("email", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_challenges_requester_fingerprint_idx" ON "otp_challenges"("requester_fingerprint");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cases_case_reference_key" ON "cases"("case_reference");

-- CreateIndex
CREATE INDEX "cases_user_id_updated_at_idx" ON "cases"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cases_id_user_id_key" ON "cases"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_storage_key_key" ON "evidence_items"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_items_case_id_evidence_type_idx" ON "evidence_items"("case_id", "evidence_type");

-- CreateIndex
CREATE INDEX "evidence_items_case_id_processing_status_idx" ON "evidence_items"("case_id", "processing_status");

-- CreateIndex
CREATE INDEX "evidence_items_case_id_sha256_idx" ON "evidence_items"("case_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_id_case_id_key" ON "evidence_items"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_case_id_sequence_no_key" ON "evidence_items"("case_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "parse_results_evidence_id_key" ON "parse_results"("evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "parse_results_id_case_id_key" ON "parse_results"("id", "case_id");

-- CreateIndex
CREATE INDEX "source_lines_evidence_id_idx" ON "source_lines"("evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_lines_id_case_id_key" ON "source_lines"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_lines_parse_result_id_page_number_line_number_key" ON "source_lines"("parse_result_id", "page_number", "line_number");

-- CreateIndex
CREATE INDEX "sensitive_detections_evidence_id_idx" ON "sensitive_detections"("evidence_id");

-- CreateIndex
CREATE INDEX "sensitive_detections_source_line_id_idx" ON "sensitive_detections"("source_line_id");

-- CreateIndex
CREATE INDEX "extractions_case_id_field_type_idx" ON "extractions"("case_id", "field_type");

-- CreateIndex
CREATE INDEX "extractions_evidence_id_idx" ON "extractions"("evidence_id");

-- CreateIndex
CREATE INDEX "extractions_parse_result_id_idx" ON "extractions"("parse_result_id");

-- CreateIndex
CREATE INDEX "extractions_entity_id_idx" ON "extractions"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "extractions_id_case_id_key" ON "extractions"("id", "case_id");

-- CreateIndex
CREATE INDEX "extraction_source_lines_source_line_id_idx" ON "extraction_source_lines"("source_line_id");

-- CreateIndex
CREATE INDEX "user_statements_case_id_idx" ON "user_statements"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_statements_id_case_id_key" ON "user_statements"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_id_case_id_key" ON "entities"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_case_id_entity_type_canonical_value_key" ON "entities"("case_id", "entity_type", "canonical_value");

-- CreateIndex
CREATE INDEX "relationships_from_entity_id_idx" ON "relationships"("from_entity_id");

-- CreateIndex
CREATE INDEX "relationships_to_entity_id_idx" ON "relationships"("to_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_id_case_id_key" ON "relationships"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_case_id_from_entity_id_relation_type_to_entit_key" ON "relationships"("case_id", "from_entity_id", "relation_type", "to_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "fact_sources_link_key" ON "fact_sources"("relationship_id", "timeline_event_id", "scam_signal_id", "missing_info_item_id", "action_item_id", "urgency_reason_id", "entity_id", "ref_kind", "extraction_id", "evidence_id", "source_line_id", "user_statement_id") NULLS NOT DISTINCT; -- [03 HAND EDIT]

-- CreateIndex
CREATE INDEX "timeline_events_case_id_sort_order_idx" ON "timeline_events"("case_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_events_id_case_id_key" ON "timeline_events"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_events_case_id_event_key_key" ON "timeline_events"("case_id", "event_key");

-- CreateIndex
CREATE INDEX "timeline_event_entities_entity_id_idx" ON "timeline_event_entities"("entity_id");

-- CreateIndex
CREATE INDEX "analysis_runs_case_id_created_at_idx" ON "analysis_runs"("case_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "analysis_runs_id_case_id_key" ON "analysis_runs"("id", "case_id");

-- CreateIndex
CREATE INDEX "agent_steps_run_id_sequence_no_idx" ON "agent_steps"("run_id", "sequence_no");

-- CreateIndex
CREATE INDEX "agent_steps_evidence_id_idx" ON "agent_steps"("evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_id_case_id_key" ON "agent_steps"("id", "case_id");

-- CreateIndex
CREATE INDEX "scam_signals_agent_step_id_idx" ON "scam_signals"("agent_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "scam_signals_id_case_id_key" ON "scam_signals"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "scam_signals_case_id_label_key" ON "scam_signals"("case_id", "label");

-- CreateIndex
CREATE INDEX "missing_information_items_subject_entity_id_idx" ON "missing_information_items"("subject_entity_id");

-- CreateIndex
CREATE INDEX "missing_information_items_subject_timeline_event_id_idx" ON "missing_information_items"("subject_timeline_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "missing_information_items_id_case_id_key" ON "missing_information_items"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "missing_information_items_case_id_finding_key_key" ON "missing_information_items"("case_id", "finding_key");

-- CreateIndex
CREATE UNIQUE INDEX "action_items_id_case_id_key" ON "action_items"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_items_case_id_action_code_key" ON "action_items"("case_id", "action_code");

-- CreateIndex
CREATE INDEX "urgency_assessments_case_id_computed_at_idx" ON "urgency_assessments"("case_id", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "urgency_assessments_id_case_id_key" ON "urgency_assessments"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "urgency_reasons_id_case_id_key" ON "urgency_reasons"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "urgency_reasons_assessment_id_ordinal_key" ON "urgency_reasons"("assessment_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "reports_pdf_storage_key_key" ON "reports"("pdf_storage_key");

-- CreateIndex
CREATE INDEX "reports_case_id_status_idx" ON "reports"("case_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_id_case_id_key" ON "reports"("id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_case_id_version_number_key" ON "reports"("case_id", "version_number");

-- CreateIndex
CREATE INDEX "review_confirmations_report_id_idx" ON "review_confirmations"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_confirmations_id_report_id_key" ON "review_confirmations"("id", "report_id");

-- CreateIndex
CREATE UNIQUE INDEX "exports_storage_key_key" ON "exports"("storage_key");

-- CreateIndex
CREATE INDEX "exports_case_id_created_at_idx" ON "exports"("case_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "exports_report_id_idx" ON "exports"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "exports_id_case_id_key" ON "exports"("id", "case_id");

-- CreateIndex
CREATE INDEX "export_evidence_items_evidence_id_idx" ON "export_evidence_items"("evidence_id");

-- CreateIndex
CREATE INDEX "integrity_verifications_evidence_id_verified_at_idx" ON "integrity_verifications"("evidence_id", "verified_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_case_id_occurred_at_idx" ON "audit_logs"("case_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_results" ADD CONSTRAINT "parse_results_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_results" ADD CONSTRAINT "parse_results_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_pages" ADD CONSTRAINT "source_pages_parse_result_id_case_id_fkey" FOREIGN KEY ("parse_result_id", "case_id") REFERENCES "parse_results"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_lines" ADD CONSTRAINT "source_lines_parse_result_id_case_id_fkey" FOREIGN KEY ("parse_result_id", "case_id") REFERENCES "parse_results"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_lines" ADD CONSTRAINT "source_lines_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_lines" ADD CONSTRAINT "source_lines_parse_result_id_page_number_fkey" FOREIGN KEY ("parse_result_id", "page_number") REFERENCES "source_pages"("parse_result_id", "page_number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitive_detections" ADD CONSTRAINT "sensitive_detections_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensitive_detections" ADD CONSTRAINT "sensitive_detections_source_line_id_case_id_fkey" FOREIGN KEY ("source_line_id", "case_id") REFERENCES "source_lines"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_parse_result_id_case_id_fkey" FOREIGN KEY ("parse_result_id", "case_id") REFERENCES "parse_results"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_entity_id_case_id_fkey" FOREIGN KEY ("entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE SET NULL ("entity_id") ON UPDATE CASCADE; -- [03 HAND EDIT]

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_correction_statement_id_case_id_fkey" FOREIGN KEY ("correction_statement_id", "case_id") REFERENCES "user_statements"("id", "case_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_source_lines" ADD CONSTRAINT "extraction_source_lines_extraction_id_case_id_fkey" FOREIGN KEY ("extraction_id", "case_id") REFERENCES "extractions"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_source_lines" ADD CONSTRAINT "extraction_source_lines_source_line_id_case_id_fkey" FOREIGN KEY ("source_line_id", "case_id") REFERENCES "source_lines"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_statements" ADD CONSTRAINT "user_statements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_statements" ADD CONSTRAINT "user_statements_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_statements" ADD CONSTRAINT "user_statements_supersedes_statement_id_case_id_fkey" FOREIGN KEY ("supersedes_statement_id", "case_id") REFERENCES "user_statements"("id", "case_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_entity_id_case_id_fkey" FOREIGN KEY ("from_entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_entity_id_case_id_fkey" FOREIGN KEY ("to_entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_relationship_id_case_id_fkey" FOREIGN KEY ("relationship_id", "case_id") REFERENCES "relationships"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_timeline_event_id_case_id_fkey" FOREIGN KEY ("timeline_event_id", "case_id") REFERENCES "timeline_events"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_scam_signal_id_case_id_fkey" FOREIGN KEY ("scam_signal_id", "case_id") REFERENCES "scam_signals"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_missing_info_item_id_case_id_fkey" FOREIGN KEY ("missing_info_item_id", "case_id") REFERENCES "missing_information_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_action_item_id_case_id_fkey" FOREIGN KEY ("action_item_id", "case_id") REFERENCES "action_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_urgency_reason_id_case_id_fkey" FOREIGN KEY ("urgency_reason_id", "case_id") REFERENCES "urgency_reasons"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_entity_id_case_id_fkey" FOREIGN KEY ("entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_extraction_id_case_id_fkey" FOREIGN KEY ("extraction_id", "case_id") REFERENCES "extractions"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_source_line_id_case_id_fkey" FOREIGN KEY ("source_line_id", "case_id") REFERENCES "source_lines"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_sources" ADD CONSTRAINT "fact_sources_user_statement_id_case_id_fkey" FOREIGN KEY ("user_statement_id", "case_id") REFERENCES "user_statements"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_correction_statement_id_case_id_fkey" FOREIGN KEY ("correction_statement_id", "case_id") REFERENCES "user_statements"("id", "case_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_event_entities" ADD CONSTRAINT "timeline_event_entities_timeline_event_id_case_id_fkey" FOREIGN KEY ("timeline_event_id", "case_id") REFERENCES "timeline_events"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_event_entities" ADD CONSTRAINT "timeline_event_entities_entity_id_case_id_fkey" FOREIGN KEY ("entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_failed_step_id_fkey" FOREIGN KEY ("failed_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_case_id_fkey" FOREIGN KEY ("run_id", "case_id") REFERENCES "analysis_runs"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE SET NULL ("evidence_id") ON UPDATE CASCADE; -- [03 HAND EDIT]

-- AddForeignKey
ALTER TABLE "scam_signals" ADD CONSTRAINT "scam_signals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scam_signals" ADD CONSTRAINT "scam_signals_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_information_items" ADD CONSTRAINT "missing_information_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_information_items" ADD CONSTRAINT "missing_information_items_subject_entity_id_case_id_fkey" FOREIGN KEY ("subject_entity_id", "case_id") REFERENCES "entities"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_information_items" ADD CONSTRAINT "missing_information_items_subject_timeline_event_id_case_i_fkey" FOREIGN KEY ("subject_timeline_event_id", "case_id") REFERENCES "timeline_events"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_information_items" ADD CONSTRAINT "missing_information_items_answer_statement_id_case_id_fkey" FOREIGN KEY ("answer_statement_id", "case_id") REFERENCES "user_statements"("id", "case_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgency_assessments" ADD CONSTRAINT "urgency_assessments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgency_assessments" ADD CONSTRAINT "urgency_assessments_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgency_reasons" ADD CONSTRAINT "urgency_reasons_assessment_id_case_id_fkey" FOREIGN KEY ("assessment_id", "case_id") REFERENCES "urgency_assessments"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_confirmations" ADD CONSTRAINT "review_confirmations_report_id_case_id_fkey" FOREIGN KEY ("report_id", "case_id") REFERENCES "reports"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_confirmations" ADD CONSTRAINT "review_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_report_id_case_id_fkey" FOREIGN KEY ("report_id", "case_id") REFERENCES "reports"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_review_confirmation_id_report_id_fkey" FOREIGN KEY ("review_confirmation_id", "report_id") REFERENCES "review_confirmations"("id", "report_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_evidence_items" ADD CONSTRAINT "export_evidence_items_export_id_case_id_fkey" FOREIGN KEY ("export_id", "case_id") REFERENCES "exports"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_evidence_items" ADD CONSTRAINT "export_evidence_items_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrity_verifications" ADD CONSTRAINT "integrity_verifications_evidence_id_case_id_fkey" FOREIGN KEY ("evidence_id", "case_id") REFERENCES "evidence_items"("id", "case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrity_verifications" ADD CONSTRAINT "integrity_verifications_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-authored section. Everything below implements docs/03-DATABASE-SCHEMA.md constructs that
-- Prisma cannot express (03 §28.3). Prisma's drift detection ignores CHECKs, partial indexes,
-- triggers, functions, views and grants, so `prisma migrate diff` stays empty.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints (03 §4–§19, §22)
-- ---------------------------------------------------------------------------------------------

-- users (03 §4.2)
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK (email = lower(email)),
  ADD CONSTRAINT "users_email_length_check" CHECK (char_length(email) <= 254),
  ADD CONSTRAINT "users_name_length_check" CHECK (name IS NULL OR char_length(name) <= 100);

-- otp_challenges (03 §4.3)
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_email_lowercase_check" CHECK (email = lower(email)),
  ADD CONSTRAINT "otp_challenges_expiry_check" CHECK (expires_at > created_at),
  ADD CONSTRAINT "otp_challenges_attempts_check" CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
  ADD CONSTRAINT "otp_challenges_max_attempts_check" CHECK (max_attempts > 0);

-- sessions (03 §4.4)
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_check" CHECK (expires_at > created_at);

-- cases (03 §5.1)
ALTER TABLE "cases"
  ADD CONSTRAINT "cases_case_reference_format_check" CHECK (case_reference ~ '^CF-[0-9]{5,}$'),
  -- Precision is set with a provided time (EXACT/APPROXIMATE), or is UNKNOWN / null without one.
  ADD CONSTRAINT "cases_incident_time_precision_check" CHECK (
    (incident_time IS NOT NULL AND incident_time_precision IN ('EXACT', 'APPROXIMATE'))
    OR (incident_time IS NULL AND (incident_time_precision IS NULL OR incident_time_precision = 'UNKNOWN'))
  ),
  ADD CONSTRAINT "cases_contact_text_length_check" CHECK (contact_text IS NULL OR char_length(contact_text) <= 200),
  ADD CONSTRAINT "cases_location_text_length_check" CHECK (location_text IS NULL OR char_length(location_text) <= 200),
  ADD CONSTRAINT "cases_summary_length_check" CHECK (summary IS NULL OR char_length(summary) <= 2000),
  ADD CONSTRAINT "cases_checklist_variant_check" CHECK (
    checklist_variant IS NULL OR financial_loss_reported IS NULL
    OR ((checklist_variant = 'FINANCIAL') = financial_loss_reported)
  );

-- evidence_items (03 §6.1; G-4 limits are DB-enforced backstops, 03 §6.2)
ALTER TABLE "evidence_items"
  ADD CONSTRAINT "evidence_items_sequence_no_check" CHECK (sequence_no BETWEEN 1 AND 20),
  ADD CONSTRAINT "evidence_items_paste_kind_check" CHECK (
    ((evidence_type IN ('TEXT', 'URL')) = (paste_kind IS NOT NULL))
    AND (evidence_type <> 'URL' OR paste_kind = 'URL')
  ),
  ADD CONSTRAINT "evidence_items_label_length_check" CHECK (label IS NULL OR char_length(label) <= 100),
  ADD CONSTRAINT "evidence_items_original_filename_check" CHECK (
    ((evidence_type IN ('TEXT', 'URL')) = (original_filename IS NULL))
    AND (original_filename IS NULL OR char_length(original_filename) <= 255)
  ),
  ADD CONSTRAINT "evidence_items_detected_content_type_check" CHECK (
    processing_status = 'UPLOADING'
    OR detected_content_type IN ('image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'message/rfc822')
  ),
  ADD CONSTRAINT "evidence_items_byte_size_check" CHECK (
    (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760)
    AND (processing_status = 'UPLOADING' OR byte_size IS NOT NULL)
  ),
  ADD CONSTRAINT "evidence_items_text_char_count_check" CHECK (
    (text_char_count IS NULL OR text_char_count BETWEEN 1 AND 20000)
    AND ((evidence_type IN ('TEXT', 'URL')) = (text_char_count IS NOT NULL))
  ),
  ADD CONSTRAINT "evidence_items_page_count_check" CHECK (
    (page_count IS NULL OR page_count BETWEEN 1 AND 20)
    AND ((evidence_type = 'PDF' AND processing_status <> 'UPLOADING') = (page_count IS NOT NULL))
  ),
  ADD CONSTRAINT "evidence_items_image_dimensions_check" CHECK (
    (image_width IS NULL OR image_width > 0)
    AND (image_height IS NULL OR image_height > 0)
    AND (image_width IS NULL OR image_height IS NULL OR image_width::bigint * image_height <= 40000000)
    AND ((evidence_type IN ('PNG', 'JPEG') AND processing_status <> 'UPLOADING') = (image_width IS NOT NULL))
    AND ((evidence_type IN ('PNG', 'JPEG') AND processing_status <> 'UPLOADING') = (image_height IS NOT NULL))
  ),
  ADD CONSTRAINT "evidence_items_sha256_check" CHECK (
    (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
    AND ((processing_status <> 'UPLOADING') = (sha256 IS NOT NULL))
  ),
  ADD CONSTRAINT "evidence_items_uploaded_at_check" CHECK ((uploaded_at IS NULL) = (sha256 IS NULL)),
  ADD CONSTRAINT "evidence_items_failure_check" CHECK (
    ((processing_status = 'FAILED') = (failure_code IS NOT NULL))
    AND ((processing_status = 'FAILED') = (failure_retryable IS NOT NULL))
  ),
  -- OD-03: a PDF without a text layer is never retryable (INV-E7).
  ADD CONSTRAINT "evidence_items_pdf_no_text_layer_check" CHECK (
    failure_code IS DISTINCT FROM 'PDF_NO_TEXT_LAYER' OR failure_retryable = false
  );

-- parse_results (03 §7.1)
ALTER TABLE "parse_results"
  ADD CONSTRAINT "parse_results_page_count_check" CHECK (page_count BETWEEN 1 AND 20),
  ADD CONSTRAINT "parse_results_failure_check" CHECK ((status = 'FAILED') = (failure_code IS NOT NULL));

-- source_pages (03 §7.2)
ALTER TABLE "source_pages"
  ADD CONSTRAINT "source_pages_page_number_check" CHECK (page_number BETWEEN 1 AND 20),
  ADD CONSTRAINT "source_pages_char_count_check" CHECK (non_whitespace_char_count IS NULL OR non_whitespace_char_count >= 0);

-- source_lines (03 §7.4, §8)
ALTER TABLE "source_lines"
  ADD CONSTRAINT "source_lines_line_number_check" CHECK (line_number >= 1),
  ADD CONSTRAINT "source_lines_header_name_check" CHECK (
    ((location_kind = 'EMAIL_HEADER') = (header_name IS NOT NULL))
    AND (header_name IS NULL OR header_name IN ('From', 'To', 'Cc', 'Reply-To', 'Return-Path', 'Subject', 'Date', 'Message-ID'))
  ),
  ADD CONSTRAINT "source_lines_ocr_confidence_check" CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0 AND 1);

-- sensitive_detections (03 §9.6)
ALTER TABLE "sensitive_detections"
  ADD CONSTRAINT "sensitive_detections_span_check" CHECK (char_start >= 0 AND char_start < char_end);

-- extractions (03 §9.2)
ALTER TABLE "extractions"
  ADD CONSTRAINT "extractions_method_not_user_check" CHECK (method <> 'USER'),
  ADD CONSTRAINT "extractions_identifier_basis_check" CHECK (
    field_type NOT IN ('PHONE', 'URL', 'DOMAIN', 'UPI_ID', 'TRANSACTION', 'AMOUNT', 'EMAIL',
                       'ACCOUNT_HINT', 'SMS_SENDER_HEADER', 'MESSAGING_HANDLE')
    OR confidence_basis = 'SOURCE_VALIDATION'
  ),
  ADD CONSTRAINT "extractions_confidence_check" CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT "extractions_normalized_value_check" CHECK (
    normalization_status <> 'NORMALIZED' OR normalized_value IS NOT NULL
  ),
  ADD CONSTRAINT "extractions_not_normalized_entity_check" CHECK (
    normalization_status <> 'NOT_NORMALIZED' OR entity_id IS NULL
  ),
  ADD CONSTRAINT "extractions_amount_check" CHECK (
    (value_amount_minor IS NULL OR value_amount_minor >= 0)
    AND ((field_type = 'AMOUNT' AND normalization_status = 'NORMALIZED') = (value_amount_minor IS NOT NULL))
    AND ((value_currency IS NULL) = (value_amount_minor IS NULL))
  ),
  ADD CONSTRAINT "extractions_datetime_precision_check" CHECK ((value_datetime_precision IS NULL) = (value_datetime IS NULL)),
  ADD CONSTRAINT "extractions_source_label_length_check" CHECK (source_label IS NULL OR char_length(source_label) <= 50),
  ADD CONSTRAINT "extractions_snippet_length_check" CHECK (char_length(snippet) <= 200),
  ADD CONSTRAINT "extractions_correction_check" CHECK (
    ((correction_status = 'USER_CORRECTED') = (corrected_value IS NOT NULL))
    AND ((correction_status = 'USER_CORRECTED') = (correction_statement_id IS NOT NULL))
  );

-- extraction_source_lines (03 §9.3)
ALTER TABLE "extraction_source_lines"
  ADD CONSTRAINT "extraction_source_lines_ordinal_check" CHECK (ordinal >= 1);

-- user_statements (03 §9.5)
ALTER TABLE "user_statements"
  ADD CONSTRAINT "user_statements_value_text_length_check" CHECK (char_length(value_text) <= 2000),
  ADD CONSTRAINT "user_statements_amount_check" CHECK (value_amount_minor IS NULL OR value_amount_minor >= 0);

-- entities (03 §10.1)
ALTER TABLE "entities"
  ADD CONSTRAINT "entities_amount_only_check" CHECK (
    entity_type = 'AMOUNT' OR (amount_minor IS NULL AND currency IS NULL)
  );

-- relationships (03 §11.3)
ALTER TABLE "relationships"
  ADD CONSTRAINT "relationships_distinct_entities_check" CHECK (from_entity_id <> to_entity_id);

-- fact_sources (03 §11.2): exactly one owner; target columns paired with ref_kind.
ALTER TABLE "fact_sources"
  ADD CONSTRAINT "fact_sources_owner_arc_check" CHECK (
    num_nonnulls(relationship_id, timeline_event_id, scam_signal_id, missing_info_item_id,
                 action_item_id, urgency_reason_id, entity_id) = 1
  ),
  ADD CONSTRAINT "fact_sources_entity_owner_check" CHECK (entity_id IS NULL OR ref_kind = 'USER_STATEMENT'),
  ADD CONSTRAINT "fact_sources_extraction_target_check" CHECK ((ref_kind = 'EXTRACTION') = (extraction_id IS NOT NULL)),
  ADD CONSTRAINT "fact_sources_evidence_target_check" CHECK ((ref_kind = 'EVIDENCE') = (evidence_id IS NOT NULL)),
  ADD CONSTRAINT "fact_sources_source_line_target_check" CHECK (source_line_id IS NULL OR ref_kind = 'EVIDENCE'),
  ADD CONSTRAINT "fact_sources_user_statement_target_check" CHECK ((ref_kind = 'USER_STATEMENT') = (user_statement_id IS NOT NULL)),
  ADD CONSTRAINT "fact_sources_ordinal_check" CHECK (ordinal >= 1);

-- timeline_events (03 §12.1)
ALTER TABLE "timeline_events"
  ADD CONSTRAINT "timeline_events_event_key_check" CHECK ((origin = 'AI_GENERATED') = (event_key IS NOT NULL)),
  -- No invented exact times (GR-07): only order-only events lack a time.
  ADD CONSTRAINT "timeline_events_event_at_check" CHECK ((timestamp_precision = 'INFERRED_ORDER_ONLY') = (event_at IS NULL)),
  ADD CONSTRAINT "timeline_events_time_source_text_length_check" CHECK (time_source_text IS NULL OR char_length(time_source_text) <= 100),
  ADD CONSTRAINT "timeline_events_description_length_check" CHECK (char_length(description) <= 300),
  ADD CONSTRAINT "timeline_events_confidence_check" CHECK (confidence BETWEEN 0 AND 1),
  -- original_* are filled on the first correction (FR-013). original_event_at stays null when the
  -- original event was order-only.
  ADD CONSTRAINT "timeline_events_correction_check" CHECK (
    ((correction_status = 'USER_CORRECTED') = (original_event_type IS NOT NULL))
    AND ((correction_status = 'USER_CORRECTED') = (original_timestamp_precision IS NOT NULL))
    AND ((correction_status = 'USER_CORRECTED') = (original_description IS NOT NULL))
    AND ((correction_status = 'USER_CORRECTED') = (correction_statement_id IS NOT NULL))
    AND (original_event_at IS NULL OR correction_status = 'USER_CORRECTED')
    AND (original_description IS NULL OR char_length(original_description) <= 300)
  );

-- scam_signals (03 §15.2)
ALTER TABLE "scam_signals"
  ADD CONSTRAINT "scam_signals_confidence_check" CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT "scam_signals_explanation_length_check" CHECK (char_length(explanation) <= 600);

-- missing_information_items (03 §13.1)
ALTER TABLE "missing_information_items"
  ADD CONSTRAINT "missing_information_items_checklist_field_check" CHECK (
    finding_kind <> 'MISSING_FIELD' OR checklist_field IS NOT NULL
  ),
  ADD CONSTRAINT "missing_information_items_high_value_check" CHECK (question_status = 'NONE' OR is_high_value),
  -- OD-09: the identity document is a "keep ready" item only (INV-M1).
  ADD CONSTRAINT "missing_information_items_identity_document_check" CHECK (
    checklist_field IS DISTINCT FROM 'IDENTITY_DOCUMENT'
    OR (status = 'INFORMATIONAL' AND question_status = 'NONE')
  ),
  ADD CONSTRAINT "missing_information_items_resolution_check" CHECK ((status = 'RESOLVED') = (resolution IS NOT NULL)),
  ADD CONSTRAINT "missing_information_items_question_text_check" CHECK ((question_status <> 'NONE') = (question_text IS NOT NULL)),
  ADD CONSTRAINT "missing_information_items_answer_check" CHECK ((question_status = 'ANSWERED') = (answer_statement_id IS NOT NULL));

-- action_items (03 §16.1)
ALTER TABLE "action_items"
  ADD CONSTRAINT "action_items_priority_rank_check" CHECK (priority_rank >= 1);

-- urgency_assessments (03 §14.1): the database enforces rule G2-v1 (INV-U1).
ALTER TABLE "urgency_assessments"
  ADD CONSTRAINT "urgency_assessments_g2_v1_check" CHECK (
    rule_version <> 'G2-v1'
    OR (level = 'HIGH' AND signal_u1_financial_loss)
    OR (level = 'MEDIUM' AND NOT signal_u1_financial_loss AND signal_u2_credential_exposure)
    OR (level = 'LOW' AND NOT signal_u1_financial_loss AND NOT signal_u2_credential_exposure)
  );

-- reports (03 §17.1)
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_version_number_check" CHECK (version_number >= 1),
  ADD CONSTRAINT "reports_generated_content_check" CHECK (
    ((status = 'GENERATED') = (content IS NOT NULL))
    AND ((status = 'GENERATED') = (content_sha256 IS NOT NULL))
    AND ((status = 'GENERATED') = (pdf_storage_key IS NOT NULL))
    AND ((status = 'GENERATED') = (pdf_sha256 IS NOT NULL))
  ),
  ADD CONSTRAINT "reports_sha256_check" CHECK (
    (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')
    AND (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
  ),
  -- generated_at: set when GENERATED; kept on INVALIDATED-after-GENERATED; never otherwise.
  ADD CONSTRAINT "reports_generated_at_check" CHECK (
    (status <> 'GENERATED' OR generated_at IS NOT NULL)
    AND (status NOT IN ('GENERATING', 'FAILED') OR generated_at IS NULL)
  ),
  ADD CONSTRAINT "reports_failure_check" CHECK ((status = 'FAILED') = (failure_code IS NOT NULL)),
  ADD CONSTRAINT "reports_invalidation_check" CHECK (
    ((status = 'INVALIDATED') = (invalidated_at IS NOT NULL))
    AND ((status = 'INVALIDATED') = (invalidation_reason IS NOT NULL))
    AND (status <> 'INVALIDATED' OR (content IS NULL AND pdf_storage_key IS NULL))
  );

-- review_confirmations (03 §17.3)
ALTER TABLE "review_confirmations"
  ADD CONSTRAINT "review_confirmations_sha256_check" CHECK (report_content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "review_confirmations_void_check" CHECK ((voided_at IS NULL) = (void_reason IS NULL));

-- exports (03 §17.4)
ALTER TABLE "exports"
  ADD CONSTRAINT "exports_ready_check" CHECK (
    ((status = 'READY') = (storage_key IS NOT NULL))
    AND ((status = 'READY') = (sha256 IS NOT NULL))
  ),
  ADD CONSTRAINT "exports_sha256_check" CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

-- integrity_verifications (03 §18.1): an unreadable object is never a false MISMATCH (INV-V1).
ALTER TABLE "integrity_verifications"
  ADD CONSTRAINT "integrity_verifications_sha256_check" CHECK (
    recorded_sha256 ~ '^[0-9a-f]{64}$'
    AND (computed_sha256 IS NULL OR computed_sha256 ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT "integrity_verifications_result_check" CHECK (
    (result = 'MATCH' AND computed_sha256 IS NOT NULL AND computed_sha256 = recorded_sha256)
    OR (result = 'MISMATCH' AND computed_sha256 IS NOT NULL AND computed_sha256 <> recorded_sha256)
    OR (result = 'COULD_NOT_COMPLETE' AND computed_sha256 IS NULL)
  ),
  ADD CONSTRAINT "integrity_verifications_failure_check" CHECK ((result = 'COULD_NOT_COMPLETE') = (failure_code IS NOT NULL));

-- audit_logs (03 §19.1, §19.3)
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_check" CHECK ((actor_kind = 'USER') = (actor_user_id IS NOT NULL)),
  ADD CONSTRAINT "audit_logs_action_check" CHECK (action IN (
    'AUTH_CODE_REQUESTED', 'AUTH_SIGNED_IN', 'AUTH_SIGN_IN_FAILED', 'AUTH_SIGNED_OUT',
    'CASE_CREATED', 'CASE_UPDATED', 'CASE_STATUS_CHANGED', 'CASE_DELETED',
    'EVIDENCE_UPLOADED', 'EVIDENCE_REJECTED', 'EVIDENCE_VIEWED', 'EVIDENCE_PROCESSING_FAILED', 'EVIDENCE_DELETED',
    'ANALYSIS_STARTED', 'ANALYSIS_STEP_FAILED', 'ANALYSIS_COMPLETED', 'ANALYSIS_FAILED', 'FALLBACK_USED',
    'EXTRACTION_CORRECTED', 'TIMELINE_EVENT_CORRECTED', 'TIMELINE_EVENT_ADDED', 'TIMELINE_EVENT_DISMISSED',
    'QUESTION_ANSWERED', 'QUESTION_SKIPPED', 'ACTION_STATUS_CHANGED',
    'REPORT_GENERATED', 'REPORT_GENERATION_FAILED', 'REPORT_CONFIRMED', 'REPORT_CONFIRMATION_VOIDED',
    'REPORT_INVALIDATED', 'EXPORT_CREATED', 'EXPORT_DOWNLOADED',
    'INTEGRITY_VERIFIED'
  ));

-- ---------------------------------------------------------------------------------------------
-- Partial indexes (03 §11.2, §21)
-- ---------------------------------------------------------------------------------------------

-- Cleanup of abandoned uploads.
CREATE INDEX "evidence_items_uploading_created_at_idx"
  ON "evidence_items"("processing_status", "created_at") WHERE processing_status = 'UPLOADING';

-- One active analysis run per case (FR-006 AC-006.4, INV-Q1).
CREATE UNIQUE INDEX "analysis_runs_one_active_per_case_key"
  ON "analysis_runs"("case_id") WHERE status IN ('QUEUED', 'RUNNING');

-- Step idempotency: skip already-processed evidence (FR-006 AC-006.3).
CREATE INDEX "agent_steps_idempotency_idx"
  ON "agent_steps"("case_id", "step_name", "evidence_id", "input_hash") WHERE status = 'SUCCEEDED';

-- Exactly one primary scam signal per case (INV-S1, "at most one" side).
CREATE UNIQUE INDEX "scam_signals_one_primary_per_case_key"
  ON "scam_signals"("case_id") WHERE is_primary;

-- At most one current urgency assessment per case (INV-U3).
CREATE UNIQUE INDEX "urgency_assessments_one_current_per_case_key"
  ON "urgency_assessments"("case_id") WHERE is_current;

-- At most one active confirmation per report version (R-1).
CREATE UNIQUE INDEX "review_confirmations_one_active_per_report_key"
  ON "review_confirmations"("report_id") WHERE voided_at IS NULL;

-- fact_sources: one partial index per nullable FK column (cascades, "only source" checks).
CREATE INDEX "fact_sources_relationship_id_idx" ON "fact_sources"("relationship_id") WHERE relationship_id IS NOT NULL;
CREATE INDEX "fact_sources_timeline_event_id_idx" ON "fact_sources"("timeline_event_id") WHERE timeline_event_id IS NOT NULL;
CREATE INDEX "fact_sources_scam_signal_id_idx" ON "fact_sources"("scam_signal_id") WHERE scam_signal_id IS NOT NULL;
CREATE INDEX "fact_sources_missing_info_item_id_idx" ON "fact_sources"("missing_info_item_id") WHERE missing_info_item_id IS NOT NULL;
CREATE INDEX "fact_sources_action_item_id_idx" ON "fact_sources"("action_item_id") WHERE action_item_id IS NOT NULL;
CREATE INDEX "fact_sources_urgency_reason_id_idx" ON "fact_sources"("urgency_reason_id") WHERE urgency_reason_id IS NOT NULL;
CREATE INDEX "fact_sources_entity_id_idx" ON "fact_sources"("entity_id") WHERE entity_id IS NOT NULL;
CREATE INDEX "fact_sources_extraction_id_idx" ON "fact_sources"("extraction_id") WHERE extraction_id IS NOT NULL;
CREATE INDEX "fact_sources_evidence_id_idx" ON "fact_sources"("evidence_id") WHERE evidence_id IS NOT NULL;
CREATE INDEX "fact_sources_source_line_id_idx" ON "fact_sources"("source_line_id") WHERE source_line_id IS NOT NULL;
CREATE INDEX "fact_sources_user_statement_id_idx" ON "fact_sources"("user_statement_id") WHERE user_statement_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Immutability and append-only triggers (03 §19.4, §22 INV-E5, INV-X5, INV-A3; §28.3)
-- ---------------------------------------------------------------------------------------------

-- INV-E5: the fingerprint and ingestion time are set once and never change.
CREATE FUNCTION "evidence_items_fingerprint_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    RAISE EXCEPTION 'evidence_items.sha256 is immutable once set' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.uploaded_at IS NOT NULL AND NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'evidence_items.uploaded_at is immutable once set' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "evidence_items_fingerprint_immutable"
  BEFORE UPDATE ON "evidence_items"
  FOR EACH ROW EXECUTE FUNCTION "evidence_items_fingerprint_immutable"();

-- INV-X5: the original AI values are copied on the first correction and never change after.
CREATE FUNCTION "timeline_events_originals_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.correction_status = 'USER_CORRECTED' AND (
       NEW.correction_status IS DISTINCT FROM OLD.correction_status
    OR NEW.original_event_type IS DISTINCT FROM OLD.original_event_type
    OR NEW.original_event_at IS DISTINCT FROM OLD.original_event_at
    OR NEW.original_timestamp_precision IS DISTINCT FROM OLD.original_timestamp_precision
    OR NEW.original_description IS DISTINCT FROM OLD.original_description
  ) THEN
    RAISE EXCEPTION 'timeline_events original_* values are immutable after the first correction'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "timeline_events_originals_immutable"
  BEFORE UPDATE ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION "timeline_events_originals_immutable"();

-- INV-A3: audit rows are never updated or deleted (defence in depth behind the grants below).
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_append_only_row"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "audit_logs_append_only_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_append_only"();

-- ---------------------------------------------------------------------------------------------
-- Derived views (03 §5.3, §11.1). Computed on read; never stored.
-- ---------------------------------------------------------------------------------------------

-- Evidence → entity links ("appears_in"), derived from extractions.
CREATE VIEW "entity_evidence_links" AS
SELECT DISTINCT case_id, entity_id, evidence_id
FROM "extractions"
WHERE entity_id IS NOT NULL;

-- Per-case overview read model.
--   evidence_*                  counts by processing_status ("N/N processed")
--   latest_run_*                most recent analysis/report run and its failed step
--   latest_report_*             highest report version, whatever its status
--   current_report_*            highest GENERATED version (03 §17.2)
--   has_active_confirmation     un-voided confirmation on the current version ("Reviewed – version N")
--   urgency_level               current assessment; null = "Not assessed yet" (03 §14.3)
--   urgency_out_of_date         current assessment exists and the case is before ACTIONS_READY (03 §14.4)
--   entity_counts               {entity_type: count}, e.g. PHONE / URL / UPI_ID / TRANSACTION
CREATE VIEW "case_overview" AS
SELECT
  c.id AS case_id,
  c.user_id,
  c.case_reference,
  c.status,
  COALESCE(ev.total, 0) AS evidence_total,
  COALESCE(ev.uploading, 0) AS evidence_uploading,
  COALESCE(ev.uploaded, 0) AS evidence_uploaded,
  COALESCE(ev.processing, 0) AS evidence_processing,
  COALESCE(ev.processed, 0) AS evidence_processed,
  COALESCE(ev.failed, 0) AS evidence_failed,
  lr.id AS latest_run_id,
  lr.kind AS latest_run_kind,
  lr.status AS latest_run_status,
  lr.failure_code AS latest_run_failure_code,
  lr.failed_step_name AS latest_run_failed_step,
  lrep.version_number AS latest_report_version,
  lrep.status AS latest_report_status,
  crep.id AS current_report_id,
  crep.version_number AS current_report_version,
  (crep.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "review_confirmations" rc
    WHERE rc.report_id = crep.id AND rc.voided_at IS NULL
  )) AS has_active_confirmation,
  ua.level AS urgency_level,
  (ua.id IS NOT NULL AND c.status < 'ACTIONS_READY'::case_status) AS urgency_out_of_date,
  COALESCE(ent.counts, '{}'::jsonb) AS entity_counts
FROM "cases" c
LEFT JOIN LATERAL (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE e.processing_status = 'UPLOADING')::int AS uploading,
    count(*) FILTER (WHERE e.processing_status = 'UPLOADED')::int AS uploaded,
    count(*) FILTER (WHERE e.processing_status = 'PROCESSING')::int AS processing,
    count(*) FILTER (WHERE e.processing_status = 'PROCESSED')::int AS processed,
    count(*) FILTER (WHERE e.processing_status = 'FAILED')::int AS failed
  FROM "evidence_items" e
  WHERE e.case_id = c.id
) ev ON true
LEFT JOIN LATERAL (
  SELECT r.id, r.kind, r.status, r.failure_code, s.step_name AS failed_step_name
  FROM "analysis_runs" r
  LEFT JOIN "agent_steps" s ON s.id = r.failed_step_id
  WHERE r.case_id = c.id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
) lr ON true
LEFT JOIN LATERAL (
  SELECT rp.version_number, rp.status
  FROM "reports" rp
  WHERE rp.case_id = c.id
  ORDER BY rp.version_number DESC
  LIMIT 1
) lrep ON true
LEFT JOIN LATERAL (
  SELECT rp.id, rp.version_number
  FROM "reports" rp
  WHERE rp.case_id = c.id AND rp.status = 'GENERATED'
  ORDER BY rp.version_number DESC
  LIMIT 1
) crep ON true
LEFT JOIN "urgency_assessments" ua ON ua.case_id = c.id AND ua.is_current
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(t.entity_type, t.n) AS counts
  FROM (
    SELECT en.entity_type, count(*)::int AS n
    FROM "entities" en
    WHERE en.case_id = c.id
    GROUP BY en.entity_type
  ) t
) ent ON true;

-- ---------------------------------------------------------------------------------------------
-- Least-privilege application role (03 §20, §19.4)
--   Migration role (this migration's owner): DDL.
--   proofline_app (NOLOGIN group role): DML on domain tables; INSERT/SELECT only on audit_logs;
--   no DDL. The runtime login user is a member of proofline_app. Creating the role needs
--   CREATEROLE; where the migration user lacks it, create the role beforehand (see
--   docker/postgres/init/01-app-role.sql) and this block is skipped.
-- ---------------------------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proofline_app') THEN
    CREATE ROLE proofline_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO proofline_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "users", "otp_challenges", "sessions", "cases",
  "evidence_items", "parse_results", "source_pages", "source_lines", "sensitive_detections",
  "extractions", "extraction_source_lines", "user_statements",
  "entities", "relationships", "fact_sources",
  "timeline_events", "timeline_event_entities",
  "analysis_runs", "agent_steps", "scam_signals",
  "missing_information_items", "action_items",
  "urgency_assessments", "urgency_reasons",
  "reports", "review_confirmations", "exports", "export_evidence_items",
  "integrity_verifications"
TO proofline_app;

GRANT SELECT, INSERT ON "audit_logs" TO proofline_app;

GRANT SELECT ON "entity_evidence_links", "case_overview" TO proofline_app;

-- Needed so the case_reference default can call nextval() as the application role.
GRANT USAGE ON SEQUENCE case_reference_seq TO proofline_app;
