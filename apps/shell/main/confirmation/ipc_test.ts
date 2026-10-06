import assert from "node:assert/strict";
import { test } from "node:test";

import { createConfirmationOpener } from "../../preload/confirmation-open.ts";
import { type ConfirmationIpcEvent, registerConfirmationIpc } from "./ipc.ts";
import {
  coordinator,
  fake,
  INTENT,
  parent,
  REF,
} from "./coordinator_fixture.ts";

type Listener = (
  event: ConfirmationIpcEvent,
  input: unknown,
) => Promise<unknown>;

function wire() {
  const env = fake();
  const confirm = coordinator(env);
  const handlers = new Map<string, Listener>();
  registerConfirmationIpc({
    handle: (channel, listener) => handlers.set(channel, listener),
    removeHandler: (channel) => handlers.delete(channel),
  }, {
    coordinator: confirm,
    // contents 100만 desktop 창 본문이다.
    parentOf: (event) =>
      event.sender.id === 100 ? parent("window-1") : undefined,
  });
  const call = (channel: string, sender: number, input?: unknown) =>
    handlers.get(channel)!({ sender: { id: sender } }, input);
  return { env, confirm, call };
}

test("shell/confirmation-window#R1, shell/confirmation-window#R6: 창 열기는 desktop 창 본문만, 결정은 그 보호 창만 보낸다", async () => {
  const { env, call } = wire();
  const denied = await call("shell:confirmation-open", 7, {
    request: INTENT,
    parentWindow: "window-1",
  }) as { code?: string };
  assert.equal(denied.code, "forbidden");
  assert.equal(env.windows.length, 0);
  const bad = await call("shell:confirmation-open", 100, {
    request: { ...INTENT, body: { grant: true } },
    parentWindow: "window-1",
  }) as { code?: string };
  assert.equal(bad.code, "invalid_input");
  const opened = await call("shell:confirmation-open", 100, {
    request: INTENT,
    parentWindow: "anything",
  }) as { windowId: string; displayId: string };
  assert.equal(typeof opened.windowId, "string");
  // desktop 창이 보호 창 통로로 결정을 보내지 못한다.
  const fromShell = await call("confirmation:submit", 100, {
    displayId: opened.displayId,
    decision: "grant_approval_request",
  }) as { ok?: boolean };
  assert.equal(fromShell.ok, false);
  assert.equal(env.submitted.length, 0);
  // 보호 창의 webContents(fixture는 1부터 센다)만 표시와 제출을 한다.
  const shown = await call("confirmation:display", 1) as {
    displayId: string;
    decisions: string[];
  };
  assert.equal(shown.displayId, opened.displayId);
  assert.deepEqual(shown.decisions, [
    "grant_approval_request",
    "reject_approval_request",
  ]);
  const decided = await call("confirmation:submit", 1, {
    displayId: opened.displayId,
    decision: "grant_approval_request",
  });
  assert.deepEqual(decided, {
    outcome: "decided",
    receipt: { kind: "event", seq: "1" },
  });
  assert.equal(JSON.stringify([opened, shown, decided]).includes(REF), false);
});

test("lophn-agent/harness/provider#R6, shell/confirmation-window#R6: 계정 교체·삭제 열기는 계정 key와 행동만 받고 등록 정보나 값을 함께 받지 않는다", async () => {
  const { env, call } = wire();
  const owner = "pvd_01h455vb4pex5v6nkc6gd5fd01";
  const open = (request: Record<string, unknown>) =>
    call("shell:confirmation-open", 100, {
      request: { kind: "secret_input", owner, ...request },
      parentWindow: "window-1",
    }) as Promise<{ code?: string }>;
  const purpose = "provider_credential";
  for (
    const bad of [
      { purpose, change: { key: "main", action: "delete" } },
      { purpose, change: { key: "main", action: "revoke", value: "x" } },
      { purpose: "app_secret", change: { key: "main", action: "revoke" } },
      {
        purpose,
        change: { key: "main", action: "revoke" },
        credential: {
          key: "main",
          kind: "api_key",
          label: "Main",
          account: null,
          organization: null,
          plan: null,
        },
      },
    ]
  ) {
    assert.equal((await open(bad)).code, "invalid_input");
  }
  assert.equal(env.windows.length, 0);
  // 등록 정보의 지문은 선택이다. 값에서 main이 만든다.
  const registering = await open({
    purpose,
    credential: {
      key: "key-1",
      kind: "api_key",
      label: "Main",
      account: null,
      organization: null,
      plan: null,
    },
  });
  assert.notEqual(registering.code, "invalid_input");
});

test("shell/confirmation-window#R4: 닫기는 결정이 아니고 창을 닫는다", async () => {
  const { env, call } = wire();
  await call("shell:confirmation-open", 100, {
    request: INTENT,
    parentWindow: "window-1",
  });
  const dismissed = await call("confirmation:cancel", 1);
  assert.deepEqual(dismissed, { outcome: "dismissed" });
  assert.equal(env.submitted.length, 0);
  assert.equal(env.windows[0]?.closed, true);
});

test("shell/confirmation-window#R6: 일반 preload의 열기는 통로 실패를 고정 오류로 바꾼다", async () => {
  const sent: [string, unknown][] = [];
  const open = createConfirmationOpener({
    invoke: (channel, input) => {
      sent.push([channel, input]);
      return Promise.reject(new Error("raw electron failure"));
    },
  });
  const result = await open({ request: INTENT, parentWindow: "w" });
  assert.deepEqual(result, {
    code: "unavailable",
    message: "Confirmation is unavailable",
  });
  assert.equal(sent[0]?.[0], "shell:confirmation-open");
});
