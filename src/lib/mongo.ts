/* MongoDB Atlas adapter (official driver, serverless-friendly cached connection).
 * Activated when MONGODB_URI is set (Atlas connection string).
 */

import { MongoClient, Db, Collection, ObjectId } from "mongodb";
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
  FREE_DAILY_LIMIT,
  lastNDays,
  MONGODB_DB,
  MONGODB_URI,
  startOfTodayUtc,
} from "./config";

const globalForMongo = globalThis as unknown as { _unblurrMongo?: MongoClient };

async function getDb(): Promise<Db> {
  if (!globalForMongo._unblurrMongo) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    globalForMongo._unblurrMongo = client;
  }
  return globalForMongo._unblurrMongo.db(MONGODB_DB || undefined);
}

let seedPromise: Promise<void> | null = null;

function userDoc(u: any): User {
  return {
    id: String(u._id),
    email: u.email,
    passwordHash: u.passwordHash,
    name: u.name || "",
    role: u.role || "user",
    plan: u.plan || "free",
    emailVerified: !!u.emailVerified,
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
    updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : String(u.updatedAt),
  };
}

const nowIso = () => new Date().toISOString();

/** Accept both ObjectId-shaped and string ids (file adapter uses plain strings). */
function idFilter(id: string): any {
  if (ObjectId.isValid(id)) {
    try {
      return { _id: new ObjectId(id) };
    } catch {
      return { _id: id as any };
    }
  }
  return { _id: id as any };
}

async function countToday(col: Collection, userId: string): Promise<number> {
  return col.countDocuments({ userId, createdAt: { $gte: startOfTodayUtc() } });
}
async function countTotal(col: Collection, userId: string): Promise<number> {
  return col.countDocuments({ userId });
}

/* ---------------------------------------------------------------- adapter */

