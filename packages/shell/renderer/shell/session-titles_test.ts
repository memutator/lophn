import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionRowTitle, sessionTitlesKey } from "./session-titles.ts";

// 여러 번 고친 bug: session 이름이 agent 이름으로 떨어졌다가 그 탭을 다시 골라야 돌아왔다.
test("session titles are re-read when a turn starts, and a row is named by the session title", () => {
  const entry = (state: string, ended: string | null = null) => [
    { session: "ses_a", ended, state },
  ];
  // 자동 제목은 첫 말에 붙는다. session이 생긴 뒤 turn이 돌기 시작하면 다시 읽어야 한다.
  assert.notEqual(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("running")),
  );
  assert.notEqual(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("idle", "archived")),
  );
  // 물음을 기다리는 것처럼 제목과 상관없는 변화에는 다시 읽지 않는다.
  assert.equal(
    sessionTitlesKey(entry("idle")),
    sessionTitlesKey(entry("waiting")),
  );

  const names = { agentName: "lophn", untitled: "Untitled" };
  assert.equal(
    sessionRowTitle({ title: "alpha", open: true, ...names }),
    "alpha",
  );
  assert.equal(sessionRowTitle({ title: null, open: true, ...names }), "lophn");
  assert.equal(
    sessionRowTitle({ title: undefined, open: false, ...names }),
    "Untitled",
  );
});
