import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const dbPath = process.env.DATABASE_URL ?? "file:./data.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath.replace(/^file:/, ""),
  },
});
