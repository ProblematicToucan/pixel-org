#!/usr/bin/env node

import { spawn } from "node:child_process";

const services = [
  { name: "backend", color: "\x1b[36m", args: ["--filter", "@pixel-org/backend", "dev"] },
  { name: "agent-runner", color: "\x1b[35m", args: ["--filter", "@pixel-org/agent-runner", "dev"] },
  { name: "web", color: "\x1b[32m", args: ["--filter", "@pixel-org/web", "dev"] },
  { name: "pixel-mcp-server", color: "\x1b[33m", args: ["--filter", "@pixel-org/pixel-mcp-server", "dev"] },
];

const RESET = "\x1b[0m";
const children = [];
let shuttingDown = false;
let completed = 0;
let exitCode = 0;

function prefixLine(name, color, line) {
  return `${color}[${name}]${RESET} ${line}`;
}

function sanitizeOutput(text) {
  // Remove clear-screen and terminal reset control sequences from watch tools.
  return text
    .replace(/\x1b\[[0-9;]*[HJK]/g, "")
    .replace(/\x1bc/g, "")
    .replace(/\r/g, "\n");
}

function pipeOutput(child, service) {
  let pending = "";

  const writeChunk = (stream, chunk) => {
    const text = pending + sanitizeOutput(chunk.toString());
    const lines = text.split("\n");
    const last = lines.pop() ?? "";
    for (const line of lines) {
      stream.write(prefixLine(service.name, service.color, line) + "\n");
    }
    pending = last;
  };

  child.stdout?.on("data", (chunk) => writeChunk(process.stdout, chunk));
  child.stderr?.on("data", (chunk) => writeChunk(process.stderr, chunk));
  child.on("close", () => {
    if (pending.length > 0) {
      process.stdout.write(prefixLine(service.name, service.color, pending) + "\n");
      pending = "";
    }
  });
}

function killProcessTree(child, signal) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

function shutdown(signal = "SIGTERM", code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;

  for (const child of children) {
    killProcessTree(child.process, signal);
  }

  setTimeout(() => {
    for (const child of children) {
      killProcessTree(child.process, "SIGKILL");
    }
  }, 1500).unref();
}

for (const service of services) {
  const child = spawn("pnpm", service.args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: process.env,
  });

  children.push({ service, process: child });
  pipeOutput(child, service);

  child.on("exit", (code, signal) => {
    completed += 1;

    if (!shuttingDown) {
      if (signal || (code ?? 0) !== 0) {
        const reason = signal
          ? `stopped by signal ${signal}`
          : `exited with code ${code ?? 1}`;
        process.stderr.write(prefixLine(service.name, service.color, reason) + "\n");
        shutdown("SIGTERM", code ?? 1);
      }
    }

    if (completed === services.length) {
      process.exit(exitCode);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGHUP", () => shutdown("SIGTERM", 0));
