/**
 * Entry point for the Pixel MCP server.
 * Run with: node dist/main.js [--stdio]
 * Or: tsx main.ts [--stdio]
 *
 * Default: stdio (for use from agent mcp.json).
 * With --http: Streamable HTTP on PORT (default 3001) for testing with basic-host.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { createServer } from "./server.js";

async function startStreamableHTTPServer(
  createMcpServer: () => McpServer
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const app = createMcpExpressApp({ host });
  app.use(cors());
  app.use(express.json());

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`Pixel MCP server (HTTP) at http://${host}:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(createMcpServer: () => McpServer): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--http")) {
    await startStreamableHTTPServer(createServer);
  } else {
    await startStdioServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