export const mongoAdapter: DataAdapter = {
  mode: "mongodb",

  async ensureSeed() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
      const db = await getDb();
      const bcrypt = (await import("bcryptjs")).default;
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await db.collection("verification_tokens").createIndex({ token: 1 }, { unique: true });
      await db.collection("verification_tokens").createIndex({ expiresAt: 1 });
      await db.collection("processing_logs").createIndex({ userId: 1, createdAt: -1 });
      await db.collection("processing_logs").createIndex({ createdAt: -1 });
      await db.collection("email_logs").createIndex({ createdAt: -1 });
      const exists = await db.collection("users").findOne({ email: ADMIN_EMAIL });
      if (!exists) {
        await db.collection("users").insertOne({
          email: ADMIN_EMAIL,
          passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
          name: "Administrator",
          role: "admin",
          plan: "premium",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    })();
    /* keep promise cached even on failure so a broken URI doesn't retry forever */
    return seedPromise;
  },

  async findUserByEmail(email) {
    const db = await getDb();
    const doc = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    return doc ? userDoc(doc) : null;
  },

  async findUserById(id) {
    const db = await getDb();
    const doc = await db.collection("users").findOne(idFilter(id));
    return doc ? userDoc(doc) : null;
  },

  async createUser(input) {
    const db = await getDb();
    const doc = {
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
      name: input.name || input.email.split("@")[0],
      role: input.role || "user",
      plan: input.plan || "free",
      emailVerified: input.emailVerified ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const res = await db.collection("users").insertOne(doc);
    return userDoc({ ...doc, _id: res.insertedId });
  },

  async updateUser(id, patch) {
    const db = await getDb();
    const res = await db
      .collection("users")
      .findOneAndUpdate(
        idFilter(id),
        { $set: { ...patch, updatedAt: new Date() } },
        { returnDocument: "after" }
      );
    return res ? userDoc(res) : null;
  },

  async deleteUser(id) {
    const db = await getDb();
    const res = await db.collection("users").deleteOne(idFilter(id));
    await db.collection("verification_tokens").deleteMany({ userId: id });
    await db.collection("processing_logs").deleteMany({ userId: id });
    return res.deletedCount > 0;
  },

  async listUsers({ search, page, pageSize }) {
    const db = await getDb();
    const q = (search || "").trim();
    const filter = q
      ? { $or: [{ email: { $regex: q, $options: "i" } }, { name: { $regex: q, $options: "i" } }] }
      : {};
    const total = await db.collection("users").countDocuments(filter);
    const docs = await db
      .collection("users")
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
    const logs = db.collection("processing_logs");
    const users = await Promise.all(
      docs.map(async (d: any) => {
        const u = userDoc(d);
        const { passwordHash: _ph, ...pub } = u;
        return {
          ...pub,
          videosToday: await countToday(logs, u.id),
          videosTotal: await countTotal(logs, u.id),
        };
      })
    );
    return { users, total, page, pageSize };
  },

  async createVerificationToken(userId) {
    const db = await getDb();
    await db.collection("verification_tokens").deleteMany({ userId });
    const token = crypto.randomBytes(24).toString("hex");
    const doc = {
      token,
      userId,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      createdAt: new Date(),
    };
    await db.collection("verification_tokens").insertOne(doc);
    return {
      token,
      userId,
      expiresAt: doc.expiresAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
    };
  },

  async findValidVerificationToken(token) {
    const db = await getDb();
    const doc = await db.collection("verification_tokens").findOne({
      token,
      expiresAt: { $gte: new Date() },
    });
    if (!doc) return null;
    return {
      token: doc.token,
      userId: doc.userId,
      expiresAt: doc.expiresAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
    };
  },

  async findLatestTokenForUser(userId) {
    const db = await getDb();
    const doc = await db
      .collection("verification_tokens")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    if (!doc) return null;
    return {
      token: doc.token,
      userId: doc.userId,
      expiresAt: doc.expiresAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
    };
  },

  async deleteVerificationToken(token) {
    const db = await getDb();
    await db.collection("verification_tokens").deleteOne({ token });
  },

  async deleteVerificationTokensForUser(userId) {
    const db = await getDb();
    await db.collection("verification_tokens").deleteMany({ userId });
  },

  async getQuota(userId) {
    const user = await mongoAdapter.findUserById(userId);
    if (!user) return null;
    const db = await getDb();
    return quotaFor(user, await countToday(db.collection("processing_logs"), userId));
  },

  async consumeQuota(userId, meta) {
    const db = await getDb();
    const doc = await db.collection("users").findOne(idFilter(userId));
    if (!doc) {
      return { ok: false, reason: "no_user", quota: { plan: "free", role: "user", limit: 0, usedToday: 0, remaining: 0 } };
    }
    const user = userDoc(doc);
    const logs = db.collection("processing_logs");
    const usedToday = await countToday(logs, userId);
    const unlimited = user.role === "admin" || user.plan === "premium";
    if (!unlimited && usedToday >= FREE_DAILY_LIMIT) {
      return {
        ok: false,
        reason: "daily_limit",
        quota: { plan: user.plan, role: user.role, limit: FREE_DAILY_LIMIT, usedToday, remaining: 0 },
      };
    }
    await logs.insertOne({
      userId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      createdAt: new Date(),
    });
    const used = await countToday(logs, userId);
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
    const db = await getDb();
    const res = await db.collection("processing_logs").deleteMany({
      userId,
      createdAt: { $gte: startOfTodayUtc() },
    });
    return res.deletedCount;
  },

  async getStats() {
    const db = await getDb();
    const start = startOfTodayUtc();
    const days = lastNDays(14);
    const [
      totalUsers,
      verifiedUsers,
      premiumUsers,
      freeUsers,
      admins,
      videosToday,
      videosTotal,
      emailsSent,
      bytesAgg,
      dailyProcessing,
      dailySignups,
    ] = await Promise.all([
      db.collection("users").countDocuments({}),
      db.collection("users").countDocuments({ emailVerified: true }),
      db.collection("users").countDocuments({ plan: "premium" }),
      db.collection("users").countDocuments({ plan: "free" }),
      db.collection("users").countDocuments({ role: "admin" }),
      db.collection("processing_logs").countDocuments({ createdAt: { $gte: start } }),
      db.collection("processing_logs").countDocuments({}),
      db.collection("email_logs").countDocuments({ status: "sent" }),
      db.collection("processing_logs").aggregate([{ $group: { _id: null, bytes: { $sum: "$fileSize" } } }]).toArray(),
      db
        .collection("processing_logs")
        .aggregate([
          { $match: { createdAt: { $gte: new Date(days[0] + "T00:00:00.000Z") } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection("users")
        .aggregate([
          { $match: { createdAt: { $gte: new Date(days[0] + "T00:00:00.000Z") } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    const pMap = new Map(dailyProcessing.map((d: any) => [d._id, d.count]));
    const sMap = new Map(dailySignups.map((d: any) => [d._id, d.count]));
    return {
      totalUsers,
      verifiedUsers,
      premiumUsers,
      freeUsers,
      admins,
      videosToday,
      videosTotal,
      emailsSent,
      bytesProcessed: bytesAgg[0]?.bytes || 0,
      dailyProcessing: days.map((date) => ({ date, count: pMap.get(date) || 0 })),
      dailySignups: days.map((date) => ({ date, count: sMap.get(date) || 0 })),
    };
  },

  async listProcessingLogs({ page, pageSize }) {
    const db = await getDb();
    const total = await db.collection("processing_logs").countDocuments({});
    const docs = await db
      .collection("processing_logs")
      .aggregate([
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
        {
          $lookup: {
            from: "users",
            let: { uid: "$userId" },
            pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$uid"] } } }],
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $addFields: { email: { $ifNull: ["$user.email", "deleted user"] } } },
        { $project: { user: 0 } },
      ])
      .toArray();
    const logs: (ProcessingLog & { email?: string })[] = docs.map((d: any) => ({
      id: String(d._id),
      userId: d.userId,
      fileName: d.fileName,
      fileSize: d.fileSize,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
      email: d.email,
    }));
    return { logs, total, page, pageSize };
  },

  async listEmailLogs({ page, pageSize }) {
    const db = await getDb();
    const total = await db.collection("email_logs").countDocuments({});
    const docs = await db
      .collection("email_logs")
      .find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
    const logs: EmailLog[] = docs.map((d: any) => ({
      id: String(d._id),
      to: d.to,
      subject: d.subject,
      kind: d.kind,
      status: d.status,
      error: d.error,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    }));
    return { logs, total, page, pageSize };
  },

  async logEmail(input) {
    const db = await getDb();
    await db.collection("email_logs").insertOne({ ...input, createdAt: new Date() });
  },
};

function quotaFor(user: User, usedToday: number) {
  const unlimited = user.role === "admin" || user.plan === "premium";
  return {
    plan: user.plan,
    role: user.role,
    limit: unlimited ? -1 : FREE_DAILY_LIMIT,
    usedToday,
    remaining: unlimited ? -1 : Math.max(0, FREE_DAILY_LIMIT - usedToday),
  };
}

/* Helper used by db.ts to surface connection errors */
export async function pingMongo(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export { nowIso };
