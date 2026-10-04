// relay publish 테스트. shell/workspace#R9, R10과 shell/terminal#R8,
// prompt-assemble#R28의 전달 절반(shell 쪽)이다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { type CurrentViewState, SUMMARY_MAX_BYTES } from "./current-view.ts";
import {
  type CoreSessionLike,
  createViewPublisher,
  type NotifiedState,
} from "./view-publish.ts";

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T06:48:00.000Z";

/** publish·bind·unpublish 호출 기록. relay가 부른 모양 그대로다. */
interface SessionRecord {
  kind: string;
  resource: string;
  method: string;
  body: unknown;
}

/** publish·bind·unpublish 호출을 기록하는 가짜 세션. */
function fakeSession(
  calls: SessionRecord[],
  fail?: { code: string; message: string },
): CoreSessionLike {
  return {
    call(kind, resource, method, body) {
      calls.push({ kind, resource, method, body });
      if (fail) return Promise.resolve({ ok: false, error: fail });
      return Promise.resolve({ ok: true, value: {} });
    },
  };
}

function state(partial: Partial<CurrentViewState> = {}): CurrentViewState {
  return {
    window_ref: "win-1",
    generation: 3,
    observed_at: AT,
    project: PRJ,
    tabs: [
      {
        kind: "document_editor",
        key: "t1",
        document: DOC,
        selected: true,
      },
    ],
    focused_pane: 0,
    selection: null,
    app_view: null,
    availability: "current",
    omissions: [],
    ...partial,
  };
}

test("shell/workspace#R9: 창의 보기 generation이 바뀔 때 relay에 publish한다", async () => {
  const calls: SessionRecord[] = [];
  const publisher = createViewPublisher({
    session: () => fakeSession(calls),
  });
  const first = await publisher.publish(state({ generation: 1 }));
  assert.deepEqual(first, { ok: true });
  const second = await publisher.publish(state({ generation: 2 }));
  assert.deepEqual(second, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.kind, "memory");
  assert.equal(calls[0]?.resource, "workspace");
  assert.equal(calls[0]?.method, "publish");
  const body = calls[0]?.body as {
    window_ref: string;
    generation: number;
    observed_at: string;
    summary: string;
    tab_pages: unknown[][];
  };
  assert.equal(body.window_ref, "win-1");
  assert.equal(body.generation, 1);
  assert.equal(body.observed_at, AT);
  assert.ok(Array.isArray(body.tab_pages));
});

test("shell/workspace#R9: 사람 요청·steering을 보낼 때 그 창 window_ref와 session 결합을 함께 보낸다", async () => {
  const calls: SessionRecord[] = [];
  const publisher = createViewPublisher({
    session: () => fakeSession(calls),
  });
  const bound = await publisher.bind("ses_01arz3ndektsv4rrffq69g5fav", "win-1");
  assert.deepEqual(bound, { ok: true });
  const call = calls[0];
  assert.equal(call?.method, "bind");
  assert.deepEqual(call?.body, {
    session: "ses_01arz3ndektsv4rrffq69g5fav",
    window_ref: "win-1",
  });
});

test("shell/workspace#R10: 요약은 2048 bytes, 탭 page 20개, 생략·잘림·관측 시각을 표시한다", async () => {
  const calls: SessionRecord[] = [];
  const publisher = createViewPublisher({
    session: () => fakeSession(calls),
  });
  const tabs = [];
  for (let i = 0; i < 45; i++) {
    tabs.push({
      kind: "document_editor" as const,
      key: `t${i}`,
      document: DOC,
      selected: false,
    });
  }
  const out = await publisher.publish(
    state({
      tabs,
      omissions: [{ reason: "one", truncated: false }],
    }),
  );
  assert.deepEqual(out, { ok: true });
  const body = calls[0]?.body as {
    summary: string;
    tab_pages: { length: number }[];
  };
  const bytes = new TextEncoder().encode(body.summary).length;
  assert.ok(bytes <= SUMMARY_MAX_BYTES, `summary is ${bytes} bytes`);
  assert.ok(body.summary.includes(`observed ${AT}`));
  assert.ok(/omitted \d+/.test(body.summary));
  assert.equal(body.tab_pages.length, 3);
});

test("shell/workspace#R10: redaction 실패는 omission이다", async () => {
  const calls: SessionRecord[] = [];
  let notified: NotifiedState | undefined;
  // core가 publish를 거절하면 unavailable이고 상태는 온 창으로 대신하지 않는다.
  const failing = createViewPublisher({
    session: () =>
      fakeSession(calls, { code: "unavailable", message: "redaction omitted" }),
    onState: (value) => {
      notified = value;
    },
  });
  const out = await failing.publish(state());
  assert.equal(out.ok, false);
  assert.equal(notified?.availability, "unavailable");
  assert.equal(notified?.window_ref, "win-1");
  assert.ok(notified?.reason.includes("redaction"));
});

test("shell/workspace#R10: 창 닫힘에는 unavailable을 publish한다", async () => {
  const calls: SessionRecord[] = [];
  let notified: NotifiedState | undefined;
  const publisher = createViewPublisher({
    session: () => fakeSession(calls),
    onState: (value) => {
      notified = value;
    },
  });
  const out = await publisher.unavailable("win-1", "window closed");
  assert.deepEqual(out, { ok: true });
  assert.equal(notified?.availability, "unavailable");
  assert.equal(notified?.window_ref, "win-1");
  // relay에는 창 하나의 부재 표시로 publish가 간다.
  assert.equal(calls[0]?.method, "publish");
});

test("shell/workspace#R10: 단절에는 disconnected를 publish하고 다른 창의 상태를 대신 쓰지 않는다", async () => {
  const calls: SessionRecord[] = [];
  let notified: NotifiedState | undefined;
  // session이 null이면 단절이다(publisher의 session 접근이 실패).
  const publisher = createViewPublisher({
    session: () => null,
    onState: (value) => {
      notified = value;
    },
  });
  const out = await publisher.publish(state());
  assert.equal(out.ok, false);
  assert.equal(notified?.availability, "disconnected");
  assert.equal(notified?.window_ref, "win-1");
  const gone = await publisher.disconnected("win-1", "core lost");
  assert.equal(gone.ok, false);
  assert.equal(notified?.availability, "disconnected");
  // 단절 상태에서 다른 창의 publish도 실패고 어떤 상태도 current로 가지 않는다.
  const other = await publisher.publish(state({ window_ref: "win-2" }));
  assert.equal(other.ok, false);
  assert.equal(calls.length, 0);
});
