import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  type McpToolServer,
  mcpToolsList,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthDeadline } from "./mod.ts";

// Grants 화면의 MCP tool 목록 요청 대기열이다. MCP 연결은 agent runtime의 몫이고 core에는 외부 연결이 없어서
// `list`가 요청을 놓고, runtime이 `request-take`로 가져가 서버를 읽은 뒤 `request-done`으로 답하면 `list`가 깨어난다
// (issuer-requests.ts와 같은 길).
// - 대기열은 작업 메모리다: ledger·event·log에 쓰지 않는다.
// - 기한 안에 답이 없으면(runtime이 없거나 서버가 느리면) unavailable이고 요청은 대기열에서 빠진다. 늦은 답은 받지 않는다.

const MCP_TOOLS_WAIT_MS = 15_000;

type Entry = {
  request: { id: string; place: AgentPlace | null; agent: string | null };
  taken: boolean;
  settle(servers: McpToolServer[]): void;
};

type Handler = (ctx: unknown, input: unknown) => Promise<Result<unknown>>;

const invalid = () =>
  err({ code: "invalid_input" as const, message: "입력이 올바르지 않다" });

export function createMcpToolRequests(options: {
  newId(): string;
  waitMs?: number;
  deadline?: AuthDeadline;
}): { handlers: ReadonlyMap<string, Handler> } {
  const waitMs = options.waitMs ?? MCP_TOOLS_WAIT_MS;
  const entries = new Map<string, Entry>();

  const deadline: AuthDeadline = options.deadline ??
    ((ms, signal) =>
      new Promise((resolve) => {
        if (signal.aborted) return resolve("aborted");
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve("elapsed");
        }, ms);
        function onAbort() {
          clearTimeout(timer);
          resolve("aborted");
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }));

  const listHandler: Handler = (_ctx, input) => {
    const parsed = mcpToolsList.input.safeParse(input);
    if (!parsed.success) return Promise.resolve(invalid());
    const id = options.newId();
    return new Promise((resolve) => {
      const stop = new AbortController();
      entries.set(id, {
        request: { id, place: parsed.data.place, agent: parsed.data.agent },
        taken: false,
        settle: (servers) => {
          stop.abort();
          resolve(ok({ servers }));
        },
      });
      void deadline(waitMs, stop.signal).then((how) => {
        if (how !== "elapsed") return;
        if (entries.delete(id)) {
          resolve(err({
            code: "unavailable",
            message: "MCP tool 목록을 기한 안에 읽지 못했다",
          }));
        }
      });
    });
  };

  const takeHandler: Handler = (_ctx, input) => {
    if (!mcpToolsRequestTake.input.safeParse(input).success) {
      return Promise.resolve(invalid());
    }
    for (const entry of entries.values()) {
      if (entry.taken) continue;
      entry.taken = true;
      return Promise.resolve(ok({ request: entry.request }));
    }
    return Promise.resolve(ok({ request: null }));
  };

  const doneHandler: Handler = (_ctx, input) => {
    const parsed = mcpToolsRequestDone.input.safeParse(input);
    if (!parsed.success) return Promise.resolve(invalid());
    const entry = entries.get(parsed.data.id);
    if (entry === undefined) return Promise.resolve(ok({ accepted: false }));
    // 응답 모양은 부르는 쪽 output schema로도 맞아야 한다.
    const servers = mcpToolsList.output.safeParse({
      servers: parsed.data.servers,
    });
    if (!servers.success) return Promise.resolve(invalid());
    entries.delete(parsed.data.id);
    entry.settle(servers.data.servers);
    return Promise.resolve(ok({ accepted: true }));
  };

  const key = (route: { resource: string; method: string }) =>
    `${route.resource}/${route.method}`;
  return {
    handlers: new Map([
      [key(mcpToolsList), listHandler],
      [key(mcpToolsRequestTake), takeHandler],
      [key(mcpToolsRequestDone), doneHandler],
    ]),
  };
}
