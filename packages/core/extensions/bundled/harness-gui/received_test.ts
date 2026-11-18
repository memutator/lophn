import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyReceived } from "./received.ts";

// 앱이 보낸 call의 tag는 `from="app:<slug>"`다. 그 앱의 이름이지 "app:boss"라는 이름의 agent가 아니다.
test("harness GUI는 app: 보낸 쪽을 앱 sender로 읽고 agent 이름으로 읽지 않는다", () => {
  const app = classifyReceived(
    '<lophn-call from="app:boss" call="cal_1" reply="result">\ndo it\n</lophn-call>',
  );
  assert.deepStrictEqual(app?.sender, { kind: "app", app: null, name: "boss" });
  assert.equal(app?.call, "cal_1");
  const agent = classifyReceived(
    '<lophn-call from="agent:ses_1" call="cal_2" reply="none">\nhi\n</lophn-call>',
  );
  assert.deepStrictEqual(agent?.sender, {
    kind: "agent",
    agent: null,
    name: "agent:ses_1",
  });
});
