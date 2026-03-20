import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

import express from "express";
import cors from "cors";
import { db, agents, projects, threads, messages, agentRunRequests } from "./db/index.js";
import { getVisibleWork } from "./services/visible-work.js";
import { enqueueKickoffLeadRun, runAwakeCycle, startAwakeScheduler } from "./services/orchestration.js";
import {
  provisionAgentWorkspace,
  getAgentsMdConfigPointer,
  getAgentsMdPath,
  readAgentConfigDisplay,
} from "./storage/index.js";
import { eq, or } from "drizzle-orm";
import fs from "node:fs";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

function buildProjectSlug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
  const randomText = Math.random().toString(36).slice(2, 6);
  const randomNumber = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${randomText}-${randomNumber}`;
}

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
        .set({ config: pointer, updatedAt: new Date() })
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

/**
 * Lead-only hiring endpoint.
 * Creates a new child agent where parentId = requester (lead) unless overridden.
 */
app.post("/agents/hire", async (req, res) => {
  try {
    const { requesterAgentId, name, role, type, isLead, config, parentId, agentsMd } = req.body as {
      requesterAgentId?: string;
      name?: string;
      role?: string;
      type?: string;
      isLead?: boolean;
      config?: string | null;
      parentId?: string | null;
      agentsMd?: string | null;
    };

    const requesterId = String(requesterAgentId ?? "").trim();
    if (!requesterId) {
      res.status(400).json({ error: "requesterAgentId is required" });
      return;
    }

    const [requester] = await db.select().from(agents).where(eq(agents.id, requesterId)).limit(1);
    if (!requester) {
      res.status(404).json({ error: "Requester agent not found" });
      return;
    }
    if (!requester.isLead) {
      res.status(403).json({ error: "Only lead agents can hire new agents" });
      return;
    }

    const cleanName = String(name ?? "").trim();
    const cleanRole = String(role ?? "").trim();
    if (!cleanName || !cleanRole) {
      res.status(400).json({ error: "name and role are required" });
      return;
    }

    const cleanType = String(type ?? "cursor").trim() || "cursor";
    const cleanConfig =
      config === undefined || config === null || String(config).trim() === ""
        ? null
        : String(config).trim();
    const hireAsLead = isLead === true;
    const normalizedParentId =
      parentId === undefined || parentId === null || String(parentId).trim() === ""
        ? requester.id
        : String(parentId).trim();

    if (normalizedParentId !== requester.id) {
      res.status(403).json({ error: "Leads can only hire direct reports under themselves" });
      return;
    }

    const newAgentId = randomUUID();
    await db.insert(agents).values({
      id: newAgentId,
      name: cleanName,
      type: cleanType,
      role: cleanRole,
      isLead: hireAsLead,
      parentId: normalizedParentId,
      config: cleanConfig,
    });

    const [created] = await db.select().from(agents).where(eq(agents.id, newAgentId)).limit(1);
    if (!created) {
      res.status(500).json({ error: "Failed to load created agent" });
      return;
    }

    provisionAgentWorkspace({
      id: created.id,
      name: created.name,
      role: created.role,
      config: created.config,
    });
    const customAgentsMd = typeof agentsMd === "string" ? agentsMd.trim() : "";
    if (customAgentsMd) {
      fs.writeFileSync(getAgentsMdPath({ id: created.id, role: created.role }), customAgentsMd, "utf-8");
    }
    const configPointer = getAgentsMdConfigPointer({ id: created.id, role: created.role });
    if (created.config !== configPointer) {
      await db
        .update(agents)
        .set({ config: configPointer, updatedAt: new Date() })
        .where(eq(agents.id, created.id));
    }

    const [finalCreated] = await db.select().from(agents).where(eq(agents.id, newAgentId)).limit(1);
    res.status(201).json({
      success: true,
      hiredBy: requester.id,
      agent: finalCreated ? enrichAgentForResponse(finalCreated) : enrichAgentForResponse(created),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to hire agent" });
  }
});

app.patch("/agents/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    const { name, role, config, awakeEnabled, awakeIntervalMinutes } = req.body;
    if (!id) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const updates: {
      name?: string;
      role?: string;
      config?: string | null;
      awakeEnabled?: boolean;
      awakeIntervalMinutes?: number;
      nextAwakeAt?: Date | null;
      updatedAt?: Date;
    } = {};
    if (typeof name === "string") updates.name = name.trim();
    if (typeof role === "string") updates.role = role.trim();
    if (config !== undefined) updates.config = config === null || config === "" ? null : String(config).trim();
    if (typeof awakeEnabled === "boolean") updates.awakeEnabled = awakeEnabled;
    if (awakeIntervalMinutes !== undefined) {
      const parsed = Number(awakeIntervalMinutes);
      if (!Number.isFinite(parsed) || parsed < 3) {
        res.status(400).json({ error: "awakeIntervalMinutes must be a number >= 3" });
        return;
      }
      updates.awakeIntervalMinutes = Math.floor(parsed);
    }
    // Keep scheduler state aligned with config changes so UI and runtime behavior match immediately.
    const targetAwakeEnabled = updates.awakeEnabled ?? null;
    const targetAwakeInterval = updates.awakeIntervalMinutes ?? null;
    if (targetAwakeEnabled === false) {
      updates.nextAwakeAt = null;
    } else if (targetAwakeEnabled === true || targetAwakeInterval !== null) {
      const [existingAgent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!existingAgent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      const effectiveEnabled = targetAwakeEnabled ?? existingAgent.awakeEnabled;
      const effectiveInterval = targetAwakeInterval ?? existingAgent.awakeIntervalMinutes;
      if (effectiveEnabled) {
        updates.nextAwakeAt = new Date(Date.now() + Math.max(3, effectiveInterval) * 60_000);
      } else {
        updates.nextAwakeAt = null;
      }
    }
    updates.updatedAt = new Date();
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
          .set({ config: configPointer, updatedAt: new Date() })
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
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const cleanName = name.trim();
    const cleanSlug = buildProjectSlug(cleanName);
    await db.insert(projects).values({ name: cleanName, slug: cleanSlug });
    res.status(201).json({ success: true, name: cleanName, slug: cleanSlug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.patch("/projects/:id", async (req, res) => {
  try {
    const id = req.params.id?.trim();
    const { name, goals } = req.body;
    if (!id) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const updates: { name?: string; goals?: string | null } = {};
    if (typeof name === "string") updates.name = name.trim();
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
    const threadId = randomUUID();
    await db.insert(threads).values({
      id: threadId,
      projectId,
      agentId: String(agentId).trim(),
      title: title != null ? String(title).trim() : null,
    });
    await enqueueKickoffLeadRun({
      projectId,
      threadId,
      title: title != null ? String(title).trim() : null,
      preferredAgentId: String(agentId).trim(),
    });
    res.status(201).json({
      success: true,
      id: threadId,
      projectId,
      agentId: String(agentId).trim(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

app.get("/threads/:id/runs", async (req, res) => {
  try {
    const threadId = req.params.id?.trim();
    if (!threadId) {
      res.status(400).json({ error: "Invalid thread id" });
      return;
    }
    const rows = await db.select().from(agentRunRequests).where(eq(agentRunRequests.threadId, threadId));
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch thread run requests" });
  }
});

app.get("/runs/active", async (_req, res) => {
  try {
    const enriched = await db
      .select({
        run: agentRunRequests,
        agentName: agents.name,
        agentRole: agents.role,
        projectName: projects.name,
        threadTitle: threads.title,
      })
      .from(agentRunRequests)
      .leftJoin(agents, eq(agentRunRequests.agentId, agents.id))
      .leftJoin(projects, eq(agentRunRequests.projectId, projects.id))
      .leftJoin(threads, eq(agentRunRequests.threadId, threads.id))
      .where(or(eq(agentRunRequests.status, "queued"), eq(agentRunRequests.status, "running")));
    enriched.sort((a, b) => new Date(b.run.updatedAt).getTime() - new Date(a.run.updatedAt).getTime());
    res.json(
      enriched.map((row) => ({
        ...row.run,
        agentName: row.agentName ?? "Unknown agent",
        agentRole: row.agentRole ?? null,
        projectName: row.projectName ?? "Unknown project",
        threadTitle: row.threadTitle ?? null,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch active run requests" });
  }
});

app.post("/orchestration/awake/run", async (_req, res) => {
  try {
    const result = await runAwakeCycle();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run awake cycle" });
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
    const { agentId, content, actorType, actorName } = req.body;
    const normalizedActorType = typeof actorType === "string" ? actorType.trim().toLowerCase() : "agent";
    const normalizedActorName = typeof actorName === "string" ? actorName.trim() : null;
    const normalizedAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (!threadId || content == null) {
      res.status(400).json({ error: "thread id and content required" });
      return;
    }
    if (normalizedActorType !== "agent" && normalizedActorType !== "board") {
      res.status(400).json({ error: "actorType must be 'agent' or 'board'" });
      return;
    }
    if (normalizedActorType === "agent" && !normalizedAgentId) {
      res.status(400).json({ error: "agentId is required when actorType is agent" });
      return;
    }
    await db.insert(messages).values({
      threadId,
      agentId: normalizedActorType === "agent" ? normalizedAgentId : null,
      actorType: normalizedActorType,
      actorName: normalizedActorType === "board" ? (normalizedActorName || "Board") : normalizedActorName,
      content: String(content).trim(),
    });
    res.status(201).json({
      success: true,
      threadId,
      actorType: normalizedActorType,
      agentId: normalizedActorType === "agent" ? normalizedAgentId : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to post message" });
  }
});

syncAgentConfigPointers()
  .then(() => {
    const pollMsRaw = Number(process.env.PIXEL_AWAKE_POLL_MS ?? "30000");
    const pollMs = Number.isFinite(pollMsRaw) ? Math.max(5000, Math.floor(pollMsRaw)) : 30000;
    startAwakeScheduler(pollMs);
    void runAwakeCycle().catch((err) => {
      console.error("Initial awake cycle failed:", err);
    });
    app.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to sync agent config pointers on startup:", err);
    process.exit(1);
  });
