import { assertEquals } from "@std/assert";

import type {
  Agent,
  ConversationSource,
  MessageRow,
  SessionRow,
  SourceResult,
} from "../../conversation/source.ts";
import { startContextEngineerSession } from "./context-engineer-conversation.ts";

const AGENT: Agent = {
  id: "agt_ce",
  state: "enabled",
  revision: 1,
  role: "context_engineer",
};

function fake(options: { agent?: Agent } = {}) {
  const sessions: SessionRow[] = [];
  const messages = new Map<string, MessageRow[]>();
  const opened: { id: string; project: string }[] = [];
  const source = {
    agent: () =>
      Promise.resolve<SourceResult<Agent | null>>({
        ok: true,
        value: options.agent ?? AGENT,
      }),
    sessions: () =>
      Promise.resolve({ ok: true as const, value: [...sessions] }),
    messages: (session: string) =>
      Promise.resolve({
        ok: true as const,
        value: messages.get(session) ?? [],
      }),
    openSession: async (
      input: { id: string; agent: Agent; workPlace: { id: string | null } },
    ) => {
      await Promise.resolve();
      const row: SessionRow = { id: input.id, state: "open", stateSeq: "1" };
      sessions.push(row);
      opened.push({ id: input.id, project: String(input.workPlace.id) });
      return { ok: true as const, value: row };
    },
  } as unknown as ConversationSource;
  const selected: string[] = [];
  const drafts = { select: (id: string) => selected.push(id) };
  return { source, drafts, sessions, messages, opened, selected };
}

const start = (
  f: ReturnType<typeof fake>,
  project = "prj_a",
  at = 1_000,
) => startContextEngineerSession(f.source, f.drafts, project, () => at);

Deno.test("shell/workspace#R30 [ctx-T10c]: [New context]를 두 번 눌러도 비어 있는 세션이 있으면 새로 열지 않고 그 세션을 고른다", async () => {
  const f = fake();
  assertEquals(await start(f), true);
  assertEquals(await start(f, "prj_a", 2_000), true);
  assertEquals(f.opened.length, 1);
  assertEquals(f.selected, [f.opened[0]!.id, f.opened[0]!.id]);
});

Deno.test("shell/workspace#R30 [ctx-T10c]: 연달아 눌러 앞 세션이 열리는 중이어도 세션은 하나다", async () => {
  const f = fake();
  const both = await Promise.all([start(f), start(f, "prj_a", 2_000)]);
  assertEquals(both, [true, true]);
  assertEquals(f.opened.length, 1);
  assertEquals(f.selected.length, 2);
  assertEquals(new Set(f.selected).size, 1);
});

Deno.test("shell/workspace#R30 [ctx-T10c]: 앞 세션에 말이 오갔거나 닫혔거나 다른 프로젝트면 새 세션을 연다", async () => {
  const f = fake();
  await start(f);
  f.messages.set(f.opened[0]!.id, [{} as MessageRow]);
  await start(f, "prj_a", 2_000);
  assertEquals(f.opened.length, 2);
  f.sessions[1] = { ...f.sessions[1]!, state: "closed" };
  await start(f, "prj_a", 3_000);
  assertEquals(f.opened.length, 3);
  await start(f, "prj_b", 4_000);
  assertEquals(f.opened.map((item) => item.project), [
    "prj_a",
    "prj_a",
    "prj_a",
    "prj_b",
  ]);
});

Deno.test("shell/workspace#R30 [ctx-T10c]: 회수된 담당이면 세션을 열지 않고 false다", async () => {
  const f = fake({ agent: { ...AGENT, state: "withdrawn" } });
  assertEquals(await start(f), false);
  assertEquals(f.opened.length, 0);
});
