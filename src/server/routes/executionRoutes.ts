import { Router } from "express";

export function createExecutionRouter(
  executionService: any,
  mcpService: any,
  codeIntelligence: any
): Router {
  const router = Router();

  router.get("/status", async (_req, res) => {
    try {
      res.json(await executionService.status());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/capabilities", async (_req, res) => {
    try {
      res.json(await executionService.getCapabilities());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/inspect", async (req, res) => {
    try {
      const { projectPath, operation, params } = req.body || {};
      if (!projectPath || !operation) {
        return res.status(400).json({ error: "projectPath and operation are required" });
      }
      const result = await executionService.inspect({ mode: "INSPECT", projectPath, operation, params: params || {} });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/execute", async (req, res) => {
    try {
      const { projectPath, operation, params } = req.body || {};
      if (!projectPath || !operation) {
        return res.status(400).json({ error: "projectPath and operation are required" });
      }
      const result = await executionService.execute({ mode: "EXECUTE", projectPath, operation, params: params || {} });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/:taskId/cancel", async (req, res) => {
    try {
      await executionService.cancel(req.params.taskId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sessions", (_req, res) => {
    res.json(executionService.listSessionMappings());
  });

  router.get("/mcp/servers", async (_req, res) => {
    try {
      res.json(await mcpService.listServers());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/mcp/add", async (req, res) => {
    try {
      const { name, command, args, env, transport, url } = req.body || {};
      if (!name || (!command && transport !== "sse")) {
        return res.status(400).json({ error: "name and command (or sse url) are required" });
      }
      await mcpService.addServer({ name, command: command || "", args, env, transport, url });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/mcp/tools", async (_req, res) => {
    try {
      res.json(await mcpService.listTools());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/lsp", async (_req, res) => {
    try {
      res.json(await codeIntelligence.getLspStatus());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
