import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..", "..");
const defaultPglitePath = path.join(backendRoot, "data");
const databaseUrl = process.env.DATABASE_URL?.trim();
const useExternalPg = Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl));
const configuredEmbeddedPath = (databaseUrl ?? "").replace(/^file:/, "").trim();
const pglitePath = useExternalPg
  ? defaultPglitePath
  : configuredEmbeddedPath
    ? path.resolve(backendRoot, configuredEmbeddedPath)
    : defaultPglitePath;

let closeDbImpl: () => Promise<void>;

export const db = (() => {
  if (useExternalPg && databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    closeDbImpl = async () => {
      await pool.end();
    };
    return drizzleNodePg(pool, { schema });
  }

  const client = new PGlite(pglitePath);
  closeDbImpl = async () => {
    await client.close();
  };
  return drizzlePglite(client, { schema });
})();

export async function closeDb(): Promise<void> {
  await closeDbImpl();
}
export * from "./schema.js";
