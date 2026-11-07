import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgresql://postgres:5594a8b84c7e5c99357e67d99af57791b8ebcc44c725583d5ac229fe03de7f07@127.0.0.1:5432/smart_attendance_test',
      NODE_ENV: 'test',
      JWT_SECRET: 'super_secret_for_vitest_testing_only_32_characters_long',
      COLLEGE_EMAIL_DOMAIN: 'sonatech.ac.in,sevenotech.ac.in',
    },
    testTimeout: 15000,
  },
});
