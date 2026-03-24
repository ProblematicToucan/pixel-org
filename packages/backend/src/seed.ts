/**
 * Optional seed: creates one example lead agent (e.g. CEO).
 * Run after migrations: pnpm run db:seed
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

import { eq } from "drizzle-orm";
import { closeDb, db } from "./db/index.js";
import { agents } from "./db/schema.js";
import { getAgentsMdConfigPointer, provisionAgentWorkspace } from "./storage/index.js";

const EXAMPLE_LEAD_NAME = "Lead";
const backendRoot = path.resolve(__dirname, "..");
const defaultPglitePath = path.join(backendRoot, "data");
const databaseUrl = process.env.DATABASE_URL?.trim();
const useExternalPg = Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl));
const configuredEmbeddedPath = (databaseUrl ?? "").replace(/^file:/, "").trim();
const pglitePath = useExternalPg
  ? defaultPglitePath
  : configuredEmbeddedPath
    ? path.resolve(backendRoot, configuredEmbeddedPath)
    : defaultPglitePath;

async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(__dirname, "..", "drizzle");
  if (useExternalPg && databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    const migrationDb = drizzleNodePg(pool);
    try {
      await migrateNodePg(migrationDb, { migrationsFolder });
    } finally {
      await pool.end();
    }
    return;
  }
  const client = new PGlite(pglitePath);
  const migrationDb = drizzlePglite(client);
  try {
    await migratePglite(migrationDb, { migrationsFolder });
  } finally {
    await client.close();
  }
}

async function seed() {
  await runMigrations();
  const leadRows = await db.select().from(agents).where(eq(agents.isLead, true));
  if (leadRows.length > 1) {
    throw new Error("Multiple lead agents exist; resolve duplicates before seeding.");
  }
  const existing = leadRows[0];

  if (existing) {
    provisionAgentWorkspace({
      id: existing.id,
      name: existing.name,
      role: existing.role,
      config: existing.config,
    });
    await db
      .update(agents)
      .set({ config: getAgentsMdConfigPointer({ id: existing.id, role: existing.role }) })
      .where(eq(agents.id, existing.id));
    console.log("Lead agent already exists; provisioned workspace (AGENTS.md, mcp.json, skills).");
    return;
  }

  await db.insert(agents).values({
    name: EXAMPLE_LEAD_NAME,
    type: "cursor",
    role: "CEO",
    isLead: true,
    parentId: null,
  });

  const [inserted] = await db
    .select()
    .from(agents)
    .where(eq(agents.name, EXAMPLE_LEAD_NAME))
    .limit(1);

  if (inserted) {
    provisionAgentWorkspace({
      id: inserted.id,
      name: inserted.name,
      role: inserted.role,
      config: inserted.config,
    });
    await db
      .update(agents)
      .set({ config: getAgentsMdConfigPointer({ id: inserted.id, role: inserted.role }) })
      .where(eq(agents.id, inserted.id));
    console.log("Seeded example lead agent:", EXAMPLE_LEAD_NAME, "and provisioned agent dir:", inserted.id + "-" + inserted.role.toLowerCase());
  }
}

seed()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
