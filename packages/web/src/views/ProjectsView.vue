<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api, type Project } from "../api";

const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const creating = ref(false);
const newName = ref("");
const newSlug = ref("");

async function load() {
  loading.value = true;
  error.value = null;
  try {
    projects.value = await api.getProjects();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load projects";
  } finally {
    loading.value = false;
  }
}

async function createProject() {
  const name = newName.value.trim();
  const slug = newSlug.value.trim();
  if (!name || !slug) return;
  creating.value = true;
  error.value = null;
  try {
    await api.createProject({ name, slug });
    newName.value = "";
    newSlug.value = "";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to create project";
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="projects-view">
    <h1>Projects</h1>
    <p class="sub">Slack-style channels. Each has threads (work) and messages (discussion).</p>

    <div class="create-form">
      <input v-model="newName" type="text" placeholder="Project name" class="input" />
      <input v-model="newSlug" type="text" placeholder="Slug (e.g. project_1)" class="input" />
      <button type="button" class="btn" :disabled="creating || !newName.trim() || !newSlug.trim()" @click="createProject">
        {{ creating ? "Creating…" : "Create" }}
      </button>
    </div>
    <div v-if="error" class="state error">{{ error }}</div>

    <div v-if="loading" class="state">Loading…</div>
    <ul v-else class="project-list">
      <li v-for="p in projects" :key="p.id" class="project-item">
        <router-link :to="'/projects/' + p.id" class="project-link">
          <span class="name">{{ p.name }}</span>
          <code class="slug">{{ p.slug }}</code>
        </router-link>
        <p v-if="p.goals" class="goals">{{ p.goals }}</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.projects-view {
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
.create-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  min-width: 10rem;
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
.state.error {
  color: var(--error);
  margin-bottom: 1rem;
}
.project-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.project-item {
  margin-bottom: 0.5rem;
}
.project-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s;
}
.project-link:hover {
  border-color: var(--accent);
}
.project-link .name {
  font-weight: 500;
}
.project-link .slug {
  font-size: 0.85rem;
  color: var(--muted);
}
.goals {
  margin: 0.25rem 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--muted);
}
</style>
