<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api, type Project, type Thread, type Agent } from "../api";

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
  });

  await api.postMessage(created.id, {
    actorType: "board",
    actorName: "Board of Directors",
    content: `Project goals:\n\n${goals}`,
  });

  return true;
}

async function load() {
  if (!projectId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const [p, t, a] = await Promise.all([
      api.getProject(projectId.value),
      api.getProjectThreads(projectId.value),
      api.getAgents(),
    ]);
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
        threads.value = await api.getProjectThreads(projectId.value);
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

      <section class="create-thread">
        <h2>New thread</h2>
        <div class="form">
          <select v-model="newAgentId" class="input">
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }} ({{ a.role }})</option>
          </select>
          <input v-model="newTitle" type="text" placeholder="Title (optional)" class="input" />
          <button type="button" class="btn" :disabled="creating" @click="createThread">
            {{ creating ? "Creating…" : "Create thread" }}
          </button>
        </div>
      </section>

      <section class="threads">
        <h2>Threads</h2>
        <ul class="thread-list">
          <li v-for="t in threads" :key="t.id" class="thread-item">
            <router-link :to="'/threads/' + t.id" class="thread-link">
              <span class="title">{{ t.title || "Untitled" }}</span>
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
.create-thread, .threads {
  margin-top: 1.5rem;
}
.create-thread h2, .threads h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
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
.thread-link:hover {
  border-color: var(--accent);
}
.thread-link .title {
  font-weight: 500;
  display: block;
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
