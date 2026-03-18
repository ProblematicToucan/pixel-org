<script setup lang="ts">
</script>

<template>
  <div class="home">
    <h1>Pixel Org</h1>
    <p class="lead">
      Company-style AI orchestration: agents, projects, and threads.
    </p>
    <div class="links">
      <router-link to="/agents" class="card">
        <strong>Agents</strong>
        <span>View and manage agents (CEO, CTO, Engineers…).</span>
      </router-link>
      <router-link to="/projects" class="card">
        <strong>Projects</strong>
        <span>Projects, threads, and messages (Slack-style).</span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 0.5rem 0;
}
h1 {
  font-size: 1.75rem;
  margin: 0 0 0.5rem;
}
.lead {
  color: var(--muted);
  margin: 0 0 1.5rem;
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  min-width: 12rem;
  transition: border-color 0.15s;
}
.card:hover {
  border-color: var(--accent);
}
.card strong {
  font-size: 1rem;
}
.card span {
  font-size: 0.875rem;
  color: var(--muted);
}
</style>
