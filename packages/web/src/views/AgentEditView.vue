<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type Agent } from "../api";

const route = useRoute();
const router = useRouter();
const agentId = computed(() => route.params.id as string);

const agent = ref<Agent | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const name = ref("");
const role = ref("");
const awakeEnabled = ref(true);
const awakeIntervalMinutes = ref(30);

async function load() {
  if (!agentId.value) return;
  loading.value = true;
  error.value = null;
  try {
    agent.value = await api.getAgent(agentId.value);
    name.value = agent.value.name;
    role.value = agent.value.role;
    awakeEnabled.value = agent.value.awakeEnabled;
    awakeIntervalMinutes.value = agent.value.awakeIntervalMinutes;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load agent";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!agentId.value) return;
  saving.value = true;
  error.value = null;
  try {
    const normalizedAwakeInterval = Math.max(3, Math.floor(Number(awakeIntervalMinutes.value) || 0));
    awakeIntervalMinutes.value = normalizedAwakeInterval;
    await api.updateAgent(agentId.value, {
      name: name.value.trim(),
      role: role.value.trim(),
      awakeEnabled: awakeEnabled.value,
      awakeIntervalMinutes: normalizedAwakeInterval,
    });
    await router.push({ name: "agents" });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save agent";
  } finally {
    saving.value = false;
  }
}

function back() {
  router.push({ name: "agents" });
}

onMounted(load);
</script>

<template>
  <div class="agent-edit-view">
    <h1>Edit agent</h1>
    <p class="sub">Changes are saved to the backend and written to the agent home on disk (AGENTS.md, MCP, skills). Orchestrated runs prepare each project workspace with AGENTS.md symlink + local MCP/skills copies for the Cursor CLI.</p>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else-if="agent">
      <form class="form" @submit.prevent="save">
        <div class="field">
          <label for="agent-name">Name</label>
          <input id="agent-name" v-model="name" type="text" required />
        </div>
        <div class="field">
          <label for="agent-role">Role</label>
          <input id="agent-role" v-model="role" type="text" required placeholder="e.g. CEO, CTO, Engineer" />
        </div>
        <div class="field">
          <label class="checkbox" for="agent-awake-enabled">
            <input id="agent-awake-enabled" v-model="awakeEnabled" type="checkbox" />
            <span>Awake scheduler enabled</span>
          </label>
          <p class="hint">When enabled, this agent can be picked up by background awake cycles.</p>
        </div>
        <div class="field">
          <label for="agent-awake-interval">Awake interval (minutes)</label>
          <input
            id="agent-awake-interval"
            v-model.number="awakeIntervalMinutes"
            type="number"
            min="3"
            step="1"
            required
          />
          <p class="hint">Minimum 3 minutes. This controls how often the scheduler wakes this agent.</p>
        </div>
        <div class="field">
          <label for="agent-last-awake">Last awake at</label>
          <input
            id="agent-last-awake"
            :value="agent.lastAwakeAt ? new Date(agent.lastAwakeAt).toLocaleString() : 'Never'"
            type="text"
            readonly
          />
        </div>
        <div class="field">
          <label for="agent-next-awake">Next awake at</label>
          <input
            id="agent-next-awake"
            :value="agent.nextAwakeAt ? new Date(agent.nextAwakeAt).toLocaleString() : 'Not scheduled'"
            type="text"
            readonly
          />
        </div>
        <div class="field">
          <label for="agent-config-path">Config pointer (DB `agents.config`)</label>
          <input id="agent-config-path" :value="agent.config ?? ''" type="text" readonly />
        </div>
        <div class="field">
          <label for="agent-config-display">AGENTS.md content (display)</label>
          <textarea
            id="agent-config-display"
            :value="agent.configDisplay ?? ''"
            rows="16"
            readonly
          />
        </div>
        <div class="meta">
          <code class="id">ID: {{ agent.id }}</code>
        </div>
        <div class="actions">
          <button type="button" class="btn secondary" @click="back">Back</button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? "Saving…" : "Save" }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.agent-edit-view {
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
.form {
  max-width: 36rem;
}
.field {
  margin-bottom: 1rem;
}
.field label {
  display: block;
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 0.35rem;
}
.checkbox {
  display: inline-flex !important;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.15rem;
}
.checkbox input {
  width: auto;
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}
.field input,
.field textarea {
  width: 100%;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  font-family: inherit;
}
.field textarea {
  resize: vertical;
  min-height: 8rem;
}
.meta {
  margin-bottom: 1rem;
}
.id {
  font-size: 0.75rem;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 0.5rem;
}
.btn {
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
}
.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.btn.secondary:hover:not(:disabled) {
  border-color: var(--accent);
}
.btn.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.btn.primary:hover:not(:disabled) {
  filter: brightness(1.05);
}
</style>
