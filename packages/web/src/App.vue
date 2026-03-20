<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { api, type ActiveAgentRun } from "./api";

const activeRuns = ref<ActiveAgentRun[]>([]);
const loadingRuns = ref(false);
const runsError = ref<string | null>(null);
const panelOpen = ref(false);
let pollTimer: number | null = null;

const hasActiveRuns = computed(() => activeRuns.value.length > 0);
const floatingLabel = computed(() => {
  if (loadingRuns.value && !hasActiveRuns.value) return "Checking agents...";
  return hasActiveRuns.value
    ? `${activeRuns.value.length} agent run${activeRuns.value.length === 1 ? "" : "s"} active`
    : "No active agent runs";
});

async function refreshActiveRuns() {
  loadingRuns.value = true;
  try {
    const runs = await api.getActiveRuns();
    activeRuns.value = runs;
    runsError.value = null;
  } catch (err) {
    runsError.value = err instanceof Error ? err.message : "Failed to fetch active runs";
  } finally {
    loadingRuns.value = false;
  }
}

function runLocationLabel(run: ActiveAgentRun) {
  const thread = run.threadTitle?.trim() ? run.threadTitle : "Untitled thread";
  return `${run.projectName} / ${thread}`;
}

onMounted(async () => {
  await refreshActiveRuns();
  pollTimer = window.setInterval(() => {
    void refreshActiveRuns();
  }, 5000);
});

onUnmounted(() => {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
  }
});
</script>

<template>
  <div class="app">
    <nav class="nav">
      <router-link to="/" class="brand">Pixel Org</router-link>
      <router-link to="/agents">Agents</router-link>
      <router-link to="/projects">Projects</router-link>
    </nav>
    <main class="main">
      <RouterView />
    </main>
    <section
      class="floating-runs"
      :class="{ active: hasActiveRuns, open: panelOpen }"
      aria-live="polite"
    >
      <button class="floating-toggle" type="button" @click="panelOpen = !panelOpen">
        <span class="dot" :class="{ pulse: hasActiveRuns }" />
        <span>{{ floatingLabel }}</span>
      </button>
      <div v-if="panelOpen" class="floating-panel">
        <p v-if="runsError" class="error">{{ runsError }}</p>
        <p v-else-if="!activeRuns.length" class="empty">Background orchestration is idle.</p>
        <ul v-else class="run-list">
          <li v-for="run in activeRuns" :key="run.id" class="run-item">
            <div class="run-head">
              <strong>{{ run.status.toUpperCase() }}</strong>
              <code>{{ run.reason }}</code>
            </div>
            <div class="run-meta">
              <span>Agent: {{ run.agentName }}<template v-if="run.agentRole"> ({{ run.agentRole }})</template></span>
              <span>Working on: {{ runLocationLabel(run) }}</span>
            </div>
            <div class="run-links">
              <RouterLink :to="`/threads/${run.threadId}`">Open thread</RouterLink>
              <RouterLink :to="`/projects/${run.projectId}`">Open project</RouterLink>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
}
.nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.nav a {
  color: var(--muted);
  text-decoration: none;
  font-weight: 500;
}
.nav a:hover,
.nav a.router-link-active {
  color: var(--fg);
}
.brand {
  font-weight: 700;
  margin-right: 0.5rem;
}
.main {
  flex: 1;
  padding: 1.5rem;
  max-width: 56rem;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
.floating-runs {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  width: min(26rem, calc(100vw - 2rem));
  z-index: 40;
}
.floating-toggle {
  width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--fg);
  padding: 0.55rem 0.9rem;
  font-size: 0.92rem;
  cursor: pointer;
}
.floating-runs.active .floating-toggle {
  border-color: var(--accent);
}
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--muted);
}
.dot.pulse {
  background: #22c55e;
  box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.65);
  animation: pulse 1.2s infinite;
}
.floating-panel {
  margin-top: 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 0.75rem;
  max-height: 40vh;
  overflow: auto;
}
.run-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.run-item {
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
}
.run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.run-meta {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 0.84rem;
}
.run-links {
  margin-top: 0.45rem;
  display: flex;
  gap: 0.8rem;
}
.run-links a {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.84rem;
}
.run-links a:hover {
  text-decoration: underline;
}
.empty {
  margin: 0;
  color: var(--muted);
}
.error {
  margin: 0;
  color: var(--error);
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.65);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(34, 197, 94, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
  }
}
</style>
