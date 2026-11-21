import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import type { WorkspaceRef } from "../shell/desk-model.ts";
import {
  announceHanded,
  canDropOn,
  canHand,
  handTab,
  handTargets,
  takeBack,
} from "./hand.ts";
import type { TabItem } from "./model.ts";

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fd01";
const PROJECT: WorkspaceRef = { kind: "project", id: PRJ };
const A = "ses_01h455vb4pex5v6nkc6gd5aa01";
const B = "ses_01h455vb4pex5v6nkc6gd5bb02";
const OLD = "tab_01h455vb4pex5v6nkc6gd5tt01";
const NEW = "tab_01h455vb4pex5v6nkc6gd5tt02";

const browser = (extra: Partial<TabItem> = {}): TabItem => ({
  key: "browser-1",
  kind: "browser",
  title: "Billing",
  fields: { url: "https://pay.test/billing" },
  ...extra,
});

function fakeCore(reply: (call: CoreCall) => CoreReply) {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      call(input: CoreCall) {
        calls.push(input);
        return Promise.resolve(reply(input));
      },
    },
  };
}

function recorder() {
  const patches: { key: string; patch: Partial<TabItem> }[] = [];
  const reports: string[] = [];
  return {
    patches,
    reports,
    patch: (key: string, patch: Partial<TabItem>) =>
      void patches.push({ key, patch }),
    report: (tab: string) => void reports.push(tab),
  };
}

test("넘길 수 있는 탭은 사람이 연 browser 탭뿐이다", () => {
  assert.equal(canHand(browser()), true);
  assert.equal(canHand(browser({ owner: A, handedTab: OLD })), true);
  assert.equal(canHand(browser({ transient: true })), false);
  assert.equal(canHand(browser({ fields: { url: "", native: true } })), false);
  // agent나 사람 token이 `tab open`으로 연 탭
  assert.equal(canHand(browser({ key: `host:${OLD}`, owner: A })), false);
  assert.equal(canHand(browser({ key: `host:${OLD}` })), false);
  assert.equal(canHand(browser({ kind: "document_editor" })), false);
});

test("다시 알리기는 owner와 handedTab이 둘 다 있는 browser 탭만 그 주인으로 알리고 not_found·conflict면 되돌린다", async () => {
  const codes: Record<string, string | null> = {
    "b-gone": "not_found",
    "b-agent": "conflict",
    "b-down": "unavailable",
    "b-ok": null,
  };
  const keyOf = new Map<string, string>();
  const { calls, core } = fakeCore((call) => {
    const body = call.body as { tab: string };
    const code = codes[keyOf.get(body.tab)!] ?? null;
    return code === null
      ? { ok: true, value: { tab: body.tab } }
      : { ok: false, error: { code, message: "" } };
  });
  const tabs = Object.keys(codes).map((key, n) => {
    const id = `tab_01h455vb4pex5v6nkc6gd5tq0${n}`;
    keyOf.set(id, key);
    return browser({ key, owner: A, handedTab: id });
  });
  const never = [
    browser({ key: "person" }),
    browser({ key: "only-owner", owner: A }),
    browser({ key: "only-id", handedTab: NEW }),
    { ...browser({ key: "doc", owner: A, handedTab: NEW }), kind: "terminal" },
  ];
  const seen = recorder();
  await announceHanded(
    core,
    [...tabs, ...never].map((tab) => ({
      tab,
      workspace: PROJECT,
      patch: seen.patch,
    })),
    seen.report,
  );
  assert.deepEqual(
    calls.map((call) => {
      const body = call.body as { tab: string; session: string };
      return [keyOf.get(body.tab), body.session];
    }),
    Object.keys(codes).map((key) => [key, A]),
  );
  assert.deepEqual(seen.patches.map((one) => [one.key, one.patch]).sort(), [
    ["b-agent", { owner: undefined, handedTab: undefined }],
    ["b-gone", { owner: undefined, handedTab: undefined }],
  ]);
});

test("넘기기가 실패하면 탭과 앞 주인의 손은 그대로다", async () => {
  const { core } = fakeCore(() => ({
    ok: false,
    error: { code: "not_found", message: "session not found" },
  }));
  const seen = recorder();
  const ok = await handTab(
    core,
    browser({ owner: A, handedTab: OLD }),
    B,
    PROJECT,
    seen.patch,
    seen.report,
  );
  assert.equal(ok, false);
  assert.deepEqual(seen.patches, []);
  assert.deepEqual(seen.reports, []);
});

test("다른 session에 다시 넘기면 새 id로 넘기고 앞 id를 먼저 닫는다", async () => {
  const { calls, core } = fakeCore(() => ({ ok: true, value: { tab: NEW } }));
  const seen = recorder();
  const ok = await handTab(
    core,
    browser({ owner: A, handedTab: OLD }),
    B,
    PROJECT,
    seen.patch,
    seen.report,
  );
  assert.equal(ok, true);
  assert.equal((calls[0]!.body as { tab?: string }).tab, undefined);
  assert.deepEqual(seen.reports, [OLD]);
  assert.deepEqual(seen.patches, [
    { key: "browser-1", patch: { owner: B, handedTab: NEW } },
  ]);
});

test("되찾기는 주인과 core 탭 id를 지우고 그 id를 닫혔다고 알린다", () => {
  const seen = recorder();
  takeBack(browser({ owner: A, handedTab: OLD }), seen.patch, seen.report);
  assert.deepEqual(seen.patches, [
    { key: "browser-1", patch: { owner: undefined, handedTab: undefined } },
  ]);
  assert.deepEqual(seen.reports, [OLD]);
});

test("끌어 놓기는 Hand to가 내놓는 열린 이 컴퓨터 session에만 된다", () => {
  const entry = (
    session: string,
    extra: Partial<SessionEntry> = {},
  ): SessionEntry => ({
    session,
    state: "idle",
    archived: false,
    ended: null,
    agent: `lophn_${PRJ}` as SessionEntry["agent"],
    workspace: { kind: "project", id: PRJ },
    spawnedBy: null,
    unseen: false,
    ...extra,
  });
  const ENDED = "ses_01h455vb4pex5v6nkc6gd5ee03";
  const ARCHIVED = "ses_01h455vb4pex5v6nkc6gd5ar04";
  const HOME = "ses_01h455vb4pex5v6nkc6gd5ho05";
  const REMOTE = "ses_01h455vb4pex5v6nkc6gd5re06";
  const targets = handTargets(
    [
      entry(HOME, { workspace: null }),
      entry(A),
      entry(B),
      entry(ENDED, { ended: "exited" }),
      entry(ARCHIVED, { archived: true }),
    ],
    PROJECT,
    A,
    (session) => session,
  );
  // 지금 workspace의 것이 먼저이고 지금 주인은 빠진다.
  assert.deepEqual(
    targets.map((target) => target.session),
    [B, HOME],
  );
  const tab = browser({ owner: A, handedTab: OLD });
  assert.equal(canDropOn(tab, B, targets), true);
  for (const session of [A, ENDED, ARCHIVED, REMOTE]) {
    assert.equal(canDropOn(tab, session, targets), false, session);
  }
  assert.equal(canDropOn(browser({ key: `host:${OLD}` }), B, targets), false);
});
