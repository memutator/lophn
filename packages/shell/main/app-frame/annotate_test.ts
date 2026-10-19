import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnnotateViewPort, PickedItem } from "../../ipc/annotation.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import { createAnnotate } from "./annotate.ts";

const APP = "app_00000000000000000000000001";
const RELEASE = "rel_00000000000000000000000001";
const SESSION = "ses_00000000000000000000000001";

function item(n: number, note: string): PickedItem {
  return {
    n,
    kind: "element",
    note,
    component: "DataTable",
    element: { role: "row", name: "#1", text: null },
    rect: {
      x_ratio: 0.1,
      width_ratio: 0.2,
      y_px: 10,
      height_px: 20,
      scroll_x: 0,
      scroll_y: 0,
    },
    path: "/orders",
  };
}

function setup(opts: { captureFails?: boolean; uploadFails?: boolean } = {}) {
  const shell: CallerContents = {
    id: 1,
    isDestroyed: () => false,
    mainFrame: { parent: null, url: "lophn://desktop/index.html" },
  };
  const registry = new ContentsRegistry();
  registry.register({
    contents: shell,
    origin: { scheme: "lophn", host: "desktop", path: "/index.html" },
  });
  const shellEvent: IpcEvent = { sender: shell, senderFrame: shell.mainFrame };
  const pageContents: CallerContents = {
    id: 2,
    isDestroyed: () => false,
    mainFrame: { parent: null, url: "app://x/" },
  };
  const pageEvent: IpcEvent = {
    sender: pageContents,
    senderFrame: pageContents.mainFrame,
  };
  const strangerEvent: IpcEvent = {
    sender: { ...pageContents, id: 3 },
    senderFrame: pageContents.mainFrame,
  };

  const sentCalls: unknown[] = [];
  const uploads: unknown[] = [];
  const later: { annotate?: ReturnType<typeof createAnnotate> } = {};
  const port: AnnotateViewPort = {
    view_session: "view-1",
    target: { kind: "app", app: APP, release: RELEASE, screen: "orders" },
    pageUrl: () => null,
    current: () => true,
    send(channel, payload) {
      if (channel === "annotate:prepare-capture") {
        const { n } = payload as { n: number };
        queueMicrotask(() =>
          later.annotate?.captureReady(pageEvent, {
            n,
            crop: { x: 0, y: 0, width: 50, height: 50 },
            viewport: { width: 100, height: 100 },
          })
        );
      }
    },
    capture: () =>
      opts.captureFails
        ? Promise.reject(new Error("no capture"))
        : Promise.resolve(new Uint8Array([1, 2, 3])),
  };
  const annotate = createAnnotate({
    registry,
    windowOf: (sender) => sender === shell ? "window-1" : undefined,
    owner: (view) => view === "view-1" ? "window-1" : undefined,
    view: (view) => view === "view-1" ? port : undefined,
    senderView: (id) => id === 2 ? port : undefined,
    pushState: () => {},
    core: {
      call: (_kind, _resource, _method, body) => {
        sentCalls.push(body);
        return Promise.resolve({ ok: true, value: { session: SESSION } });
      },
      upload: (_resource, _method, body) => {
        uploads.push(body);
        return Promise.resolve(
          opts.uploadFails
            ? { ok: false, error: { code: "unavailable", message: "down" } }
            : {
              ok: true,
              value: {
                preparation: "p",
                principal: "u",
                purpose: "annotation_screenshot",
                hash: "a".repeat(64),
                size_bytes: 3,
              },
            },
        );
      },
    },
    cropAndFit: (png) => png,
  });
  later.annotate = annotate;
  return { annotate, shellEvent, pageEvent, strangerEvent, sentCalls };
}

test("앱 view가 아닌 sender가 보낸 고르기 IPC는 무시되고, 앱·release·screen은 sender view에서 정한 값으로만 core에 간다", async () => {
  const { annotate, shellEvent, pageEvent, strangerEvent, sentCalls } = setup();
  annotate.items(strangerEvent, { items: [item(1, "stranger")] });
  const empty = await annotate.send(shellEvent, {
    view_session: "view-1",
    session: null,
  });
  assert.equal(empty.ok, false);

  annotate.items(pageEvent, { items: [item(1, "mine")] });
  // 페이지가 앱·release를 끼워 보내면 strict schema에서 버려진다.
  annotate.items(pageEvent, {
    items: [{ ...item(2, "forged"), app: "x", release: "y" }],
  });
  const sent = await annotate.send(shellEvent, {
    view_session: "view-1",
    session: SESSION,
  });
  assert.equal(sent.ok, true);
  const body = sentCalls[0] as {
    target: unknown;
    session: string;
    annotations: { note: string; release: string; view: unknown }[];
  };
  assert.deepEqual(body.target, { kind: "app", app: APP });
  assert.equal(body.session, SESSION);
  assert.deepEqual(body.annotations.map((a) => a.note), ["mine"]);
  assert.equal(body.annotations[0]?.release, RELEASE);
  assert.deepEqual(body.annotations[0]?.view, {
    screen: "orders",
    path: "/orders",
  });
});

test("capture나 upload가 실패해도 모은 목록과 메모는 screenshot 없이 보내진다", async () => {
  for (const opts of [{ captureFails: true }, { uploadFails: true }]) {
    const { annotate, shellEvent, pageEvent, sentCalls } = setup(opts);
    annotate.items(pageEvent, { items: [item(1, "a"), item(3, "c")] });
    const sent = await annotate.send(shellEvent, {
      view_session: "view-1",
      session: null,
    });
    assert.equal(sent.ok, true);
    const { annotations } = sentCalls[0] as {
      annotations: { n: number; note: string; screenshot: unknown }[];
    };
    // 지운 번호는 묶음 안에서 1..N으로 메운다.
    assert.deepEqual(annotations.map((a) => [a.n, a.note, a.screenshot]), [
      [1, "a", null],
      [2, "c", null],
    ]);
  }
});
