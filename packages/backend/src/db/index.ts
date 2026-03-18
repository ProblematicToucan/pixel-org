import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const dbPath = process.env.DATABASE_URL ?? "file:./data.db";
const sqlite = new Database(dbPath.replace(/^file:/, ""));

export const db = drizzle(sqlite, { schema });
export * from "./schema.js";
