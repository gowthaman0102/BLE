import crypto from 'crypto';
import { db } from '../db';
import { livenessChallenges, attendanceFaceVerifications } from '../db/schema/face-verification';
import { students } from '../db/schema/students';
import { attendanceSessions } from '../db/schema/attendance';
import { attendanceBleTokens } from '../db/schema/attendance-ble-tokens';
import { attendanceRecords } from '../db/schema/attendance-records';
import { studentFaceProfiles } from '../db/schema/face-verification';
import { eq, and, sql, desc } from 'drizzle-orm';
import type {
  LivenessChallengeType,
  LivenessChallengeResponse,
} from '@smart-attendance/shared';

const CHALLENGE_PROMPTS: Record<LivenessChallengeType, string> = {
  TURN_HEAD_LEFT: 'Slowly turn your head to your LEFT and capture the second frame.',
  TURN_HEAD_RIGHT: 'Slowly turn your head to your RIGHT and capture the second frame.',
  BLINK: 'Blink your eyes and capture the second frame.',
};

const CHALLENGE_TYPES: LivenessChallengeType[] = ['TURN_HEAD_LEFT', 'TURN_HEAD_RIGHT', 'BLINK'];

function parseUtcTimestamp(ts: string | Date): number {
  if (ts instanceof Date) return ts.getTime();
  const str = String(ts).trim();
  const iso = str.endsWith('Z') || str.includes('+') ? str : str.replace(' ', 'T') + 'Z';
  return new Date(iso).getTime();
}

export class LivenessChallengeService {
  /**
   * Issues a server-bound, unpredictable, single-use active challenge.
   * Enforces student identity, active session, BLE eligibility, and enrolled reference photo.
   */
  async createChallenge(studentId: string, sessionId: string): Promise<LivenessChallengeResponse> {
    // 1. Validate active session
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);

    if (!session || session.status !== 'ACTIVE') {
      throw new Error('SESSION_NOT_ACTIVE');
    }

    // 2. Validate student exists and is ACTIVE
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    if (!student || student.status !== 'ACTIVE') {
      throw new Error('STUDENT_INACTIVE');
    }

    // 3. Validate BLE attendance eligibility (token or detection)
    const [tokenRecord] = await db
      .select()
      .from(attendanceBleTokens)
      .where(and(
        eq(attendanceBleTokens.attendanceSessionId, sessionId),
        eq(attendanceBleTokens.studentId, studentId)
      ))
      .limit(1);

    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.attendanceSessionId, sessionId),
        eq(attendanceRecords.studentId, studentId)
      ))
      .limit(1);

    if (!tokenRecord && !record) {
      throw new Error('BLE_ELIGIBILITY_REQUIRED');
    }

    // 4. Validate active enrolled reference photo
    const [profile] = await db
      .select()
      .from(studentFaceProfiles)
      .where(eq(studentFaceProfiles.studentId, studentId))
      .limit(1);

    if (!profile || profile.status !== 'ACTIVE' || !profile.referencePhotoKey) {
      throw new Error('STUDENT_NOT_ENROLLED');
    }

    // 5. Generate secure random challenge
    const randomIndex = crypto.randomInt(0, CHALLENGE_TYPES.length);
    const challengeType = CHALLENGE_TYPES[randomIndex];
    const nonce = crypto.randomBytes(32).toString('hex');
    const ttlSeconds = 90;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const [challenge] = await db
      .insert(livenessChallenges)
      .values({
        studentId,
        attendanceSessionId: sessionId,
        challengeType,
        nonce,
        status: 'PENDING',
        expiresAt,
      })
      .returning();

    return {
      challengeId: challenge.id,
      challengeType,
      promptInstruction: CHALLENGE_PROMPTS[challengeType],
      expiresAt,
      ttlSeconds,
      sessionId,
    };
  }

  /**
   * Atomically validates and consumes an active liveness challenge.
   * Single-use and bounded to student and session.
   */
  async validateAndConsumeChallenge(params: {
    challengeId: string;
    studentId: string;
    sessionId: string;
  }): Promise<{
    id: string;
    challengeType: LivenessChallengeType;
    nonce: string;
  }> {
    const { challengeId, studentId, sessionId } = params;

    const [challenge] = await db
      .select()
      .from(livenessChallenges)
      .where(eq(livenessChallenges.id, challengeId))
      .limit(1);

    if (!challenge) {
      throw new Error('CHALLENGE_NOT_FOUND');
    }

    if (challenge.studentId !== studentId) {
      throw new Error('CHALLENGE_STUDENT_MISMATCH');
    }

    if (challenge.attendanceSessionId !== sessionId) {
      throw new Error('CHALLENGE_SESSION_MISMATCH');
    }

    if (challenge.status === 'CONSUMED') {
      throw new Error('CHALLENGE_ALREADY_USED');
    }

    if (challenge.status === 'EXPIRED') {
      throw new Error('CHALLENGE_EXPIRED');
    }

    const now = Date.now();
    const expiryTime = parseUtcTimestamp(challenge.expiresAt);
    if (now > expiryTime) {
      // Mark as expired
      await db
        .update(livenessChallenges)
        .set({ status: 'EXPIRED' })
        .where(eq(livenessChallenges.id, challengeId));
      throw new Error('CHALLENGE_EXPIRED');
    }

    // Atomically mark as consumed
    const [updated] = await db
      .update(livenessChallenges)
      .set({
        status: 'CONSUMED',
        consumedAt: new Date().toISOString(),
      })
      .where(and(
        eq(livenessChallenges.id, challengeId),
        eq(livenessChallenges.status, 'PENDING')
      ))
      .returning();

    if (!updated) {
      throw new Error('CHALLENGE_ALREADY_USED');
    }

    return {
      id: updated.id,
      challengeType: updated.challengeType as LivenessChallengeType,
      nonce: updated.nonce,
    };
  }
}
