import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONNECTION_CONCERN,
  CONNECTION_REVOKE,
  readConnectionRevoke,
  submitConnectionRevoke,
} from "./connection-revoke.ts";
import { createKinds } from "./mod.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";

const CAC = id("cac", 1);
const APP = id("app", 1);

function shown(over: Record<string, unknown> = {}) {
  return {
    connection: {
      id: CAC,
      label: "Desk Claude",
      scope: { kind: "all", app: null },
      principal: `coding_agent:${CAC}`,
      state: "active",
      revision: "7",
      ...over,
    },
  };
}

test("coding-agent/connection#R2: 회수 정본은 연결의 현재 판을 다시 읽어 정확한 연결·판에 묶는다", async () => {
  const core = fakeCore({
    "read:coding_agent_connections/show": () => ok(shown()),
  });
  const read = await readConnectionRevoke(core, CAC);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(core.calls.map((call) => call.body), [{ connection: CAC }]);
  assert.equal(read.value.targetRef, CAC);
  assert.deepEqual(read.value.content, { connection: CAC, base_revision: "7" });
  assert.deepEqual(read.value.allowed, [CONNECTION_REVOKE]);
  assert.equal(read.value.secondConfirm, false);
  assert.deepEqual(read.value.request, {
    kind: "owner_decision",
    concern: CONNECTION_CONCERN,
    decision: CONNECTION_REVOKE,
    targets: [CAC],
    input: {
      kind: "inline",
      value: { connection: CAC, base_revision: "7" },
    },
    comparison: { base_revision: "7" },
  });
  assert.equal(read.value.view?.kind, "connection_revoke");
  assert.equal(read.value.view?.label, "Desk Claude");
  assert.equal(read.value.view?.scope, "all");
});

test("coding-agent/connection#R2: 앱 하나 범위 연결은 앱 이름을 보조로 읽고 못 읽어도 결정은 막지 않는다", async () => {
  const withName = fakeCore({
    "read:coding_agent_connections/show": () =>
      ok(shown({ scope: { kind: "app", app: APP } })),
    "read:apps/get": () => ok({ app: { name: "Grocery budget" } }),
  });
  const named = await readConnectionRevoke(withName, CAC);
  assert.equal(named.ok && named.value.view?.app_name, "Grocery budget");
  assert.equal(named.ok && named.value.view?.scope, "app");
  const without = fakeCore({
    "read:coding_agent_connections/show": () =>
      ok(shown({ scope: { kind: "app", app: APP } })),
  });
  const unnamed = await readConnectionRevoke(without, CAC);
  assert.equal(unnamed.ok && unnamed.value.view?.app_name, null);
  assert.equal(unnamed.ok && unnamed.value.view?.app, APP);
  assert.deepEqual(unnamed.ok && unnamed.value.allowed, [CONNECTION_REVOKE]);
});

test("coding-agent/connection#R2: 이미 회수된 연결에는 고를 결정이 없고 읽지 못하면 일부만 보이지 않고 실패다", async () => {
  const revoked = await readConnectionRevoke(
    fakeCore({
      "read:coding_agent_connections/show": () =>
        ok(shown({ state: "revoked" })),
    }),
    CAC,
  );
  assert.equal(revoked.ok && revoked.value.allowed.length, 0);
  assert.equal(revoked.ok && revoked.value.view?.revoked, true);
  const missing = await readConnectionRevoke(fakeCore({}), CAC);
  assert.equal(missing.ok, false);
  const other = await readConnectionRevoke(
    fakeCore({
      "read:coding_agent_connections/show": () =>
        ok(shown({ id: id("cac", 2) })),
    }),
    CAC,
  );
  assert.equal(other.ok, false);
});

test("coding-agent/connection#R2: 제출은 본 연결과 판으로 RevokeCodingAgentConnection을 handle과 함께 보낸다", async () => {
  const core = fakeCore({
    "command:coding_agent_connections/revoke": () =>
      ok({ connection: shown({ state: "revoked" }).connection }),
  });
  const given = handle();
  const sent = await submitConnectionRevoke(core, {
    handle: given,
    content: { connection: CAC, base_revision: "7" },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { receipt: { kind: "entity", id: CAC }, result: "applied" },
  });
  assert.deepEqual(core.calls[0]?.body, {
    input: { connection: CAC, base_revision: "7" },
    idempotency_key: `confirmation:${given.ref}`,
    compare: { base_revision: "7" },
    prepared: [],
    confirmation: given.ref,
  });
});

test("coding-agent/connection#R2: 낡은 판의 제출은 core가 거절한 conflict 그대로고 transport 끊김은 결과 모름이다", async () => {
  const stale = await submitConnectionRevoke(
    fakeCore({
      "command:coding_agent_connections/revoke": () => ({
        ok: false,
        error: { code: "conflict", message: "stale" },
      }),
    }),
    { handle: handle(), content: { connection: CAC, base_revision: "6" } },
  );
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.unknown, false);
  const lost = await submitConnectionRevoke(
    fakeCore({
      "command:coding_agent_connections/revoke": () => ({
        ok: false,
        error: { code: "unavailable", message: "gone" },
      }),
    }),
    { handle: handle(), content: { connection: CAC, base_revision: "7" } },
  );
  assert.deepEqual(lost, { ok: false, unknown: true });
});

test("coding-agent/connection#R2: createKinds는 회수 결정을 read와 submit에 이어 주고 다른 concern의 결정으로는 보내지 않는다", async () => {
  const core = fakeCore({
    "read:coding_agent_connections/show": () => ok(shown()),
    "command:coding_agent_connections/revoke": () => ok({}),
  });
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => 0 },
    random: (bytes) => bytes,
  });
  const read = await kinds.canon.read({
    kind: "owner_decision",
    concern: CONNECTION_CONCERN,
    decision: CONNECTION_REVOKE,
    targets: [CAC],
  }, "cfw_1");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const sent = await kinds.submit.submit({
    handle: handle(),
    decision: CONNECTION_REVOKE,
    commandInput: {},
    canonical: read.value,
  });
  assert.equal(sent.ok, true);
  const wrong = await kinds.submit.submit({
    handle: handle(),
    decision: "other_decision",
    commandInput: {},
    canonical: read.value,
  });
  assert.equal(wrong.ok, false);
  assert.equal(
    core.calls.filter((call) => call.method === "revoke").length,
    1,
  );
});
