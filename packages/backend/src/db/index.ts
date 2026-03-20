import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const useExternalPg = Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl));
const pglitePath = useExternalPg ? "./data" : (databaseUrl ?? "./data").replace(/^file:/, "");

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
