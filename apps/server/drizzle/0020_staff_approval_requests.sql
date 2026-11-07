CREATE TABLE IF NOT EXISTS "staff_approval_requests" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" varchar(255) NOT NULL,
    "email" varchar(254) NOT NULL UNIQUE,
    "staff_code" varchar(50),
    "department" varchar(100) DEFAULT 'Information Technology',
    "designation" varchar(100) DEFAULT 'Assistant Professor',
    "password_hash" varchar(255) NOT NULL,
    "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
    "rejection_reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
