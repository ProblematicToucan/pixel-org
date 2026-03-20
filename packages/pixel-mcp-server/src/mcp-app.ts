/**
 * Pixel Context MCP App: displays projects, threads, and messages for the current agent.
 * Registers all handlers before app.connect() per create-mcp-app skill.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./mcp-app.css";

type Project = {
  id: string;
  name: string;
  slug: string;
  threads?: {
    id: string;
    agentId: string;
    title: string | null;
    messages: {
      id: string;
      agentId: string | null;
      actorType: "agent" | "board";
      actorName: string | null;
      content: string;
      createdAt: string;
    }[];
  }[];
};

function extractContext(result: CallToolResult): { projects: Project[] } | null {
  const raw = (result as { structuredContent?: unknown }).structuredContent;
  if (!raw || typeof raw !== "object" || !("projects" in raw)) return null;
  const { projects } = raw as { projects: Project[] };
  return Array.isArray(projects) ? { projects } : null;
}

function render(context: { projects: Project[] }): string {
  if (!context.projects.length) {
    return '<p class="empty">No projects yet.</p>';
  }
  const parts: string[] = [];
  for (const p of context.projects) {
    const threads = p.threads ?? [];
    const threadHtml = threads
      .map((t) => {
        const title = t.title || "(no title)";
        const msgHtml = (t.messages ?? [])
          .map(
            (m) =>
              `<div class="message"><span class="meta">${escapeHtml(m.actorName || m.agentId || (m.actorType === "board" ? "Board" : "Agent"))}</span><div>${escapeHtml(m.content)}</div></div>`
          )
          .join("");
        return `<div class="thread"><div class="title">${escapeHtml(title)}</div><div class="messages">${msgHtml || '<p class="empty">No messages</p>'}</div></div>`;
      })
      .join("");
    parts.push(`
      <div class="project">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="slug">${escapeHtml(p.slug)} (${escapeHtml(p.id)})</p>
        <div class="threads">${threadHtml || '<p class="empty">No threads</p>'}</div>
      </div>
    `);
  }
  return parts.join("");
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const contentEl = document.getElementById("content")!;
const errorEl = document.getElementById("error") as HTMLElement;
const refreshBtn = document.getElementById("refresh-btn")!;
const mainEl = document.querySelector(".main") as HTMLElement;

function showError(msg: string): void {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets && mainEl) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Pixel Context", version: "1.0.0" });

app.ontoolinput = () => {
  clearError();
  contentEl.innerHTML = '<p class="notice">Loading…</p>';
};

app.ontoolresult = (result) => {
  clearError();
  const context = extractContext(result);
  if (context) {
    contentEl.innerHTML = render(context);
  } else {
    const text = (result.content && result.content[0] && "text" in result.content[0])
      ? (result.content[0] as { text: string }).text
      : JSON.stringify(result);
    contentEl.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
  }
};

app.ontoolcancelled = () => {
  contentEl.innerHTML = '<p class="notice">Request cancelled.</p>';
};

app.onteardown = async () => ({});
app.onerror = (e) => {
  console.error("Pixel Context app error:", e);
  showError(e?.message ?? String(e));
};
app.onhostcontextchanged = handleHostContextChanged;

refreshBtn.addEventListener("click", async () => {
  clearError();
  try {
    const result = await app.callServerTool({ name: "pixel_show_context", arguments: {} });
    app.ontoolresult?.(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showError(msg);
    contentEl.innerHTML = `<p class="notice">Error: ${escapeHtml(msg)}</p>`;
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
