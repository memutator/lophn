import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createViewDiagnostics,
  VIEW_DIAGNOSTIC_COMPONENT,
} from "./diagnostics.ts";

test("shell/app-frame#R22: view 수명은 view_session·generation과 개수만 감독 통로에 싣고 log에는 앱·release를 함께 둔다", () => {
  const sent: unknown[] = [];
  const logs: string[] = [];
  let reachable = true;
  const diagnostics = createViewDiagnostics({
    send(message) {
      sent.push(message);
      return reachable;
    },
    log: (line) => logs.push(line),
    clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
  });
  const view = {
    view_session: "view-1",
    generation: 1,
    app: "app_01j9zzzzzzzzzzzzzzzzzzzzzz",
    release: "rel_01j9zzzzzzzzzzzzzzzzzzzzz1",
    mode: "live",
  };
  diagnostics.record(view, "created");
  diagnostics.record(view, "attached");
  reachable = false;
  diagnostics.record({ ...view, generation: 2, release: null }, "disposed");
  diagnostics.record({ ...view, generation: 1 }, "created");
  assert.deepEqual(sent[0], {
    type: "diagnostic",
    kind: "shell_view_lifetime",
    payload: {
      component: VIEW_DIAGNOSTIC_COMPONENT,
      observed_at: "2026-10-06T00:00:00.000Z",
      view_id: "view-1",
      generation: 1,
      created: 1,
      hidden: 0,
      replaced: 0,
      disposed: 0,
      attached: 0,
    },
  });
  assert.deepEqual(
    sent.map((message) => {
      const payload = (message as { payload: Record<string, number> }).payload;
      return [
        payload.generation,
        payload.created,
        payload.attached,
        payload.disposed,
      ];
    }),
    [[1, 1, 0, 0], [1, 1, 1, 0], [2, 1, 1, 1], [1, 1, 0, 0]],
  );
  assert.deepEqual(logs, [
    `view view-1 generation=1 created app=${view.app} release=${view.release} mode=live`,
    `view view-1 generation=1 attached app=${view.app} release=${view.release} mode=live`,
    `view view-1 generation=2 disposed app=${view.app} release=none mode=live diagnostic=unsent`,
    `view view-1 generation=1 created app=${view.app} release=${view.release} mode=live diagnostic=unsent`,
  ]);
});
