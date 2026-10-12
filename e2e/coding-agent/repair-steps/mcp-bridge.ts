// 수리 script 통합 테스트의 stdio 통로다. 줄 단위 JSON-RPC를 받아 실제
// lophn_ticket·lophn_problem·lophn_app tool로 core에 보낸다. 제품 MCP 실행
// 파일·실제 keychain·실제 model은 쓰지 않는다. token은 테스트가 메모리로 넘긴다.
import { ok } from "../../../packages/base/mod.ts";
import { createCoreClient } from "../../../packages/coding-agent/connection/client/core.ts";
import { mcpToolResult } from "../../../packages/protocol/coding-agent/mod.ts";
import { connectionIdSchema } from "../../../packages/protocol/coding-agent/mod.ts";
import {
  findTool,
  resolveRoute,
} from "../../../packages/coding-agent/mcp-server/registry.ts";
import { createAppTool } from "../../../packages/coding-agent/mcp-server/tools/app.ts";
import { createProblemTool } from "../../../packages/coding-agent/mcp-server/tools/problem.ts";
import { createTicketTool } from "../../../packages/coding-agent/mcp-server/tools/ticket.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ToolOutput = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

if (import.meta.main) {
  const token = Deno.env.get("LOPHN_TEST_TOKEN");
  const daemon = Deno.env.get("LOPHN_TEST_DAEMON");
  const connectionText = Deno.env.get("LOPHN_TEST_CONNECTION");
  if (!token || !daemon || !connectionText) {
    Deno.exit(1);
  }
  const connection = connectionIdSchema.parse(connectionText);
  const provider = () => Promise.resolve(ok({ token }));
  const client = createCoreClient({
    baseUrl: daemon,
    connection,
    provider,
  });
  const now = () => new Date().toISOString();
  const idempotencyKey = () => `bridge-${crypto.randomUUID()}`;
  const ticket = createTicketTool({ client, now, idempotencyKey });
  const problem = createProblemTool({
    client,
    now,
    idempotencyKey,
    connection,
    wait: { budget_ms: 0, interval_ms: 1 },
  });
  const app = createAppTool({
    client,
    idempotencyKey,
    wait: { budget_ms: 0, interval_ms: 1 },
  });
  const runners: Record<
    string,
    (route: Parameters<typeof ticket>[1], input: unknown) => Promise<ToolOutput>
  > = {
    lophn_ticket: (route, input) => ticket("lophn_ticket", route, input),
    lophn_problem: (route, input) => problem("lophn_problem", route, input),
    lophn_app: (route, input) => app("lophn_app", route, input),
  };

  const writeLine = (value: unknown) =>
    Deno.stdout.write(encoder.encode(JSON.stringify(value) + "\n"));

  const reply = async (id: unknown, output: ToolOutput) => {
    const summary = output.summary === "" ? "빈 응답" : output.summary;
    await writeLine({
      jsonrpc: "2.0",
      id,
      result: mcpToolResult(
        {
          summary,
          data: output.data,
          next: output.next.length === 0 ? ["next"] : output.next,
        },
        output.isError === true,
      ),
    });
  };

  const fail = (id: unknown, summary: string, code: string) =>
    reply(id, {
      summary,
      data: { code, details: {} },
      next: ["tool 입력을 고친다"],
      isError: true,
    });

  let pending = "";
  for await (const chunk of Deno.stdin.readable) {
    pending += decoder.decode(chunk, { stream: true });
    while (true) {
      const index = pending.indexOf("\n");
      if (index < 0) break;
      const text = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (text.trim() === "") continue;
      let request: {
        id?: unknown;
        method?: string;
        params?: { name?: string; arguments?: unknown };
      };
      try {
        request = JSON.parse(text) as typeof request;
      } catch {
        continue;
      }
      if (request.method === "initialize") {
        await writeLine({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            serverInfo: { name: "lophn-repair-bridge", version: "0" },
          },
        });
        continue;
      }
      if (request.method !== "tools/call") {
        await writeLine({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "method not found" },
        });
        continue;
      }
      try {
        const name = request.params?.name ?? "";
        const args = request.params?.arguments ?? {};
        const tool = findTool(name);
        const op = typeof (args as { op?: unknown }).op === "string"
          ? (args as { op: string }).op
          : undefined;
        if (!tool) {
          await fail(request.id, "없는 tool이다", "invalid_input");
          continue;
        }
        const parsed = tool.input.safeParse(args);
        if (!parsed.success) {
          await fail(
            request.id,
            "입력이 tool schema와 맞지 않는다",
            "invalid_input",
          );
          continue;
        }
        const resolved = resolveRoute(name, op);
        const run = runners[name];
        if (!resolved || !run) {
          await fail(request.id, "없는 op다", "invalid_input");
          continue;
        }
        await reply(request.id, await run(resolved.route, parsed.data));
      } catch (error) {
        const message = error instanceof Error ? error.message : "bridge error";
        await fail(request.id, message, "internal");
      }
    }
  }
}
