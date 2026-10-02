/* Local file-backed demo adapter.
 * Used ONLY when MONGODB_URI is not configured (e.g. local preview).
 * Production must use MongoDB Atlas via connection string (see README).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type {
  DataAdapter,
  EmailLog,
  ProcessingLog,
  User,
  VerificationToken,
} from "./types";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  FREE_DAILY_LIMIT,
  lastNDays,
  startOfTodayUtc,
} from "./config";

interface Store {
  users: User[];
  tokens: VerificationToken[];
  processingLogs: ProcessingLog[];
  emailLogs: EmailLog[];
}

const EMPTY: Store = { users: [], tokens: [], processingLogs: [], emailLogs: [] };

function resolveDbFile(): string {
  const primary = path.join(process.cwd(), "db", "local-db.json");
  try {
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.accessSync(primary);
    return primary;
  } catch {
    /* try to create it; if the FS is read-only, fall back to /tmp */
    try {
      fs.writeFileSync(primary, JSON.stringify(EMPTY, null, 2), { flag: "wx" });
      return primary;
    } catch {
      return "/tmp/unblurr-demo-db.json";
    }
  }
}

const DB_FILE = resolveDbFile();

let seedPromise: Promise<void> | null = null;

/**
 * Reads the store from disk on every call — route handlers may run in
 * isolated module instances (dev bundling / serverless functions), so a
 * long-lived in-memory cache would go stale across routes.
 */
function load(): Store {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return { ...EMPTY, ...(JSON.parse(raw) as Store) };
  } catch {
    try {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
    } catch { /* read-only FS: work in-memory for this call */ }
    return { ...EMPTY };
  }
}

function save(store: Store): void {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch {
    /* read-only FS: keep working in-memory */
  }
}

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function countToday(userId: string): number {
  const start = startOfTodayUtc().getTime();
  return load().processingLogs.filter(
    (l) => l.userId === userId && new Date(l.createdAt).getTime() >= start
  ).length;
}

function countTotal(userId: string): number {
  return load().processingLogs.filter((l) => l.userId === userId).length;
}

/* ---------------------------------------------------------------- adapter */

