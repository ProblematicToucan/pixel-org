import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("../views/HomeView.vue"), meta: { title: "Pixel Org" } },
    { path: "/agents", name: "agents", component: () => import("../views/AgentsView.vue"), meta: { title: "Agents" } },
    {
      path: "/agents/:id",
      name: "agent-edit",
      component: () => import("../views/AgentEditView.vue"),
      meta: { title: "Edit agent" },
    },
    { path: "/projects", name: "projects", component: () => import("../views/ProjectsView.vue"), meta: { title: "Projects" } },
    {
      path: "/projects/:id",
      name: "project",
      component: () => import("../views/ProjectView.vue"),
      meta: { title: "Project" },
    },
    {
      path: "/threads/:id",
      name: "thread",
      component: () => import("../views/ThreadView.vue"),
      meta: { title: "Thread" },
    },
  ],
});

router.afterEach((to) => {
  const title = (to.meta?.title as string) ?? "Pixel Org";
  document.title = to.meta?.title ? `${title} · Pixel Org` : "Pixel Org";
});

export default router;
