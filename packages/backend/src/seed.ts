/**
 * Optional seed: creates one example lead agent (e.g. CEO).
 * Run after migrations: pnpm run db:seed
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

import { eq } from "drizzle-orm";
import { closeDb, db } from "./db/index.js";
import { agents } from "./db/schema.js";
import { getAgentsMdConfigPointer, provisionAgentWorkspace } from "./storage/index.js";

const EXAMPLE_LEAD_NAME = "Lead";

async function seed() {
  const [existing] = await db
    .select()
    .from(agents)
    .where(eq(agents.name, EXAMPLE_LEAD_NAME))
    .limit(1);

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
    console.log("Example lead agent already exists; provisioned workspace (AGENTS.md, mcp.json, skills).");
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
