/* Data layer entrypoint — picks the MongoDB Atlas adapter when MONGODB_URI
 * is configured, otherwise falls back to the local demo file adapter.
 */

import { MONGODB_URI } from "./config";
import type { DataAdapter } from "./types";
import { fileAdapter } from "./filedb";
import { mongoAdapter } from "./mongo";

export const db: DataAdapter = MONGODB_URI ? mongoAdapter : fileAdapter;

/** Seed admin account (idempotent) — call at the top of auth flows. */
export async function ensureDb(): Promise<void> {
  try {
    await db.ensureSeed();
  } catch (err) {
    console.error("[db] seed/connect failed:", err);
  }
}
