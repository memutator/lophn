// 신뢰 감독(main)의 child 등록 시험(platform#T34 후속, shell/terminal#R5, platform/identity#R15). core는 fake라
// 실제 core·keychain·coding agent 제품은 열지 않는다(core 쪽 입구와 전달은 apps/core/coding-child-register_test.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createChildRegistrar } from "../coding-children.ts";
import { CAC } from "./fixtures.ts";

const OTHER = "cac_01h455vb4pex5v6nkc6gd5fdw2";
const HELPER = "/opt/lophn/lophn-credential";

type Call = { kind: string; resource: string; method: string; body: unknown };

function setup(options: { ok?: boolean; session?: boolean } = {}) {
  const calls: Call[] = [];
  const registrar = createChildRegistrar({
    core: () =>
      options.session === false ? null : {
        internal(kind, resource, method, body) {
          calls.push({ kind, resource, method, body });
          return Promise.resolve({ ok: options.ok !== false });
        },
      },
  });
  return { calls, registrar };
}

const started = (
  generation: string,
  runtime = "term_1",
  connection = CAC,
) => ({
  event: "child_started",
  runtime_ref: runtime,
  connection,
  process_generation: generation,
  loader_identity: HELPER,
});
const ended = (generation: string, runtime = "term_1", connection = CAC) => ({
  event: "child_ended",
  runtime_ref: runtime,
  connection,
  process_generation: generation,
});
const tuiEnded = (runtime = "term_1", connection = CAC) => ({
  event: "tui_ended",
  runtime_ref: runtime,
  connection,
});

test("shell/terminal#R5 platform/identity#R15: 관측한 child를 사람 credential의 memory route로 connection·generation·loader만 담아 등록한다", async () => {
  const { calls, registrar } = setup();
  registrar.onEvent(started("120.520"));
  await registrar.idle();
  assert.deepEqual(calls, [{
    kind: "memory",
    resource: "coding_agent_connections",
    method: "register_child",
    body: {
      connection: CAC,
      process_generation: "120.520",
      loader_identity: HELPER,
    },
  }]);
  registrar.onEvent(ended("120.520"));
  await registrar.idle();
  assert.deepEqual(calls[1], {
    kind: "memory",
    resource: "coding_agent_connections",
    method: "end_child",
    body: { process_generation: "120.520" },
  });
});

test("shell/terminal#R5 platform/identity#R15: 올바르지 않은 줄(관측 줄·상대 경로 loader·잘못된 connection)은 core를 부르지 않는다", async () => {
  const { calls, registrar } = setup();
  registrar.onEvent({ event: "observation", envelope: {} });
  registrar.onEvent(null);
  registrar.onEvent({ ...started("1.1"), loader_identity: "lophn-credential" });
  registrar.onEvent({ ...started("1.1"), connection: "not-a-connection" });
  registrar.onEvent({ ...started("1.1"), process_generation: "" });
  await registrar.idle();
  assert.deepEqual(calls, []);
});

test("shell/terminal#R5 platform/identity#R15: TUI가 끝나면 그 TUI의 child를 해제하고 같은 connection의 다른 TUI child가 없을 때만 connection을 정리한다", async () => {
  const { calls, registrar } = setup();
  registrar.onEvent(started("11.1", "term_1"));
  registrar.onEvent(started("12.1", "term_1"));
  registrar.onEvent(started("21.1", "term_2")); // 같은 connection의 다른 TUI
  registrar.onEvent(started("31.1", "term_3", OTHER));
  await registrar.idle();
  calls.length = 0;

  registrar.onEvent(tuiEnded("term_1"));
  await registrar.idle();
  // term_2가 같은 connection의 child를 갖고 있어 connection 전체는 정리하지 않는다.
  assert.deepEqual(
    calls.map((call) => [call.method, call.body]),
    [
      ["end_child", { process_generation: "11.1" }],
      ["end_child", { process_generation: "12.1" }],
    ],
  );
  calls.length = 0;

  registrar.onEvent(tuiEnded("term_2"));
  await registrar.idle();
  assert.deepEqual(
    calls.map((call) => [call.method, call.body]),
    [
      ["end_child", { process_generation: "21.1" }],
      ["end_connection", { connection: CAC }],
    ],
  );
  // 다른 connection의 child는 그대로다.
  calls.length = 0;
  registrar.onEvent(tuiEnded("term_3", OTHER));
  await registrar.idle();
  assert.deepEqual(calls.map((call) => call.method), [
    "end_child",
    "end_connection",
  ]);
});

test("shell/terminal#R5 platform/identity#R15: host가 사라지면 등록한 모든 connection을 정리한다", async () => {
  const { calls, registrar } = setup();
  registrar.onEvent(started("11.1", "term_1"));
  registrar.onEvent(started("31.1", "term_3", OTHER));
  await registrar.idle();
  calls.length = 0;
  registrar.hostLost();
  await registrar.idle();
  assert.deepEqual(
    calls.map((call) => [call.method, call.body]).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
    [
      ["end_connection", { connection: CAC }],
      ["end_connection", { connection: OTHER }],
    ],
  );
});

test("shell/terminal#R5 platform/identity#R15: core가 등록을 거절하거나 연결이 없으면 그 child는 추적하지 않고 호출 순서는 줄 세운다", async () => {
  const refused = setup({ ok: false });
  refused.registrar.onEvent(started("11.1"));
  refused.registrar.onEvent(tuiEnded());
  await refused.registrar.idle();
  // 등록되지 않은 child는 해제할 것이 없다. connection 정리만 한 번 시도한다.
  assert.deepEqual(refused.calls.map((call) => call.method), [
    "register_child",
    "end_connection",
  ]);
  const down = setup({ session: false });
  down.registrar.onEvent(started("11.1"));
  await down.registrar.idle();
  assert.deepEqual(down.calls, []);

  // 등록·해제가 연달아 와도 순서가 뒤집히지 않는다.
  const ordered = setup();
  ordered.registrar.onEvent(started("11.1"));
  ordered.registrar.onEvent(ended("11.1"));
  ordered.registrar.onEvent(started("12.1"));
  await ordered.registrar.idle();
  assert.deepEqual(
    ordered.calls.map((call) =>
      `${call.method}:${
        (call.body as { process_generation: string }).process_generation
      }`
    ),
    ["register_child:11.1", "end_child:11.1", "register_child:12.1"],
  );
});
