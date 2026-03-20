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
import {
  provisionAgentWorkspace,
  getAgentsMdConfigPointer,
  readAgentConfigDisplay,
} from "./storage/index.js";
import { eq } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

function enrichAgentForResponse(agent: typeof agents.$inferSelect) {
  return {
    ...agent,
    configDisplay: readAgentConfigDisplay({
      id: agent.id,
      role: agent.role,
      config: agent.config,
    }),
  };
}

async function syncAgentConfigPointers(): Promise<void> {
  const rows = await db.select().from(agents);
  for (const row of rows) {
    provisionAgentWorkspace({
      id: row.id,
      name: row.name,
      role: row.role,
      config: row.config,
    });
    const pointer = getAgentsMdConfigPointer({ id: row.id, role: row.role });
    if (row.config !== pointer) {
      await db
        .update(agents)
        .set({ config: pointer, updatedAt: new Date().toISOString() })
        .where(eq(agents.id, row.id));
    }
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "backend" });
});

app.get("/agents", async (_req, res) => {
  try {
    const rows = await db.select().from(agents);
    res.json(rows.map(enrichAgentForResponse));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

app.get("/agents/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    if (!id) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(enrichAgentForResponse(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

app.patch("/agents/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    const { name, role, config } = req.body;
    if (!id) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const updates: { name?: string; role?: string; config?: string | null; updatedAt?: string } = {};
    if (typeof name === "string") updates.name = name.trim();
    if (typeof role === "string") updates.role = role.trim();
    if (config !== undefined) updates.config = config === null || config === "" ? null : String(config).trim();
    updates.updatedAt = new Date().toISOString();
    if (Object.keys(updates).filter((k) => k !== "updatedAt").length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }
    await db.update(agents).set(updates).where(eq(agents.id, id));
    const [updated] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (updated) {
      provisionAgentWorkspace({
        id: updated.id,
        name: updated.name,
        role: updated.role,
        config: updated.config,
      });
      const configPointer = getAgentsMdConfigPointer({
        id: updated.id,
        role: updated.role,
      });
      if (updated.config !== configPointer) {
        await db
          .update(agents)
          .set({ config: configPointer, updatedAt: new Date().toISOString() })
          .where(eq(agents.id, id));
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update agent" });
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

syncAgentConfigPointers()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to sync agent config pointers on startup:", err);
    process.exit(1);
  });
