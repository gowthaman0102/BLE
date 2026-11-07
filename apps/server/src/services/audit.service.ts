import { db } from '../db';
import { auditLogs } from '../db/schema/audit';
import { desc, eq, and, ilike, sql } from 'drizzle-orm';

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'bleToken',
  'faceEmbedding',
  'selfie',
  'selfieBase64',
  'photo',
  'photoBase64',
  'biometric',
  'embedding',
];

export interface AuditLogData {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  description: string;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  
  private sanitizeData(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    
    const sanitized = Array.isArray(data) ? [...data] : { ...data };
    for (const key in sanitized) {
      if (SENSITIVE_FIELDS.includes(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }
    return sanitized;
  }

  async log(data: AuditLogData, tx?: any) {
    try {
      const sanitizedOld = this.sanitizeData(data.oldValues);
      const sanitizedNew = this.sanitizeData(data.newValues);

      const client = tx || db;
      await client.insert(auditLogs).values({
        actorId: data.actorId,
        actorName: data.actorName || 'System',
        actorRole: data.actorRole || 'SYSTEM',
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        description: data.description,
        oldValues: sanitizedOld,
        newValues: sanitizedNew,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
      if (tx) {
        throw error;
      }
    }
  }

  async getLogs(params: {
    page?: number;
    limit?: number;
    search?: string;
    action?: string;
    entityType?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 25;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (params.search) {
      conditions.push(
        sql`(${auditLogs.actorName} ILIKE ${'%' + params.search + '%'} OR 
             ${auditLogs.description} ILIKE ${'%' + params.search + '%'} OR 
             ${auditLogs.entityId} ILIKE ${'%' + params.search + '%'})`
      );
    }
    if (params.action) {
      conditions.push(eq(auditLogs.action, params.action));
    }
    if (params.entityType) {
      conditions.push(eq(auditLogs.entityType, params.entityType));
    }
    if (params.actorId) {
      conditions.push(eq(auditLogs.actorId, params.actorId));
    }
    if (params.dateFrom) {
      conditions.push(sql`${auditLogs.createdAt} >= ${new Date(params.dateFrom).toISOString()}`);
    }
    if (params.dateTo) {
      // Adding a full day for dateTo so it includes the whole day
      const toDate = new Date(params.dateTo);
      toDate.setDate(toDate.getDate() + 1);
      conditions.push(sql`${auditLogs.createdAt} < ${toDate.toISOString()}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, [{ count }]] = await Promise.all([
      db.select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql`cast(count(*) as integer)` })
        .from(auditLogs)
        .where(whereClause)
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total: count as number,
        totalPages: Math.ceil((count as number) / limit)
      }
    };
  }
}
