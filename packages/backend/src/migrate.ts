/**
 * Run pending Drizzle migrations against:
 * - external Postgres when DATABASE_URL is postgres://... / postgresql://...
 * - embedded Postgres (PGlite) otherwise.
 */
import path from "path";
import { fileURLToPath } from "url";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");
const databaseUrl = process.env.DATABASE_URL?.trim();
const useExternalPg = Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl));
const pglitePath = useExternalPg ? "./data" : (databaseUrl ?? "./data").replace(/^file:/, "");

if (useExternalPg && databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzleNodePg(pool);
  try {
    await migrateNodePg(db, { migrationsFolder });
    console.log("Migrations complete (external postgres).");
  } finally {
    await pool.end();
  }
} else {
  const client = new PGlite(pglitePath);
  const db = drizzlePglite(client);
  try {
    await migratePglite(db, { migrationsFolder });
    console.log("Migrations complete (embedded pglite).");
  } finally {
    await client.close();
  }
}
