<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { API_BASE, api, type Message, type Thread, type Agent, type ThreadStatus } from "../api";
import {
  THREAD_STATUS_OPTIONS,
  formatThreadStatus,
  normalizeThreadStatus,
} from "../threadStatus";

const route = useRoute();
const threadId = computed(() => route.params.id as string);

const thread = ref<Thread | null>(null);
const messages = ref<Message[]>([]);
const agents = ref<Agent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const posting = ref(false);
const newContent = ref("");
let fallbackPollTimer: number | null = null;
let stream: EventSource | null = null;
const selectedRunEventIds = ref<Record<string, string>>({});
const statusPatching = ref(false);

/** Parent project detail, or project list while thread is still loading. */
const backToProjectPath = computed(() =>
  thread.value ? `/projects/${thread.value.projectId}` : "/projects"
);
const backToProjectLabel = computed(() =>
  thread.value ? "← Project" : "← Projects"
);

type RunEvent = {
  message: Message;
  statusLabel: string | null;
};

type TimelineItem =
  | { kind: "message"; key: string; message: Message }
  | {
      kind: "run";
      key: string;
      runId: string;
      author: string;
      events: RunEvent[];
      latestMessage: Message;
      latestStatus: string;
      preview: string;
    };

async function loadThreadAndMessages(options?: { background?: boolean }) {
  if (!threadId.value) return;
  const isBackground = options?.background === true;
  if (!isBackground) {
    loading.value = true;
  }
  error.value = null;
  try {
    const [projects, messagesRes, agentsRes] = await Promise.all([
      api.getProjects(),
      api.getThreadMessages(threadId.value),
      api.getAgents(),
    ]);
    messages.value = messagesRes;
    agents.value = agentsRes;

    for (const p of projects) {
      const threadList = await api.getProjectThreads(p.id);
      const found = threadList.find((t) => t.id === threadId.value);
      if (found) {
        thread.value = found;
        break;
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    if (!isBackground) {
      loading.value = false;
    }
  }
}

async function postMessage() {
  if (!threadId.value || !newContent.value.trim()) return;
  posting.value = true;
  error.value = null;
  try {
    await api.postBoardMessage(threadId.value, {
      content: newContent.value.trim(),
    });
    newContent.value = "";
    messages.value = await api.getThreadMessages(threadId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to post";
  } finally {
    posting.value = false;
  }
}

async function updateThreadStatus(next: ThreadStatus) {
  if (!threadId.value || !thread.value) return;
  const prev = normalizeThreadStatus(thread.value.status);
  if (prev === next) return;
  statusPatching.value = true;
  error.value = null;
  try {
    await api.patchThreadStatusAsBoard(threadId.value, next);
    await loadThreadAndMessages();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to update thread status";
  } finally {
    statusPatching.value = false;
  }
}

function agentName(id: string) {
  return agents.value.find((a) => a.id === id)?.name ?? id;
}

function messageAuthor(m: Message) {
  if (m.actorType === "board") {
    const actor = (m.actorName || "Board").trim();
    if (actor.startsWith("Unknown agent (agent id missing:")) {
      return "System (unresolved agent identity)";
    }
    return actor;
  }
  if (m.actorName?.trim()) return m.actorName.trim();
  if (m.agentId) return agentName(m.agentId);
  return "Unknown agent";
}

function parseRunId(content: string): string | null {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith("run:"));
  if (!line) return null;
  const body = line.slice(4).trim();
  if (!body) return null;
  const idx = body.indexOf(" ");
  return idx === -1 ? body : body.slice(0, idx).trim();
}

function parseStatus(content: string): string | null {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith("status:"));
  if (!line) return null;
  return line.slice(7).trim() || null;
}

function titleCaseStatus(status: string | null): string {
  if (!status) return "Update";
  return status
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function runPreview(content: string): string {
  const lines = content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (
      normalized.startsWith("status:") ||
      normalized.startsWith("run:") ||
      normalized.startsWith("objective:") ||
      normalized.startsWith("actions:") ||
      normalized.startsWith("next:") ||
      normalized.startsWith("reason:") ||
      normalized.startsWith("error:")
    ) {
      continue;
    }
    return line;
  }
  return lines[0] || "No additional details.";
}

function parseObjective(content: string): string | null {
  const line = content
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith("objective:"));
  if (!line) return null;
  const value = line.slice("objective:".length).trim();
  return value || null;
}

