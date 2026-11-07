ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "reference_embedding" jsonb;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "embedding_extracted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN IF NOT EXISTS "embedding_model" varchar(50);
