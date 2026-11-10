import assert from "node:assert/strict";
import { test } from "node:test";

import { idSchema } from "../../../protocol/base/ids.ts";
import { guiSessionId, terminalName } from "./model.ts";

// 여러 번 고친 bug: 이름의 출처(GUI 제목, 터미널 제목)가 잠깐 사라진 순간 탭이 자동 이름(project 이름)으로 떨어지고,
// 그 순간의 저장이 기억해 둔 이름까지 지웠다.
test("a terminal tab keeps its session name while the source is gone, and drops it for a new session", () => {
  const auto = "lophn";
  const agent = {
    session: "s1",
    name: null,
    screenTitle: null,
    label: "Claude Code",
  };
  const name = (input: Partial<Parameters<typeof terminalName>[0]>) =>
    terminalName({
      person: null,
      guiTitle: null,
      agent,
      remembered: null,
      auto,
      ...input,
    });

  // 순서: 사람 이름 > GUI 제목 > hook 이름 > 터미널 제목 > 자동 이름.
  const full = { ...agent, name: "named", screenTitle: "topic" };
  assert.equal(
    name({ person: "mine", guiTitle: "gui", agent: full }).title,
    "mine",
  );
  assert.equal(name({ guiTitle: "gui", agent: full }).title, "gui");
  assert.equal(name({ agent: full }).title, "named");
  assert.equal(
    name({ agent: { ...agent, screenTitle: "topic" } }).title,
    "topic",
  );
  assert.equal(name({}).title, auto);
  // agent가 없으면(일반 shell) 자동 이름이고 기억은 건드리지 않는다.
  const kept = { title: "topic", session: "s1" };
  assert.deepEqual(name({ agent: null, remembered: kept }), {
    title: auto,
    remembered: kept,
  });

  // 얻은 이름은 session id와 함께 기억한다. 사람 이름이 있어도 기억은 따라간다.
  assert.deepEqual(
    name({ person: "mine", agent: { ...agent, screenTitle: "topic" } })
      .remembered,
    kept,
  );
  // 출처가 사라져도(그리지 않은 GUI 탭, foreground를 잠깐 떠난 TUI) 같은 session이면 기억한 이름이다.
  assert.deepEqual(name({ remembered: kept }), {
    title: "topic",
    remembered: kept,
  });
  // 다시 뜬 TUI가 제품 이름만 내는 동안에도 기억한 이름이 이긴다. 기억이 없으면 제품 이름이다.
  const fresh = { ...agent, screenTitle: "Claude Code" };
  assert.equal(name({ agent: fresh, remembered: kept }).title, "topic");
  assert.deepEqual(name({ agent: fresh }), {
    title: "Claude Code",
    remembered: null,
  });
  // 다른 session(`/clear`, 새 session)이면 옛 이름을 버린다.
  assert.deepEqual(
    name({ agent: { ...agent, session: "s2" }, remembered: kept }),
    {
      title: auto,
      remembered: null,
    },
  );
  // session id 없이 저장된 옛 기억은 지금 session의 것으로 받는다.
  assert.deepEqual(name({ remembered: { title: "old", session: null } }), {
    title: "old",
    remembered: { title: "old", session: "s1" },
  });
});

test("GUI 화면의 session id는 ACP 입력의 session 검사를 통과한다", () => {
  const session = guiSessionId("trm_01hzx3k4m5n6p7q8r9s0t1v2w3");
  assert.equal(session, "ses_01hzx3k4m5n6p7q8r9s0t1v2w3");
  assert.ok(idSchema("ses").safeParse(session).success);
});
