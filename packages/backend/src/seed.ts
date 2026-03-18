/**
 * Optional seed: creates one example org structure with no roles.
 * Users define their own role names and hierarchy (and which roles can recruit) via API.
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
import { orgStructures } from "./db/schema.js";

const EXAMPLE_STRUCTURE_NAME = "My org";

async function seed() {
  const [existing] = await db
    .select({ id: orgStructures.id })
    .from(orgStructures)
    .where(eq(orgStructures.name, EXAMPLE_STRUCTURE_NAME))
    .limit(1);

  if (existing) {
    console.log("Example org structure already exists, skipping seed.");
    return;
  }

  await db.insert(orgStructures).values({
    name: EXAMPLE_STRUCTURE_NAME,
    description: "Add roles and agents via API; role names and hierarchy are user-defined.",
  });

  console.log("Seeded example org structure:", EXAMPLE_STRUCTURE_NAME, "- add roles and agents via API.");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
