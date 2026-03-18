import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

import express from "express";
import cors from "cors";
import { db, agents, projects, threads, messages } from "./db/index.js";
import { getVisibleWork } from "./services/visible-work.js";
import { eq } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend" });
});

app.get("/agents", async (_req, res) => {
  try {
    const rows = await db.select().from(agents);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

/** Work this agent can see: self + all reports (CEO sees everyone, CTO sees Engineers, etc.). */
app.get("/agents/:id/visible-work", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    if (!id) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const work = await getVisibleWork(db, id);
    res.json(work);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get visible work" });
  }
});

// --- Projects (like Slack channels) ---
app.get("/projects", async (_req, res) => {
  try {
    const rows = await db.select().from(projects);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.get("/projects/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    if (!id) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

app.post("/projects", async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug || typeof name !== "string" || typeof slug !== "string") {
      res.status(400).json({ error: "name and slug required" });
      return;
    }
    await db.insert(projects).values({ name: name.trim(), slug: slug.trim() });
    res.status(201).json({ success: true, name: name.trim(), slug: slug.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.patch("/projects/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    const { name, slug, goals } = req.body;
    if (!id) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const updates: { name?: string; slug?: string; goals?: string | null } = {};
    if (typeof name === "string") updates.name = name.trim();
    if (typeof slug === "string") updates.slug = slug.trim();
    if (goals !== undefined) updates.goals = goals === null || goals === "" ? null : String(goals).trim();
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }
    await db.update(projects).set(updates).where(eq(projects.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// --- Threads (work in a project; one agent owns, anyone can discuss) ---
app.get("/projects/:id/threads", async (req, res) => {
  try {
    const projectId = req.params.id?.trim();
    if (!projectId) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const rows = await db.select().from(threads).where(eq(threads.projectId, projectId));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

app.post("/projects/:id/threads", async (req, res) => {
  try {
    const projectId = req.params.id?.trim();
    const { agentId, title } = req.body;
    if (!projectId || agentId == null) {
      res.status(400).json({ error: "project id and agentId required" });
      return;
    }
    await db.insert(threads).values({
      projectId,
      agentId: String(agentId).trim(),
      title: title != null ? String(title).trim() : null,
    });
    res.status(201).json({ success: true, projectId, agentId: String(agentId).trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// --- Messages (replies in a thread; any agent can post) ---
app.get("/threads/:id/messages", async (req, res) => {
  try {
    const threadId = req.params.id?.trim();
    if (!threadId) {
      res.status(400).json({ error: "Invalid thread id" });
      return;
    }
    const rows = await db.select().from(messages).where(eq(messages.threadId, threadId));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.post("/threads/:id/messages", async (req, res) => {
  try {
    const threadId = req.params.id?.trim();
    const { agentId, content } = req.body;
    if (!threadId || agentId == null || content == null) {
      res.status(400).json({ error: "thread id, agentId, and content required" });
      return;
    }
    await db.insert(messages).values({
      threadId,
      agentId: String(agentId).trim(),
      content: String(content).trim(),
    });
    res.status(201).json({ success: true, threadId, agentId: String(agentId).trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to post message" });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
