<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api, type Agent, type VisibleAgentWork } from "../api";

const agents = ref<Agent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const visibleWorkAgentId = ref<string | null>(null);
const visibleWork = ref<VisibleAgentWork[] | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    agents.value = await api.getAgents();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load agents";
  } finally {
    loading.value = false;
  }
}

async function loadVisibleWork(id: string) {
  visibleWorkAgentId.value = id;
  visibleWork.value = null;
  try {
    visibleWork.value = await api.getAgentVisibleWork(id);
  } catch (e) {
    visibleWork.value = [];
  }
}

function clearVisibleWork() {
  visibleWorkAgentId.value = null;
  visibleWork.value = null;
}

onMounted(load);
</script>

<template>
  <div class="agents-view">
    <h1>Agents</h1>
    <p class="sub">Participants: leads and members. Leads can see reports’ work and recruit.</p>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else>
      <ul class="agent-list">
        <li v-for="a in agents" :key="a.id" class="agent-item">
          <div class="agent-head">
            <span class="name">{{ a.name }}</span>
            <span class="role">{{ a.role }}</span>
            <span v-if="a.isLead" class="badge lead">Lead</span>
          </div>
          <div class="agent-meta">
            <code class="id">{{ a.id }}</code>
          </div>
          <div class="agent-actions">
            <router-link :to="{ name: 'agent-edit', params: { id: a.id } }" class="btn small">
              Edit
            </router-link>
            <button
              v-if="a.isLead"
              type="button"
              class="btn small"
              :class="{ active: visibleWorkAgentId === a.id }"
              @click="visibleWorkAgentId === a.id ? clearVisibleWork() : loadVisibleWork(a.id)"
            >
              {{ visibleWorkAgentId === a.id ? "Hide" : "Visible work" }}
            </button>
          </div>
        </li>
      </ul>

      <section v-if="visibleWork !== null" class="visible-work">
        <h2>Visible work</h2>
        <ul class="work-list">
          <li v-for="w in visibleWork" :key="w.agentId" class="work-item">
            <strong>{{ w.name }}</strong> ({{ w.role }}) — {{ w.projects.length }} project(s)
            <ul v-if="w.projects.length" class="projects">
              <li v-for="p in w.projects" :key="p.projectId">
                <div class="project-line">
                  <template v-if="p.linkedProject">
                    <router-link
                      :to="{ name: 'project', params: { id: p.linkedProject.id } }"
                      class="project-link"
                    >
                      {{ p.linkedProject.name }}
                    </router-link>
                    <span class="meta">
                      <code>{{ p.linkedProject.slug }}</code>
                    </span>
                  </template>
                  <template v-else>
                    <span class="unlinked-label">Folder</span>
                    <code>{{ p.projectId }}</code>
                    <span class="meta unlinked-hint">(no matching DB project)</span>
                  </template>
                </div>
                <div class="project-path">{{ p.projectPath }}</div>
              </li>
            </ul>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.agents-view {
  padding: 0.5rem 0;
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
.state {
  padding: 1rem;
  color: var(--muted);
}
.state.error {
  color: var(--error);
}
.agent-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
}
.agent-item {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  background: var(--surface);
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.name {
  font-weight: 600;
}
.role {
  color: var(--muted);
  font-size: 0.9rem;
}
.badge.lead {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  background: linear-gradient(135deg, #a855f7 0%, #3b82f6 100%);
  color: #ffffff;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 1px 6px rgba(59, 130, 246, 0.28);
}
.agent-meta {
  margin-top: 0.35rem;
}
.id {
  font-size: 0.75rem;
  color: var(--muted);
}
.agent-actions {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.agent-actions a.btn {
  text-decoration: none;
  display: inline-block;
}
.btn {
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
}
.btn.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}
.visible-work {
  margin-top: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.visible-work h2 {
  font-size: 1rem;
  margin: 0 0 0.75rem;
}
.work-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.work-item {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
.work-item:last-child {
  border-bottom: none;
}
.projects {
  margin: 0.35rem 0 0 1rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.projects code {
  word-break: break-all;
}
.project-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
}
.project-link {
  font-weight: 600;
  color: var(--accent, #0a7ea4);
  text-decoration: none;
}
.project-link:hover {
  text-decoration: underline;
}
.project-line .meta {
  color: var(--muted);
  font-size: 0.85rem;
}
.unlinked-label {
  color: var(--muted);
  font-size: 0.85rem;
}
.unlinked-hint {
  font-style: italic;
}
.project-path {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: var(--muted);
  word-break: break-all;
}
</style>
