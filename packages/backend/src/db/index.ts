import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

const dbPath = process.env.DATABASE_URL ?? "./data";
const client = new PGlite(dbPath.replace(/^file:/, ""));

export const db = drizzle(client, { schema });
export async function closeDb(): Promise<void> {
  await client.close();
}
export * from "./schema.js";
