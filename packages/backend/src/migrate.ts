/**
 * Run pending Drizzle migrations against embedded Postgres (PGlite).
 */
import path from "path";
import { fileURLToPath } from "url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");
const dbPath = (process.env.DATABASE_URL ?? "./data").replace(/^file:/, "");

const client = new PGlite(dbPath);
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");
} finally {
  await client.close();
}
