<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import {
  api,
  type Project,
  type Agent,
  type Thread,
  type ThreadStatus,
  type ProjectAgentWorkspace,
} from "../api";
import { THREAD_STATUS_OPTIONS, normalizeThreadStatus } from "../threadStatus";

const route = useRoute();
const projectId = computed(() => route.params.id as string);

const project = ref<Project | null>(null);
const threads = ref<Thread[]>([]);
const agents = ref<Agent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const creating = ref(false);
const newTitle = ref("");
const newAgentId = ref("");
const goalsDraft = ref("");
const goalsSaving = ref(false);
const goalsNotice = ref<string | null>(null);
const statusFilter = ref<"" | ThreadStatus>("");
const newThreadStatus = ref<ThreadStatus>("not_started");
const statusUpdating = ref<Record<string, boolean>>({});
const agentWorkspaces = ref<ProjectAgentWorkspace[]>([]);
const artifactsLoading = ref(false);
const artifactsLoadError = ref<string | null>(null);
/** True after a successful fetch for the current project (while section is open). */
const artifactsFetched = ref(false);
const artifactsPanelRef = ref<HTMLDetailsElement | null>(null);

function getBoardAgentId() {
  const lead = agents.value.find((agent) => agent.isLead);
  return lead?.id ?? agents.value[0]?.id ?? null;
}

function hasBoardKickoffThread() {
  return threads.value.some((thread) => (thread.title ?? "").trim().toLowerCase() === "board kickoff");
}

async function maybeCreateBoardKickoff(goals: string) {
  const boardAgentId = getBoardAgentId();
  if (!projectId.value || !goals || !boardAgentId || hasBoardKickoffThread()) return false;

  const created = await api.createThread(projectId.value, {
    agentId: boardAgentId,
    title: "Board kickoff",
    /** So the kickoff thread is active work and lead/agent runs align with orchestration. */
    status: "in_progress",
  });

  await api.postBoardMessage(created.id, {
    content: `Project goals:\n\n${goals}`,
  });

  return true;
}

