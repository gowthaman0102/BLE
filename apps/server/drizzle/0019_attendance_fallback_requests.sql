DO $$ BEGIN
 CREATE TYPE "public"."attendance_fallback_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_fallback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"reason_category" varchar(50) NOT NULL,
	"explanation" varchar(500),
	"status" "attendance_fallback_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_fallback_requests" ADD CONSTRAINT "attendance_fallback_requests_attendance_session_id_fk" FOREIGN KEY ("attendance_session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_fallback_requests" ADD CONSTRAINT "attendance_fallback_requests_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_fallback_requests" ADD CONSTRAINT "attendance_fallback_requests_reviewed_by_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_fallback_session_student_idx" ON "attendance_fallback_requests" USING btree ("attendance_session_id","student_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_fallback_status_idx" ON "attendance_fallback_requests" USING btree ("status");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_corrections" ADD COLUMN IF NOT EXISTS "is_post_closure" boolean DEFAULT false NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_corrections" ADD COLUMN IF NOT EXISTS "fallback_request_id" uuid REFERENCES "attendance_fallback_requests"("id") ON DELETE set null;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
