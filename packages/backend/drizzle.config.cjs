const path = require("path");
const dotenv = require("dotenv");
const { defineConfig } = require("drizzle-kit");

const rootDir = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const dbUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/pixel_org";

module.exports = defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
