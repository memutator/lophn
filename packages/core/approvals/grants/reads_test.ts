import { assert, assertEquals } from "@std/assert";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { agentGrantsGetRead } from "./reads.ts";

// agent가 남의 grant를 읽으면 안 된다는 권한 경계 시험이다. session의 agent는 port 가짜가 푼다.
const MINE = "prj_0000000000000000000000000a";
const OTHER = "prj_0000000000000000000000000b";
const SESSION = "ses_0000000000000000000000000a";

function read(actor: string, agent: AgentRef) {
  const snapshot = {
    as_of_seq: "0",
    sql: { get: () => undefined },
    port: () => ({
      agentOf: (session: string) =>
        session === SESSION
          ? { role: "project_manager", project: MINE }
          : undefined,
    }),
  };
  return agentGrantsGetRead.handle(
    snapshot as never,
    { actor } as never,
    { agent } as never,
  );
}

Deno.test("agent는 자기 grant만 읽고 남의 grant는 forbidden이다", () => {
  const session = `agent:${SESSION}`;
  const own = read(
    session,
    { role: "project_manager", project: MINE } as AgentRef,
  );
  assert(own.ok);
  const other = read(
    session,
    { role: "project_manager", project: OTHER } as AgentRef,
  );
  assert(!other.ok);
  assertEquals(other.error.code, "forbidden");
  // port가 풀지 못하는 session은 자기 grant도 읽지 못한다.
  const unknown = read(
    "agent:ses_0000000000000000000000000z",
    { role: "project_manager", project: MINE } as AgentRef,
  );
  assert(!unknown.ok);
  assertEquals(unknown.error.code, "forbidden");
  assert(
    read("user", { role: "project_manager", project: OTHER } as AgentRef).ok,
  );
});
