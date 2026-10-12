// 마지막 탭을 닫으면 이전 보기가 빈 보기로 바뀐다(shell/workspace#R9, prompt-assemble#R28).
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLiveView } from "./live-view.ts";
import type { CoreSessionLike } from "./view-publish.ts";

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-10T00:00:00.000Z";

test("shell/workspace#R9 prompt-assemble#R28: 마지막 탭을 닫으면 빈 보기를 publish해 닫힌 탭이 지금 열린 탭으로 남지 않고 이미 빈 보기는 다시 보내지 않는다", async () => {
  const published: { tab_pages: unknown[] }[] = [];
  const session: CoreSessionLike = {
    call(_kind, resource, method, body) {
      if (resource === "workspace" && method === "publish") {
        published.push(body as { tab_pages: unknown[] });
      }
      return Promise.resolve({ ok: true, value: {} });
    },
  };
  const live = createLiveView({
    session: () => session,
    isLive: () => true,
    views: () => [],
    now: () => AT,
  });
  const hint = (tabs: unknown[]) => ({
    project: PRJ,
    panes: [{ tabs, selected: tabs.length === 0 ? null : "t1" }],
    focused_pane: 0,
  });
  // 처음부터 빈 보기는 보내지 않는다.
  await live.hint("win-1", hint([]));
  assert.equal(published.length, 0);
  await live.hint(
    "win-1",
    hint([{ kind: "terminal", key: "t1", project_folder: "work" }]),
  );
  assert.equal(published.length, 1);
  assert.equal(published[0]!.tab_pages.length, 1);
  // 닫으면 빈 보기로 바뀐다.
  await live.hint("win-1", hint([]));
  assert.equal(published.length, 2);
  assert.deepEqual(published[1]!.tab_pages, []);
  // 이미 빈 보기는 같은 상태를 다시 보내지 않는다.
  await live.hint("win-1", hint([]));
  assert.equal(published.length, 2);
});
