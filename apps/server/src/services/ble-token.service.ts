import { randomBytes, createHash } from 'crypto';
import { BleTokenRepository } from '../repositories/ble-token.repository';
import { StudentRepository } from '../repositories/student.repository';

// Token lifetime is typically bounded to session length, e.g., 2 hours
const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;

export class BleTokenService {
  private repo = new BleTokenRepository();
  private studentRepo = new StudentRepository();
  private static activeTokenCache = new Map<string, string>();

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateSecureToken(): string {
    // 16 cryptographically secure bytes (128 bits) translates to 32 hex chars,
    // which maps 1:1 to a standard 128-bit BLE Service UUID (21-byte total advertisement).
    // This strictly adheres to the 31-byte legacy BLE advertisement limit on all Android hardware.
    return randomBytes(16).toString('hex');
  }

  async generateTokensForSession(sessionId: string, classId: string) {
    // Get all active students for this class
    const students = await this.studentRepo.getStudentsByClass(classId);
    const activeStudents = students.filter((s: any) => s.status === 'ACTIVE');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);

    const tokensToInsert = [];
    const plainTokens = []; // To return to devices

    for (const student of activeStudents) {
      const plainToken = this.generateSecureToken();
      const hashedToken = this.hashToken(plainToken);

      tokensToInsert.push({
        attendanceSessionId: sessionId,
        studentId: student.id,
        tokenHash: hashedToken,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'ACTIVE' as const,
      });

      plainTokens.push({
        studentId: student.id,
        token: plainToken
      });

      BleTokenService.activeTokenCache.set(`${sessionId}_${student.id}`, plainToken);
    }

    if (tokensToInsert.length > 0) {
      await this.repo.createMany(tokensToInsert);
    }

    return plainTokens;
  }

  async validateToken(plainToken: string, sessionId: string) {
    const hashedToken = this.hashToken(plainToken);
    const tokenRecord = await this.repo.findByHash(hashedToken);

    if (!tokenRecord) {
      throw new Error("INVALID_TOKEN");
    }

    if (tokenRecord.attendanceSessionId !== sessionId) {
      throw new Error("TOKEN_BELONGS_TO_OTHER_SESSION");
    }

    if (tokenRecord.status !== 'ACTIVE') {
      throw new Error(`TOKEN_${tokenRecord.status}`);
    }

    const rawExpiresAt = String(tokenRecord.expiresAt);
    const expiresAtUtc = rawExpiresAt.endsWith('Z')
      ? new Date(rawExpiresAt)
      : new Date(`${rawExpiresAt.replace(' ', 'T')}Z`);

    if (expiresAtUtc.getTime() < Date.now()) {
      throw new Error("TOKEN_EXPIRED");
    }

    return tokenRecord;
  }

  async expireTokensForSession(sessionId: string) {
    await this.repo.updateStatusForSession(sessionId, 'EXPIRED');
    
    // Clear cache entries for this session
    for (const key of BleTokenService.activeTokenCache.keys()) {
      if (key.startsWith(`${sessionId}_`)) {
        BleTokenService.activeTokenCache.delete(key);
      }
    }
  }

  async upsertTokenForStudent(sessionId: string, studentId: string): Promise<string> {
    const cacheKey = `${sessionId}_${studentId}`;
    
    const existingActive = await this.repo.findActiveBySessionAndStudent(sessionId, studentId);
    if (existingActive) {
      const cached = BleTokenService.activeTokenCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const plainToken = this.generateSecureToken();
    const hashedToken = this.hashToken(plainToken);
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);
    
    await this.repo.upsertToken({
      attendanceSessionId: sessionId,
      studentId: studentId,
      tokenHash: hashedToken,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'ACTIVE'
    });
    
    BleTokenService.activeTokenCache.set(cacheKey, plainToken);
    
    return plainToken;
  }
}
