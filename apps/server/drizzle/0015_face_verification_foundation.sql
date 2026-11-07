DO $$ BEGIN
 CREATE TYPE "public"."face_profile_status" AS ENUM('NOT_ENROLLED', 'PENDING', 'ACTIVE', 'REVOKED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."face_verification_outcome" AS ENUM('PENDING', 'VERIFIED', 'FAILED_NO_MATCH', 'FAILED_LIVENESS', 'FAILED_POOR_QUALITY', 'FAILED_ATTEMPT_LIMIT', 'FAILED_EXPIRED', 'NOT_CONFIGURED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_face_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "face_profile_status" DEFAULT 'NOT_ENROLLED' NOT NULL,
	"reference_photo_key" varchar(512),
	"reference_photo_sha256" varchar(64),
	"model_version" varchar(50) DEFAULT 'arcface-r100-v1' NOT NULL,
	"enrolled_by" uuid,
	"enrolled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "student_face_profiles_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_face_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "face_verification_outcome" DEFAULT 'PENDING' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"confidence_score" varchar(20),
	"liveness_score" varchar(20),
	"failure_reason" text,
	"client_metadata" jsonb,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_face_profiles" ADD CONSTRAINT "student_face_profiles_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_face_profiles" ADD CONSTRAINT "student_face_profiles_enrolled_by_staff_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_face_verifications" ADD CONSTRAINT "attendance_face_verifications_attendance_session_id_attendance_sessions_id_fk" FOREIGN KEY ("attendance_session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_face_verifications" ADD CONSTRAINT "attendance_face_verifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "student_face_profiles_student_id_unique_idx" ON "student_face_profiles" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "student_face_profiles_status_idx" ON "student_face_profiles" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_verifications_session_student_idx" ON "attendance_face_verifications" USING btree ("attendance_session_id","student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_verifications_student_idx" ON "attendance_face_verifications" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_verifications_session_status_idx" ON "attendance_face_verifications" USING btree ("attendance_session_id","status");
