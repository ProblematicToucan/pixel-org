# @pixel-org/agent-runner

Invokes agent CLIs (Cursor CLI, Claude Code, etc.) from the orchestrator. Sets `PIXEL_AGENT_ROLE` so the agent can follow [AGENTS.md](../../AGENTS.md) at repo root.

- **Orchestrator** (e.g. backend): decides which agent, role, and task; calls `runAgent()`.
- **This package**: spawns the CLI with the right env and task; returns stdout/stderr/exit code.

CLI command shapes in `runAgent.ts` are placeholders; update `getCliInvocation()` for the real Cursor/Claude CLI flags and usage.
