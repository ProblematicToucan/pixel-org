/**
 * Run pending Drizzle migrations by executing SQL files.
 * Use when drizzle-kit migrate fails in ESM (e.g. "require is not defined").
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DATABASE_URL ?? "file:./data.db";
const dbFile = dbPath.replace(/^file:/, "");
const migrationsDir = path.join(__dirname, "..", "drizzle");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
  entries: { tag: string }[];
};
const entries = journal.entries as { tag: string }[];

const db = new Database(dbFile);

db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const applied = new Set(
  (db.prepare("SELECT tag FROM __drizzle_migrations").all() as { tag: string }[]).map((r) => r.tag)
);

for (const { tag } of entries) {
  if (applied.has(tag)) continue;
  const sqlPath = path.join(migrationsDir, `${tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    console.error(`Missing migration file: ${sqlPath}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf-8");
  console.log(`Running ${tag}...`);
  try {
    db.exec(sql);
    db.prepare("INSERT INTO __drizzle_migrations (tag) VALUES (?)").run(tag);
  } catch (err) {
    console.error(`Migration ${tag} failed:`, err);
    process.exit(1);
  }
}

db.close();
console.log("Migrations complete.");
