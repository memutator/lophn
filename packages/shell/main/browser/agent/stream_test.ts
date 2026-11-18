import assert from "node:assert/strict";
import { test } from "node:test";

import type { HostFrame } from "../../../../protocol/host-link/mod.ts";
import { createTabControl } from "./control.ts";
import { type BrowserCallPayload, createBrowserDriver } from "./driver.ts";
import type { Page } from "./page.ts";
import { createPageStream } from "./stream.ts";

const TAB = "tab_01hzzzzzzzzzzzzzzzzzzzzzzz";

test("멀리서 잡은 동안 agent의 act·navigate·evaluate가 conflict이고 놓으면 다시 된다", async () => {
  const page: Page = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    isLoading: () => false,
    url: () => "https://example.test/",
    title: () => "page",
    attach: () => {},
    detach: () => {},
    emulated: () => false,
    subscribe: () => {},
    send: ((method: string) =>
      Promise.resolve(
        method === "Runtime.evaluate"
          ? { result: { value: [800, 600] } }
          : method === "Accessibility.getFullAXTree"
            ? { nodes: [] }
            : {},
      )) as Page["send"],
  };
  const frames: HostFrame[] = [];
  let stream: ReturnType<typeof createPageStream> | undefined;
  const control = createTabControl((tab, state) =>
    stream?.controlChanged(tab, state),
  );
  stream = createPageStream({
    page: () => page,
    control,
    send: (frame) => frames.push(frame) > 0,
    nowMs: () => 0,
    schedule: () => () => {},
  });
  const driver = createBrowserDriver({
    viewSession: () => "wv-1",
    releaseLogin: () => Promise.reject(new Error("no login")),
    lookup: { guest: () => page, app: () => undefined, artifact: () => page },
    control,
    nowMs: () => 0,
  });
  const run = (action: BrowserCallPayload["action"]) =>
    driver.run({ tab: TAB, view: "browser", action });
  const writes: BrowserCallPayload["action"][] = [
    { kind: "act", act: { type: "scroll", dy: 100 } },
    { kind: "navigate", url: "https://example.test/next" },
    { kind: "evaluate", expression: "1" },
  ];
  const codes = async () => {
    const out = [];
    for (const action of writes) {
      const result = await run(action);
      out.push("error" in result ? result.error.code : "ok");
    }
    return out;
  };

  // agent가 다루기 시작한 탭을 멀리서 보는 중이다.
  assert.ok(!("error" in (await run({ kind: "snapshot" }))));
  await stream.stream({ tab: TAB, on: true });

  assert.deepEqual(await stream.control({ tab: TAB, held: true }), {
    content: [{ type: "text", text: "ok" }],
  });
  assert.deepEqual(await codes(), ["conflict", "conflict", "conflict"]);
  assert.ok(!("error" in (await run({ kind: "snapshot" }))));
  assert.deepEqual(frames.at(-1), {
    type: "page_state",
    tab: TAB,
    painting: true,
    agent: true,
    held: true,
  });

  await stream.control({ tab: TAB, held: false });
  assert.deepEqual(await codes(), ["ok", "ok", "ok"]);
  assert.equal(control.held(TAB), false);
});
