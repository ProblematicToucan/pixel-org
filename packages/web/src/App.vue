<script setup lang="ts">
import { RouterView } from "vue-router";
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
</style>
