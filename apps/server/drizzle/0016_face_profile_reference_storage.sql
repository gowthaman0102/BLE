ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "image_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "mime_type" varchar(50);
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "file_size" integer;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "width" integer;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "height" integer;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "revoked_by" uuid;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "revocation_reason" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_face_profiles" ADD CONSTRAINT "student_face_profiles_revoked_by_staff_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
