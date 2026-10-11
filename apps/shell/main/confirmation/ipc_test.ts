import assert from "node:assert/strict";
import { test } from "node:test";

import { createConfirmationEndedSubscriber } from "../../preload/confirmation-ended.ts";
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
  // 열기를 보낸 창 본문이 받은 알림. contents 번호별로 따로 쌓인다.
  const received = new Map<number, [string, unknown][]>();
  const call = (channel: string, sender: number, input?: unknown) =>
    handlers.get(channel)!({
      sender: {
        id: sender,
        send: (name, payload) => {
          received.set(sender, [...received.get(sender) ?? [], [
            name,
            payload,
          ]]);
        },
        isDestroyed: () => false,
      },
    }, input);
  return { env, confirm, call, received };
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

test("shell/confirmation-window#R9: 취소·닫기로 확정 없이 끝나면 연 창에만 windowId와 종류만 알리고 다른 창과 내용은 받지 않는다", async () => {
  const { env, call, received } = wire();
  const open = () =>
    call("shell:confirmation-open", 100, {
      request: INTENT,
      parentWindow: "window-1",
    }) as Promise<{ windowId: string }>;
  const first = await open();
  await call("confirmation:cancel", 1);
  assert.deepEqual(received.get(100), [[
    "shell:confirmation-ended",
    { windowId: first.windowId, ended: "cancelled" },
  ]]);
  // 사람이 창을 직접 닫아도 한 번만, 닫힘으로 알린다.
  const second = await open();
  env.windows[1]?.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(received.get(100)?.[1], [
    "shell:confirmation-ended",
    { windowId: second.windowId, ended: "closed" },
  ]);
  assert.equal(received.get(100)?.length, 2);
  // 보호 창과 다른 창 본문은 아무것도 받지 않고, 알림에는 대상·결정·proof가 없다.
  assert.equal(received.get(1), undefined);
  assert.equal(received.get(7), undefined);
  const text = JSON.stringify(received.get(100));
  for (const leak of [INTENT.approval, REF, "grant_approval_request"]) {
    assert.equal(text.includes(leak), false);
  }
});

test("shell/confirmation-window#R9: 결정을 제출한 확인은 닫혀도 끝남으로 알리지 않는다", async () => {
  const { call, received } = wire();
  const opened = await call("shell:confirmation-open", 100, {
    request: INTENT,
    parentWindow: "window-1",
  }) as { displayId: string };
  await call("confirmation:submit", 1, {
    displayId: opened.displayId,
    decision: "grant_approval_request",
  });
  await call("confirmation:cancel", 1);
  assert.equal(received.get(100), undefined);
});

test("shell/confirmation-window#R4: 거절은 접수된 결정이어도 연 창에 rejected로 알려 허락 대기를 풀고 허락은 알리지 않는다", async () => {
  const { call, received } = wire();
  const opened = await call("shell:confirmation-open", 100, {
    request: INTENT,
    parentWindow: "window-1",
  }) as { windowId: string; displayId: string };
  const granted = await call("confirmation:submit", 1, {
    displayId: opened.displayId,
    decision: "grant_approval_request",
  }) as { outcome?: string };
  assert.equal(granted.outcome, "decided");
  assert.equal(received.get(100), undefined);
  // 다른 확인: 거절 제출은 결정으로 접수되고 연 창에는 windowId와 종류만 간다.
  const second = await call("shell:confirmation-open", 100, {
    request: INTENT,
    parentWindow: "window-1",
  }) as { windowId: string; displayId: string };
  const rejected = await call("confirmation:submit", 2, {
    displayId: second.displayId,
    decision: "reject_approval_request",
  }) as { outcome?: string };
  assert.equal(rejected.outcome, "decided");
  assert.deepEqual(received.get(100)?.at(-1), [
    "shell:confirmation-ended",
    { windowId: second.windowId, ended: "rejected" },
  ]);
  // 거절 뒤 창을 닫아도 다시 알리지 않는다.
  await call("confirmation:cancel", 2);
  assert.equal(received.get(100)?.length, 1);
});

test("shell/confirmation-window#R9: 같은 창에서 다른 확인을 열어 바뀌면 옛 확인을 replaced로 알린다", async () => {
  const { call, received } = wire();
  const open = () =>
    call("shell:confirmation-open", 100, {
      request: INTENT,
      parentWindow: "window-1",
    }) as Promise<{ windowId: string }>;
  const first = await open();
  await open();
  assert.deepEqual(received.get(100), [[
    "shell:confirmation-ended",
    { windowId: first.windowId, ended: "replaced" },
  ]]);
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

test("shell/confirmation-window#R9: 일반 preload의 끝남 구독은 windowId와 알려진 종류만 넘기고 구독을 풀 수 있다", () => {
  const listeners = new Map<
    string,
    (event: unknown, payload: unknown) => void
  >();
  const subscribe = createConfirmationEndedSubscriber({
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel) => listeners.delete(channel),
  });
  const got: unknown[] = [];
  const off = subscribe((ended) => got.push(ended));
  const push = listeners.get("shell:confirmation-ended")!;
  push({ raw: "event" }, { windowId: "cfw_1", ended: "closed", extra: "x" });
  push({}, { windowId: "cfw_2", ended: "decided" });
  push({}, { windowId: "", ended: "closed" });
  push({}, null);
  assert.deepEqual(got, [{ windowId: "cfw_1", ended: "closed" }]);
  off();
  assert.equal(listeners.size, 0);
});

test("shell/desktop#R47, shell/confirmation-window#R1 [agent-I42]: 창 열기는 미리 고른 범위를 받고 계속 허락 같은 값은 받지 않으며 열어도 결정은 제출되지 않는다", async () => {
  const { env, call } = wire();
  for (const preselect of ["always", "allow_forever", "once", "", null, 1]) {
    const bad = await call("shell:confirmation-open", 100, {
      request: { ...INTENT, preselect },
      parentWindow: "window-1",
    }) as { code?: string };
    assert.equal(bad.code, "invalid_input", String(preselect));
  }
  assert.equal(env.windows.length, 0);
  for (const preselect of ["allow_once", "allow_session", "deny"]) {
    const opened = await call("shell:confirmation-open", 100, {
      request: { ...INTENT, preselect },
      parentWindow: "window-1",
    }) as { windowId?: string; code?: string };
    assert.equal(typeof opened.windowId, "string", preselect);
    assert.equal(env.canon.intents.at(-1)?.kind, "approval_request");
    assert.deepEqual(env.canon.intents.at(-1), { ...INTENT, preselect });
  }
  // 열기만으로 허락·거절이 제출되지 않는다.
  assert.equal(env.submitted.length, 0);
  // 다른 종류에는 미리 고른 범위가 없다.
  const other = await call("shell:confirmation-open", 100, {
    request: {
      kind: "question_option_action",
      question: "qst_00000000000000000000000001",
      option_key: "a",
      preselect: "allow_once",
    },
    parentWindow: "window-1",
  }) as { code?: string };
  assert.equal(other.code, "invalid_input");
});
