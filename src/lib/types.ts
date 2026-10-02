/* Shared domain types for unblurr.site */

export type Role = "admin" | "user";
export type Plan = "free" | "premium";

export const UNLIMITED = -1;

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  plan: Plan;
  emailVerified: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  plan: Plan;
  emailVerified: boolean;
  createdAt: string;
}

export interface VerificationToken {
  token: string;
  userId: string;
  expiresAt: string; // ISO
  createdAt: string; // ISO
}

export interface ProcessingLog {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  createdAt: string; // ISO
}

export interface EmailLog {
  id: string;
  to: string;
  subject: string;
  kind: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  createdAt: string; // ISO
}

export interface QuotaInfo {
  plan: Plan;
  role: Role;
  limit: number; // UNLIMITED (-1) for premium/admin
  usedToday: number;
  remaining: number; // UNLIMITED (-1) for premium/admin
}

export interface EnrichedUser extends PublicUser {
  videosToday: number;
  videosTotal: number;
}

export interface DailyCount {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
}

export interface StatsSummary {
  totalUsers: number;
  verifiedUsers: number;
  premiumUsers: number;
  freeUsers: number;
  admins: number;
  videosToday: number;
  videosTotal: number;
  emailsSent: number;
  bytesProcessed: number;
  dailyProcessing: DailyCount[]; // last 14 days (UTC), oldest first
  dailySignups: DailyCount[]; // last 14 days (UTC), oldest first
}

export interface UserListResult {
  users: EnrichedUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LogListResult<T> {
  logs: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DataAdapter {
  mode: "mongodb" | "file";
  ensureSeed(): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    role?: Role;
    plan?: Plan;
    emailVerified?: boolean;
  }): Promise<User>;
  updateUser(
    id: string,
    patch: Partial<Pick<User, "name" | "plan" | "role" | "emailVerified" | "passwordHash">>
  ): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;
  listUsers(opts: { search?: string; page: number; pageSize: number }): Promise<UserListResult>;
  createVerificationToken(userId: string): Promise<VerificationToken>;
  findValidVerificationToken(token: string): Promise<VerificationToken | null>;
  findLatestTokenForUser(userId: string): Promise<VerificationToken | null>;
  deleteVerificationToken(token: string): Promise<void>;
  deleteVerificationTokensForUser(userId: string): Promise<void>;
  getQuota(userId: string): Promise<QuotaInfo | null>;
  consumeQuota(
    userId: string,
    meta: { fileName: string; fileSize: number }
  ): Promise<{ ok: boolean; reason?: string; quota: QuotaInfo }>;
  resetTodayUsage(userId: string): Promise<number>;
  getStats(): Promise<StatsSummary>;
  listProcessingLogs(opts: { page: number; pageSize: number }): Promise<LogListResult<ProcessingLog & { email?: string }>>;
  listEmailLogs(opts: { page: number; pageSize: number }): Promise<LogListResult<EmailLog>>;
  logEmail(input: Omit<EmailLog, "id" | "createdAt">): Promise<void>;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
  };
}