function isInProgressStatus(status: string | null): boolean {
  if (!status) return false;
  return status.trim().toLowerCase() === "in progress";
}

function isTerminalStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return normalized === "completed" || normalized === "blocked";
}

const messageRunKeys = computed<Record<string, string>>(() => {
  const runKeyByMessageId: Record<string, string> = {};
  const activeRunByAgent: Record<string, string> = {};

  for (const message of messages.value) {
    if (message.actorType !== "agent" || !message.agentId) continue;

    const explicitRunId = parseRunId(message.content);
    const status = parseStatus(message.content);

    if (explicitRunId) {
      const key = `run:${explicitRunId}`;
      runKeyByMessageId[message.id] = key;
      activeRunByAgent[message.agentId] = key;
      if (isTerminalStatus(status)) {
        delete activeRunByAgent[message.agentId];
      }
      continue;
    }

    const activeKey = activeRunByAgent[message.agentId];
    if (activeKey && (isInProgressStatus(status) || isTerminalStatus(status))) {
      runKeyByMessageId[message.id] = activeKey;
      if (isTerminalStatus(status)) {
        delete activeRunByAgent[message.agentId];
      }
    }
  }

  return runKeyByMessageId;
});

const timelineItems = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [];
  let i = 0;
  while (i < messages.value.length) {
    const current = messages.value[i];
    const runKey = messageRunKeys.value[current.id];
    if (!runKey) {
      items.push({ kind: "message", key: current.id, message: current });
      i += 1;
      continue;
    }

    const runEvents: RunEvent[] = [];
    let j = i;
    while (j < messages.value.length) {
      const candidate = messages.value[j];
      if (messageRunKeys.value[candidate.id] !== runKey) break;
      runEvents.push({
        message: candidate,
        statusLabel: titleCaseStatus(parseStatus(candidate.content)),
      });
      j += 1;
    }

    if (runEvents.length <= 1) {
      items.push({ kind: "message", key: current.id, message: current });
      i += 1;
      continue;
    }

    const latest = runEvents[runEvents.length - 1].message;
    const latestStatus = titleCaseStatus(parseStatus(latest.content));
    const rawRunId = runKey.startsWith("run:") ? runKey.slice(4) : runKey;
    items.push({
      kind: "run",
      key: `${runKey}:${current.id}`,
      runId: rawRunId,
      author: messageAuthor(current),
      events: runEvents,
      latestMessage: latest,
      latestStatus,
      preview: runPreview(latest.content),
    });
    i = j;
  }

  return items;
});

function selectedRunEvent(item: Extract<TimelineItem, { kind: "run" }>): RunEvent {
  const selectedId = selectedRunEventIds.value[item.key];
  return item.events.find((e) => e.message.id === selectedId) ?? item.events[item.events.length - 1];
}

function isRunEventSelected(item: Extract<TimelineItem, { kind: "run" }>, event: RunEvent): boolean {
  return selectedRunEvent(item).message.id === event.message.id;
}

function selectRunEvent(item: Extract<TimelineItem, { kind: "run" }>, event: RunEvent) {
  selectedRunEventIds.value[item.key] = event.message.id;
}

function isInformationalStartedMessage(message: Message): boolean {
  if (message.actorType !== "agent") return false;
  const status = parseStatus(message.content)?.trim().toLowerCase();
  return status === "started";
}

function startedInfoSummary(message: Message): string {
  const objective = parseObjective(message.content);
  return objective ? `Run started: ${objective}` : "Run started.";
}

