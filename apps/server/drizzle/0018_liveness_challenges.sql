DO $$ BEGIN
 CREATE TYPE "public"."liveness_challenge_status" AS ENUM('PENDING', 'CONSUMED', 'EXPIRED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liveness_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"challenge_type" varchar(50) NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"status" "liveness_challenge_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liveness_challenges" ADD CONSTRAINT "liveness_challenges_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liveness_challenges" ADD CONSTRAINT "liveness_challenges_attendance_session_id_attendance_sessions_id_fk" FOREIGN KEY ("attendance_session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liveness_challenges_student_session_idx" ON "liveness_challenges" USING btree ("student_id","attendance_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liveness_challenges_status_idx" ON "liveness_challenges" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "liveness_challenges_expires_at_idx" ON "liveness_challenges" USING btree ("expires_at");
