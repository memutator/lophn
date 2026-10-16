import { assertEquals } from "@std/assert";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
import { agentCallerRule } from "./caller.ts";
import type { ReadSql } from "./ports.ts";

// 세션 표 대신 row 하나를 돌려주는 sql이다. `undefined`면 없는 session이다.
function sqlOf(row: Record<string, unknown> | undefined): ReadSql {
  return { get: () => row, all: () => [] } as unknown as ReadSql;
}

const project = (id: string) => ({ kind: "project", id }) as Place;
const manager = {
  id: "ses_0aaaaaaaaaaaaaaaaaaaaaaaaa",
  role: "project_manager",
  project: "prj_0aaaaaaaaaaaaaaaaaaaaaaaaa",
  place_kind: "project",
  place_id: "prj_0aaaaaaaaaaaaaaaaaaaaaaaaa",
  lifecycle: "open",
  created_seq: 1,
  state_seq: 1,
};

// agent는 자기 place의 Operator만 만들고 고친다. 사람은 범위가 없다.
Deno.test("an agent caller is held to its own place", () => {
  const rule = agentCallerRule(sqlOf(manager), {
    actor: "agent:ses_0aaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  if (!rule.ok || rule.value === null) throw new Error("expected a rule");
  assertEquals(rule.value(project("prj_0aaaaaaaaaaaaaaaaaaaaaaaaa")).ok, true);
  assertEquals(rule.value(project("prj_0bbbbbbbbbbbbbbbbbbbbbbbbb")).ok, false);
  assertEquals(rule.value(null).ok, false);

  const person = agentCallerRule(sqlOf(undefined), { actor: "user" });
  assertEquals(person.ok && person.value, null);

  const unknown = agentCallerRule(sqlOf(undefined), {
    actor: "agent:ses_0bbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assertEquals(unknown.ok, false);
});