function standaloneRunStatusLabel(message: Message): string | null {
  if (message.actorType !== "agent") return null;
  const normalized = parseStatus(message.content)?.trim().toLowerCase();
  if (normalized === "in progress" || normalized === "completed") {
    return titleCaseStatus(normalized);
  }
  return null;
}

function closeLiveUpdates() {
  if (fallbackPollTimer != null) {
    window.clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
  if (stream != null) {
    stream.close();
    stream = null;
  }
}

function startLiveUpdates() {
  closeLiveUpdates();
  if (!threadId.value) return;
  const streamUrl = `${API_BASE}/threads/${encodeURIComponent(threadId.value)}/stream`;
  stream = new EventSource(streamUrl);
  stream.addEventListener("message", (evt) => {
    try {
      const incoming = JSON.parse((evt as MessageEvent<string>).data) as Message;
      if (!messages.value.some((m) => m.id === incoming.id)) {
        messages.value.push(incoming);
      }
    } catch {
      // ignore malformed SSE payloads
    }
  });
  stream.addEventListener("error", () => {
    if (fallbackPollTimer != null) return;
    fallbackPollTimer = window.setInterval(() => {
      void loadThreadAndMessages({ background: true });
    }, 5000);
  });
}

watch(
  threadId,
  async (nextId, prevId) => {
    if (!nextId || nextId === prevId) return;
    selectedRunEventIds.value = {};
    await loadThreadAndMessages();
    startLiveUpdates();
  }
);

onMounted(async () => {
  await loadThreadAndMessages();
  startLiveUpdates();
});

onUnmounted(() => {
  closeLiveUpdates();
});
</script>

<template>
  <div class="thread-view">
    <router-link :to="backToProjectPath" class="back">{{ backToProjectLabel }}</router-link>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else>
      <h1>{{ thread ? (thread.title || "Thread") : "Thread" }}</h1>
      <p v-if="thread" class="meta">Owner: {{ agentName(thread.agentId) }}</p>

      <section v-if="thread" class="thread-status-board" aria-label="Thread status (Board)">
        <span
          class="status-badge"
          :class="'status-' + normalizeThreadStatus(thread.status)"
          >{{ formatThreadStatus(thread.status) }}</span
        >
        <label class="status-board-control">
          <span class="status-board-label">Set status</span>
          <select
            class="input status-select"
            :value="normalizeThreadStatus(thread.status)"
            :disabled="statusPatching"
            title="Board of Directors — thread work item status"
            @change="
              updateThreadStatus(($event.target as HTMLSelectElement).value as ThreadStatus)
            "
          >
            <option v-for="opt in THREAD_STATUS_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <p class="status-board-hint">Thread status is the overall work item (like a GitHub issue), separate from agent run messages.</p>
      </section>

      <section class="messages">
        <ul class="message-list">
          <li v-for="item in timelineItems" :key="item.key" class="message-item">
            <template v-if="item.kind === 'message'">
              <template v-if="isInformationalStartedMessage(item.message)">
                <div class="info-row">
                  <span class="author">{{ messageAuthor(item.message) }}</span>
                  <span class="run-badge info">Started</span>
                  <span class="time">{{ new Date(item.message.createdAt).toLocaleString() }}</span>
                </div>
                <p class="content info-content">{{ startedInfoSummary(item.message) }}</p>
              </template>
              <template v-else>
                <div class="info-row">
                  <span class="author">{{ messageAuthor(item.message) }}</span>
                  <span v-if="standaloneRunStatusLabel(item.message)" class="run-badge">
                    {{ standaloneRunStatusLabel(item.message) }}
                  </span>
                  <span class="time">{{ new Date(item.message.createdAt).toLocaleString() }}</span>
                </div>
                <p class="content">{{ item.message.content }}</p>
              </template>
            </template>
            <template v-else>
              <div class="run-header">
                <span class="author">{{ item.author }}</span>
                <span class="run-badge">Run</span>
                <span class="time">{{ new Date(item.latestMessage.createdAt).toLocaleString() }}</span>
              </div>
              <div class="status-chips">
                <button
                  v-for="event in item.events"
                  :key="event.message.id"
                  type="button"
                  class="status-chip"
                  :class="{ final: isRunEventSelected(item, event) }"
                  @click="selectRunEvent(item, event)"
                >
                  {{ event.statusLabel || "Update" }}
                </button>
              </div>
              <p class="content">{{ runPreview(selectedRunEvent(item).message.content) }}</p>
              <div class="run-details">
                <p class="run-meta">Run ID: {{ item.runId }}</p>
                <ul class="run-events">
                  <li>
                    <span class="event-time">{{ new Date(selectedRunEvent(item).message.createdAt).toLocaleString() }}</span>
                    <p class="event-content">{{ selectedRunEvent(item).message.content }}</p>
                  </li>
                </ul>
              </div>
            </template>
          </li>
        </ul>
        <p v-if="!messages.length" class="empty">No messages yet.</p>
      </section>

      <section class="post-form">
        <h2>Post message</h2>
        <p class="meta">Posts are authored as Board of Directors for auditability.</p>
        <div class="form">
          <textarea v-model="newContent" placeholder="Message…" class="input textarea" rows="2"></textarea>
          <button type="button" class="btn" :disabled="posting || !newContent.trim()" @click="postMessage">
            {{ posting ? "Posting…" : "Post" }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.thread-view {
  padding: 0.5rem 0;
}
.back {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--muted);
  text-decoration: none;
  font-size: 0.9rem;
}
.back:hover {
  color: var(--fg);
}
h1 {
  font-size: 1.5rem;
  margin: 0 0 0.25rem;
}
.meta {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 0 0 1rem;
}
.thread-status-board {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.status-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
}
.status-badge.status-not_started {
  border-color: var(--muted);
}
.status-badge.status-in_progress {
  border-color: var(--accent);
  color: var(--accent);
}
.status-badge.status-completed {
  border-color: #2e7d32;
  color: #2e7d32;
}
.status-badge.status-blocked {
  border-color: var(--error);
  color: var(--error);
}
.status-badge.status-cancelled {
  opacity: 0.85;
}
.status-board-control {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.status-board-label {
  font-size: 0.72rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.thread-status-board .status-select {
  min-width: 12rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
}
.status-board-hint {
  width: 100%;
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  flex-basis: 100%;
}
.messages {
  margin-bottom: 1.5rem;
}
.message-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.message-item {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  background: var(--surface);
}
.message-item .author {
  font-weight: 600;
  font-size: 0.9rem;
}
.message-item .time {
  font-size: 0.8rem;
  color: var(--muted);
  margin-left: 0.5rem;
}
.message-item .content {
  margin: 0.5rem 0 0;
  font-size: 0.95rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.run-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.run-badge {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.72rem;
  color: var(--muted);
}
.run-badge.info {
  background: transparent;
}
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}
.status-chip {
  font-size: 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  padding: 0.12rem 0.45rem;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.status-chip.final {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}
.run-details {
  margin-top: 0.6rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
.run-meta {
  margin: 0 0 0.45rem;
  color: var(--muted);
  font-size: 0.82rem;
}
.run-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.event-time {
  color: var(--muted);
  font-size: 0.8rem;
}
.event-content {
  margin: 0.15rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.info-content {
  color: var(--muted);
  font-size: 0.88rem;
}
.empty {
  color: var(--muted);
  font-size: 0.9rem;
}
.post-form h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 32rem;
}
.form .input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
}
.form select.input {
  width: 100%;
  max-width: 16rem;
}
.textarea {
  resize: vertical;
  min-height: 4rem;
}
.btn {
  align-self: flex-start;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--accent);
  color: var(--bg);
  cursor: pointer;
  font-weight: 500;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.state.error {
  color: var(--error);
}
</style>
