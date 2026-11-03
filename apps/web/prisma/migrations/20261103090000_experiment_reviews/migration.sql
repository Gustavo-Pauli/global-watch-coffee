-- Additive server-only storage for explicitly authorized research reviewers.
BEGIN;

CREATE TABLE "experiment_reviews" (
  "id" UUID NOT NULL,
  "study_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "sample_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "label" INTEGER,
  "certainty" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "reference_kind" TEXT NOT NULL,
  "blind_review" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiment_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "experiment_reviews_reviewer_fk" FOREIGN KEY ("reviewer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "experiment_reviews_study_check" CHECK ("study_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'),
  CONSTRAINT "experiment_reviews_sample_check" CHECK ("sample_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$'),
  CONSTRAINT "experiment_reviews_fingerprint_check" CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "experiment_reviews_decision_check" CHECK (
    ("decision" = 'class' AND "label" IS NOT NULL AND "label" BETWEEN 1 AND 5)
    OR ("decision" = 'indeterminate' AND "label" IS NULL)
  ),
  CONSTRAINT "experiment_reviews_certainty_check" CHECK ("certainty" IN ('high', 'low')),
  CONSTRAINT "experiment_reviews_reference_kind_check" CHECK ("reference_kind" IN ('human_visual_interpretation', 'expert_visual_interpretation', 'ai_visual_interpretation')),
  CONSTRAINT "experiment_reviews_notes_check" CHECK (char_length("notes") <= 2000),
  CONSTRAINT "experiment_reviews_revision_check" CHECK ("revision" >= 1)
);

CREATE UNIQUE INDEX "experiment_reviews_unique_reviewer" ON "experiment_reviews"("study_id", "fingerprint", "sample_id", "reviewer_id");
CREATE INDEX "experiment_reviews_owner" ON "experiment_reviews"("study_id", "fingerprint", "reviewer_id");
ALTER TABLE "experiment_reviews" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "experiment_reviews" FROM PUBLIC;
DO $hardening$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.experiment_reviews FROM %I', client_role);
    END IF;
  END LOOP;
END;
$hardening$;

COMMIT;
