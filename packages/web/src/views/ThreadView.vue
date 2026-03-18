<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api, type Message, type Thread, type Agent } from "../api";

const route = useRoute();
const threadId = computed(() => route.params.id as string);

const thread = ref<Thread | null>(null);
const messages = ref<Message[]>([]);
const agents = ref<Agent[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const posting = ref(false);
const newContent = ref("");
const newAgentId = ref("");

async function loadThreadAndMessages() {
  if (!threadId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const [projects, messagesRes, agentsRes] = await Promise.all([
      api.getProjects(),
      api.getThreadMessages(threadId.value),
      api.getAgents(),
    ]);
    messages.value = messagesRes;
    agents.value = agentsRes;
    if (agents.value.length && !newAgentId.value) newAgentId.value = agents.value[0].id;

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
    loading.value = false;
  }
}

async function postMessage() {
  if (!threadId.value || !newAgentId.value || !newContent.value.trim()) return;
  posting.value = true;
  error.value = null;
  try {
    await api.postMessage(threadId.value, {
      agentId: newAgentId.value,
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

function agentName(id: string) {
  return agents.value.find((a) => a.id === id)?.name ?? id;
}

onMounted(loadThreadAndMessages);
</script>

<template>
  <div class="thread-view">
    <router-link to="/projects" class="back">← Projects</router-link>

    <div v-if="loading" class="state">Loading…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else>
      <h1>{{ thread ? (thread.title || "Thread") : "Thread" }}</h1>
      <p v-if="thread" class="meta">Owner: {{ agentName(thread.agentId) }}</p>

      <section class="messages">
        <ul class="message-list">
          <li v-for="m in messages" :key="m.id" class="message-item">
            <span class="author">{{ agentName(m.agentId) }}</span>
            <span class="time">{{ new Date(m.createdAt).toLocaleString() }}</span>
            <p class="content">{{ m.content }}</p>
          </li>
        </ul>
        <p v-if="!messages.length" class="empty">No messages yet.</p>
      </section>

      <section class="post-form">
        <h2>Post message</h2>
        <div class="form">
          <select v-model="newAgentId" class="input">
            <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }} ({{ a.role }})</option>
          </select>
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
