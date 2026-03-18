import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
dotenv.config({ path: path.join(rootDir, ".env") });

import express from "express";
import { db, agents, reviews } from "./db/index.js";
import { getVisibleWork } from "./services/visible-work.js";
import { eq } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT) || 3000;

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
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
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

/** Create a review (lead judging a report’s work). */
app.post("/reviews", async (req, res) => {
  try {
    const { reviewerAgentId, subjectAgentId, projectId, status = "pending", comment } = req.body;
    if (
      reviewerAgentId == null ||
      subjectAgentId == null ||
      projectId == null ||
      typeof projectId !== "string"
    ) {
      res.status(400).json({ error: "reviewerAgentId, subjectAgentId, projectId required" });
      return;
    }
    await db.insert(reviews).values({
      reviewerAgentId: Number(reviewerAgentId),
      subjectAgentId: Number(subjectAgentId),
      projectId: String(projectId).trim(),
      status: ["pending", "approved", "rejected"].includes(status) ? status : "pending",
      comment: comment != null ? String(comment) : null,
    });
    res.status(201).json({
      success: true,
      reviewerAgentId: Number(reviewerAgentId),
      subjectAgentId: Number(subjectAgentId),
      projectId: String(projectId).trim(),
      status: ["pending", "approved", "rejected"].includes(status) ? status : "pending",
      comment: comment != null ? String(comment) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create review" });
  }
});

/** Reviews received for this agent’s work (so Engineer can see CTO’s feedback). */
app.get("/agents/:id/reviews", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const rows = await db.select().from(reviews).where(eq(reviews.subjectAgentId, id));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
