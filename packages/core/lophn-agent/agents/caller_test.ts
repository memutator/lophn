import assert from "node:assert/strict";
import { test } from "node:test";
import type { Place } from "../../../protocol/lophn-agent/mod.ts";
import { agentCallerRule } from "./caller.ts";
import type { ReadSql } from "./ports.ts";

// 세션 표 대신 row 하나를 돌려주는 sql이다. `undefined`면 없는 session이다.
function sqlOf(row: Record<string, unknown> | undefined): ReadSql {
  return { get: () => row, all: () => [] } as unknown as ReadSql;
}

// role 층의 규칙 자리에 끼우는 규칙이다: 자기 place만.
const ownPlaceOnly = (_role: unknown, own: Place | null, target: Place) =>
  own !== null && own.kind === target.kind && own.id === target.id;

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
test("an agent caller is held to its own place", () => {
  const rule = agentCallerRule(sqlOf(manager), {
    actor: "agent:ses_0aaaaaaaaaaaaaaaaaaaaaaaaa",
  }, ownPlaceOnly);
  if (!rule.ok || rule.value === null) throw new Error("expected a rule");
  assert.equal(rule.value(project("prj_0aaaaaaaaaaaaaaaaaaaaaaaaa")).ok, true);
  assert.equal(
    rule.value(project("prj_0bbbbbbbbbbbbbbbbbbbbbbbbb")).ok,
    false,
  );
  assert.equal(rule.value(null).ok, false);

  const person = agentCallerRule(
    sqlOf(undefined),
    { actor: "user" },
    ownPlaceOnly,
  );
  assert.equal(person.ok && person.value, null);

  const unknown = agentCallerRule(sqlOf(undefined), {
    actor: "agent:ses_0bbbbbbbbbbbbbbbbbbbbbbbbb",
  }, ownPlaceOnly);
  assert.equal(unknown.ok, false);
});
