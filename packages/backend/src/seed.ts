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
import { db } from "./db/index.js";
import { agents } from "./db/schema.js";

const EXAMPLE_LEAD_NAME = "Lead";

async function seed() {
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.name, EXAMPLE_LEAD_NAME))
    .limit(1);

  if (existing) {
    console.log("Example lead agent already exists, skipping seed.");
    return;
  }

  await db.insert(agents).values({
    name: EXAMPLE_LEAD_NAME,
    type: "cursor",
    role: "CEO",
    isLead: true,
    parentId: null,
  });

  console.log("Seeded example lead agent:", EXAMPLE_LEAD_NAME);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