export const fileAdapter: DataAdapter = {
  mode: "file",

  async ensureSeed() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
      const store = load();
      if (!store.users.some((u) => u.email === ADMIN_EMAIL)) {
        const bcrypt = (await import("bcryptjs")).default;
        store.users.push({
          id: uid(),
          email: ADMIN_EMAIL,
          passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
          name: "Administrator",
          role: "admin",
          plan: "premium",
          emailVerified: true,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        save(store);
      }
    })();
    return seedPromise;
  },

  async findUserByEmail(email) {
    return load().users.find((u) => u.email === email.toLowerCase().trim()) || null;
  },

  async findUserById(id) {
    return load().users.find((u) => u.id === id) || null;
  },

  async createUser(input) {
    const store = load();
    const user: User = {
      id: uid(),
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
      name: input.name || input.email.split("@")[0],
      role: input.role || "user",
      plan: input.plan || "free",
      emailVerified: input.emailVerified ?? false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.users.push(user);
    save(store);
    return { ...user };
  },

  async updateUser(id, patch) {
    const store = load();
    const idx = store.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    store.users[idx] = { ...store.users[idx], ...patch, updatedAt: nowIso() };
    save(store);
    return { ...store.users[idx] };
  },

  async deleteUser(id) {
    const store = load();
    const before = store.users.length;
    store.users = store.users.filter((u) => u.id !== id);
    store.tokens = store.tokens.filter((t) => t.userId !== id);
    store.processingLogs = store.processingLogs.filter((l) => l.userId !== id);
    save(store);
    return store.users.length < before;
  },

  async listUsers({ search, page, pageSize }) {
    const store = load();
    const q = (search || "").toLowerCase().trim();
    const filtered = store.users
      .filter(
        (u) =>
          !q ||
          u.email.toLowerCase().includes(q) ||
          (u.name || "").toLowerCase().includes(q)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = filtered.length;
    const users = filtered.slice((page - 1) * pageSize, page * pageSize).map((u) => {
      const { passwordHash: _ph, ...pub } = u;
      return { ...pub, videosToday: countToday(u.id), videosTotal: countTotal(u.id) };
    });
    return { users, total, page, pageSize };
  },

  async createVerificationToken(userId) {
    const store = load();
    const token: VerificationToken = {
      token: crypto.randomBytes(24).toString("hex"),
      userId,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      createdAt: nowIso(),
    };
    store.tokens = store.tokens.filter((t) => t.userId !== userId);
    store.tokens.push(token);
    save(store);
    return { ...token };
  },

  async findValidVerificationToken(token) {
    const found = load().tokens.find((t) => t.token === token);
    if (!found) return null;
    if (new Date(found.expiresAt).getTime() < Date.now()) return null;
    return { ...found };
  },

  async findLatestTokenForUser(userId) {
    const list = load().tokens
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list[0] ? { ...list[0] } : null;
  },

  async deleteVerificationToken(token) {
    const store = load();
    store.tokens = store.tokens.filter((t) => t.token !== token);
    save(store);
  },

  async deleteVerificationTokensForUser(userId) {
    const store = load();
    store.tokens = store.tokens.filter((t) => t.userId !== userId);
    save(store);
  },

  async getQuota(userId) {
    const user = load().users.find((u) => u.id === userId);
    if (!user) return null;
    const unlimited = user.role === "admin" || user.plan === "premium";
    const usedToday = countToday(userId);
    return {
      plan: user.plan,
      role: user.role,
      limit: unlimited ? -1 : FREE_DAILY_LIMIT,
      usedToday,
      remaining: unlimited ? -1 : Math.max(0, FREE_DAILY_LIMIT - usedToday),
    };
  },

  async consumeQuota(userId, meta) {
    const store = load();
    const user = store.users.find((u) => u.id === userId);
    if (!user) {
      return { ok: false, reason: "no_user", quota: { plan: "free", role: "user", limit: 0, usedToday: 0, remaining: 0 } };
    }
    const unlimited = user.role === "admin" || user.plan === "premium";
    const usedToday = countToday(userId);
    if (!unlimited && usedToday >= FREE_DAILY_LIMIT) {
      return {
        ok: false,
        reason: "daily_limit",
        quota: { plan: user.plan, role: user.role, limit: FREE_DAILY_LIMIT, usedToday, remaining: 0 },
      };
    }
    store.processingLogs.push({
      id: uid(),
      userId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      createdAt: nowIso(),
    });
    save(store);
    const used = countToday(userId);
    return {
      ok: true,
      quota: {
        plan: user.plan,
        role: user.role,
        limit: unlimited ? -1 : FREE_DAILY_LIMIT,
        usedToday: used,
        remaining: unlimited ? -1 : Math.max(0, FREE_DAILY_LIMIT - used),
      },
    };
  },

  async resetTodayUsage(userId) {
    const store = load();
    const start = startOfTodayUtc().getTime();
    const before = store.processingLogs.length;
    store.processingLogs = store.processingLogs.filter(
      (l) => !(l.userId === userId && new Date(l.createdAt).getTime() >= start)
    );
    const removed = before - store.processingLogs.length;
    save(store);
    return removed;
  },

  async getStats() {
    const store = load();
    const start = startOfTodayUtc().getTime();
    const days = lastNDays(14);
    const dailyProcessing = days.map((date) => ({
      date,
      count: store.processingLogs.filter((l) => l.createdAt.slice(0, 10) === date).length,
    }));
    const dailySignups = days.map((date) => ({
      date,
      count: store.users.filter((u) => u.createdAt.slice(0, 10) === date).length,
    }));
    return {
      totalUsers: store.users.length,
      verifiedUsers: store.users.filter((u) => u.emailVerified).length,
      premiumUsers: store.users.filter((u) => u.plan === "premium").length,
      freeUsers: store.users.filter((u) => u.plan === "free").length,
      admins: store.users.filter((u) => u.role === "admin").length,
      videosToday: store.processingLogs.filter((l) => new Date(l.createdAt).getTime() >= start).length,
      videosTotal: store.processingLogs.length,
      emailsSent: store.emailLogs.filter((e) => e.status === "sent").length,
      bytesProcessed: store.processingLogs.reduce((acc, l) => acc + (l.fileSize || 0), 0),
      dailyProcessing,
      dailySignups,
    };
  },

  async listProcessingLogs({ page, pageSize }) {
    const store = load();
    const sorted = [...store.processingLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const emails = new Map(store.users.map((u) => [u.id, u.email]));
    const logs = sorted.slice((page - 1) * pageSize, page * pageSize).map((l) => ({
      ...l,
      email: emails.get(l.userId) || "deleted user",
    }));
    return { logs, total: sorted.length, page, pageSize };
  },

  async listEmailLogs({ page, pageSize }) {
    const store = load();
    const sorted = [...store.emailLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { logs: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize };
  },

  async logEmail(input) {
    const store = load();
    store.emailLogs.push({ ...input, id: uid(), createdAt: nowIso() });
    save(store);
  },
};