async function load() {
  if (!projectId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const [p, a] = await Promise.all([
      api.getProject(projectId.value),
      api.getAgents(),
    ]);
    const t = await api.getProjectThreads(
      projectId.value,
      statusFilter.value === "" ? undefined : { status: statusFilter.value }
    );
    project.value = p;
    threads.value = t;
    agents.value = a;
    goalsDraft.value = p.goals ?? "";
    if (agents.value.length && !newAgentId.value) newAgentId.value = agents.value[0].id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function saveGoals() {
  if (!projectId.value || !project.value) return;
  goalsSaving.value = true;
  goalsNotice.value = null;
  try {
    const hadGoalsBefore = Boolean(project.value.goals?.trim());
    const nextGoals = goalsDraft.value.trim();
    await api.updateProject(projectId.value, {
      goals: nextGoals ? nextGoals : null,
    });
    project.value = {
      ...project.value,
      goals: nextGoals ? nextGoals : null,
    };
    goalsDraft.value = nextGoals;
    const shouldCreateKickoff = !hadGoalsBefore && Boolean(nextGoals);
    let kickoffCreated = false;
    if (shouldCreateKickoff) {
      kickoffCreated = await maybeCreateBoardKickoff(nextGoals);
      if (kickoffCreated) {
        threads.value = await api.getProjectThreads(
          projectId.value,
          statusFilter.value === "" ? undefined : { status: statusFilter.value }
        );
      }
    }
    goalsNotice.value = kickoffCreated
      ? "Goals saved. Board kickoff thread created."
      : "Goals saved.";
  } catch (e) {
    goalsNotice.value = e instanceof Error ? e.message : "Failed to save goals";
  } finally {
    goalsSaving.value = false;
  }
}

async function clearGoals() {
  goalsDraft.value = "";
  await saveGoals();
}

async function createThread() {
  if (!projectId.value || !newAgentId.value) return;
  creating.value = true;
  error.value = null;
  try {
    await api.createThread(projectId.value, {
      agentId: newAgentId.value,
      title: newTitle.value.trim() || undefined,
      status: newThreadStatus.value,
    });
    newTitle.value = "";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to create thread";
  } finally {
    creating.value = false;
  }
}

function agentName(id: string) {
  return agents.value.find((a) => a.id === id)?.name ?? id;
}

async function loadAgentWorkspaces() {
  if (!projectId.value || artifactsFetched.value) return;
  artifactsLoading.value = true;
  artifactsLoadError.value = null;
  try {
    agentWorkspaces.value = await api.getProjectAgentWorkspaces(projectId.value);
    artifactsFetched.value = true;
  } catch (e) {
    artifactsLoadError.value = e instanceof Error ? e.message : "Failed to load";
    agentWorkspaces.value = [];
  } finally {
    artifactsLoading.value = false;
  }
}

function onArtifactsToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement;
  if (el.open) void loadAgentWorkspaces();
}

async function refreshArtifacts() {
  artifactsFetched.value = false;
  agentWorkspaces.value = [];
  artifactsLoadError.value = null;
  await loadAgentWorkspaces();
}

watch(projectId, () => {
  artifactsFetched.value = false;
  agentWorkspaces.value = [];
  artifactsLoadError.value = null;
  if (artifactsPanelRef.value?.open) {
    void loadAgentWorkspaces();
  }
});

async function onThreadStatusChange(threadId: string, next: ThreadStatus) {
  const current = threads.value.find((t) => t.id === threadId);
  const prev = current ? normalizeThreadStatus(current.status) : null;
  if (prev === next) return;
  statusUpdating.value = { ...statusUpdating.value, [threadId]: true };
  error.value = null;
  try {
    await api.patchThreadStatusAsBoard(threadId, next);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to update thread status";
  } finally {
    statusUpdating.value = { ...statusUpdating.value, [threadId]: false };
  }
}

onMounted(load);
</script>

<template>
  <div class="project-view">
    <router-link to="/projects" class="back">← Projects</router-link>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else-if="project">
      <h1>{{ project.name }}</h1>
      <p class="sub"><code>{{ project.slug }}</code></p>

      <section class="board-goals">
        <h2>Board goals</h2>
        <p class="goals-help">Set project direction and expected outcomes.</p>
        <div class="goals-form">
          <textarea
            v-model="goalsDraft"
            class="input goals-textarea"
            placeholder="Write project goals, scope, hiring needs, and constraints..."
            rows="5"
          ></textarea>
          <div class="goals-actions">
            <button
              type="button"
              class="btn"
              :disabled="goalsSaving"
              @click="saveGoals"
            >
              {{ goalsSaving ? "Saving…" : "Save goals" }}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="goalsSaving || !goalsDraft.trim()"
              @click="clearGoals"
            >
              Clear
            </button>
          </div>
          <p v-if="goalsNotice" class="goals-notice">{{ goalsNotice }}</p>
        </div>
      </section>

      <details ref="artifactsPanelRef" class="artifacts-panel" @toggle="onArtifactsToggle">
        <summary class="artifacts-summary">
          <span class="artifacts-summary-title">Artifacts</span>
          <span class="artifacts-summary-hint">Agent workspaces on disk (loaded when you open this section)</span>
        </summary>
        <div class="artifacts-panel-body">
          <p v-if="artifactsLoading" class="state">Loading workspaces…</p>
          <p v-else-if="artifactsLoadError" class="state error">{{ artifactsLoadError }}</p>
          <template v-else-if="artifactsFetched">
            <p class="meta board-hint artifacts-intro">
              Folder name matches project id. Paths are under your agents storage root.
            </p>
            <ul v-if="agentWorkspaces.length" class="workspace-list">
              <li v-for="ws in agentWorkspaces" :key="ws.agentId" class="workspace-item">
                <div class="workspace-head">
                  <strong>{{ ws.name }}</strong>
                  <span class="role">{{ ws.role }}</span>
                </div>
                <code class="workspace-path">{{ ws.artifactsPath }}</code>
              </li>
            </ul>
            <p v-else class="empty">No agent artifact folders yet. When an agent runs on this project, outputs go under this path.</p>
            <button
              type="button"
              class="btn btn-secondary artifacts-refresh"
              :disabled="artifactsLoading"
              @click="refreshArtifacts"
            >
              Refresh list
            </button>
          </template>
          <p v-else class="meta board-hint artifacts-placeholder">
            Open this section to load workspace paths.
          </p>
        </div>
      </details>

      <section class="create-thread">
        <h2>New thread</h2>
        <p class="meta board-hint">Thread status is the work item state (like a GitHub issue). Board can change it anytime below.</p>
        <div class="form">
          <select v-model="newAgentId" class="input">
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }} ({{ a.role }})</option>
          </select>
          <input v-model="newTitle" type="text" placeholder="Title (optional)" class="input" />
          <select v-model="newThreadStatus" class="input" title="Initial status">
            <option v-for="opt in THREAD_STATUS_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <button type="button" class="btn" :disabled="creating" @click="createThread">
            {{ creating ? "Creating…" : "Create thread" }}
          </button>
        </div>
      </section>

      <section class="threads">
        <div class="threads-header">
          <h2>Threads</h2>
          <label class="filter-label">
            <span class="filter-text">Filter by status</span>
            <select v-model="statusFilter" class="input filter-select" @change="load">
              <option value="">All statuses</option>
              <option v-for="opt in THREAD_STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
        </div>
        <ul class="thread-list">
          <li v-for="t in threads" :key="t.id" class="thread-item">
            <router-link :to="'/threads/' + t.id" class="thread-link">
              <div class="thread-title-line">
                <span class="title">{{ t.title || "Untitled" }}</span>
                <select
                  class="badge-select"
                  :class="'status-' + normalizeThreadStatus(t.status)"
                  :value="normalizeThreadStatus(t.status)"
                  :disabled="statusUpdating[t.id]"
                  aria-label="Thread status"
                  title="Thread status (Board)"
                  @click.stop
                  @mousedown.stop
                  @change="
                    onThreadStatusChange(
                      t.id,
                      ($event.target as HTMLSelectElement).value as ThreadStatus
                    )
                  "
                >
                  <option v-for="opt in THREAD_STATUS_OPTIONS" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
              <span class="meta">by {{ agentName(t.agentId) }} · {{ new Date(t.createdAt).toLocaleString() }}</span>
            </router-link>
          </li>
        </ul>
        <p v-if="!threads.length" class="empty">No threads yet. Create one above.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.project-view {
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
.sub {
  color: var(--muted);
  margin: 0 0 1rem;
  font-size: 0.9rem;
}
.board-goals {
  margin-top: 1.5rem;
}
.board-goals h2 {
  font-size: 1rem;
  margin: 0 0 0.4rem;
}
.goals-help {
  margin: 0 0 0.5rem;
  color: var(--muted);
  font-size: 0.9rem;
}
.goals-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 40rem;
}
.goals-textarea {
  resize: vertical;
  min-height: 6rem;
}
.goals-actions {
  display: flex;
  gap: 0.5rem;
}
.goals-notice {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.board-hint {
  margin: 0 0 0.5rem;
  color: var(--muted);
  font-size: 0.85rem;
}
.artifacts-panel {
  margin-top: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.artifacts-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}
.artifacts-summary::-webkit-details-marker {
  display: none;
}
.artifacts-summary::before {
  content: "";
  display: inline-block;
  width: 0.35em;
  height: 0.35em;
  border-right: 2px solid var(--muted);
  border-bottom: 2px solid var(--muted);
  transform: rotate(-45deg);
  margin-right: 0.5rem;
  transition: transform 0.15s;
  vertical-align: middle;
}
.artifacts-panel[open] .artifacts-summary::before {
  transform: rotate(45deg);
}
.artifacts-summary-title {
  font-size: 1rem;
}
.artifacts-summary-hint {
  font-weight: 400;
  font-size: 0.85rem;
  color: var(--muted);
}
.artifacts-panel-body {
  padding: 0 1rem 1rem;
  border-top: 1px solid var(--border);
}
.artifacts-intro {
  margin-top: 0.75rem;
}
.artifacts-placeholder {
  margin: 0.75rem 0 0;
}
.artifacts-refresh {
  margin-top: 0.75rem;
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
}
.workspace-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.workspace-item {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
.workspace-item:last-child {
  border-bottom: none;
}
.workspace-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.workspace-head .role {
  color: var(--muted);
  font-size: 0.85rem;
}
.workspace-path {
  display: block;
  font-size: 0.8rem;
  word-break: break-all;
  color: var(--muted);
}
.create-thread, .threads {
  margin-top: 1.5rem;
}
.create-thread h2, .threads h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.threads-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.threads-header h2 {
  margin: 0;
}
.filter-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--muted);
}
.filter-text {
  white-space: nowrap;
}
.filter-select {
  min-width: 10rem;
}
.thread-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.65rem;
  margin-bottom: 0.35rem;
}
.thread-title-line .title {
  flex: 1 1 auto;
  min-width: 0;
}
.badge-select {
  appearance: none;
  -webkit-appearance: none;
  padding: 0.22rem 1.45rem 0.22rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  line-height: 1.35;
  cursor: pointer;
  background-color: var(--surface);
  color: var(--muted);
  max-width: 12rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.4rem center;
  background-size: 0.65rem;
}
.badge-select:disabled {
  opacity: 0.65;
  cursor: wait;
}
.badge-select.status-not_started {
  border-color: var(--muted);
  color: var(--muted);
}
.badge-select.status-in_progress {
  border-color: var(--accent);
  color: var(--accent);
}
.badge-select.status-completed {
  border-color: #2e7d32;
  color: #2e7d32;
}
.badge-select.status-blocked {
  border-color: var(--error);
  color: var(--error);
}
.badge-select.status-cancelled {
  opacity: 0.88;
  border-color: var(--muted);
}
.form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 1rem;
}
.input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
}
select.input {
  min-width: 12rem;
}
.btn {
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
.btn-secondary {
  background: var(--surface);
  color: var(--fg);
}
.thread-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.thread-item {
  margin-bottom: 0.5rem;
}
.thread-link {
  display: block;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s;
}
.thread-item .thread-link:hover {
  border-color: var(--accent);
}
.thread-link .thread-title-line .title {
  font-weight: 500;
  display: inline;
}
.thread-link .meta {
  font-size: 0.85rem;
  color: var(--muted);
  margin-top: 0.25rem;
  display: block;
}
.empty {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 0.5rem 0 0;
}
.state.error {
  color: var(--error);
}
</style>
