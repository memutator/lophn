import { assert, assertEquals } from "@std/assert";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { agentGrantsGetRead } from "./reads.ts";

// agent가 남의 grant를 읽으면 안 된다는 권한 경계 시험이다. sessions 행만 흉내 낸 가짜 snapshot을 쓴다.
const MINE = "app_0000000000000000000000000a";
const OTHER = "app_0000000000000000000000000b";

function read(actor: string, agent: AgentRef) {
  const snapshot = {
    as_of_seq: "0",
    sql: {
      get: (query: string) =>
        query.includes("from sessions")
          ? { role: "app_engineer", project: null, app: MINE, operator: null }
          : undefined,
    },
  };
  return agentGrantsGetRead.handle(
    snapshot as never,
    { actor } as never,
    { agent } as never,
  );
}

Deno.test("agent는 자기 grant만 읽고 남의 grant는 forbidden이다", () => {
  const session = "agent:ses_0000000000000000000000000a";
  const own = read(session, { role: "app_engineer", app: MINE } as AgentRef);
  assert(own.ok);
  const other = read(session, { role: "app_engineer", app: OTHER } as AgentRef);
  assert(!other.ok);
  assertEquals(other.error.code, "forbidden");
  assert(read("user", { role: "app_engineer", app: OTHER } as AgentRef).ok);
});
