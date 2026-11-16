import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import type { AppGrant, ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { createActivationHandlers } from "../releases/activation/handler.ts";
import { compareForActivation } from "../releases/compare.ts";
import { createFollow } from "./follow.ts";
import { chooseRelease, type OfferedRelease } from "./order.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav" as Id<"app">;
const A = "mch_01arz3ndektsv4rrffq69g5fa1" as Id<"mch">;
const B = "mch_01arz3ndektsv4rrffq69g5fa2" as Id<"mch">;
const hash = (c: string) => c.repeat(64);
const commit = (c: string) => c.repeat(40);

// 작은 git 기록: p ← c0 ← c1 ← c2, 그리고 c0 ← x(c1과 갈라짐). m은 이 저장소에 아직 없다.
const PARENT: Record<string, string | null> = {
  [commit("0")]: commit("9"),
  [commit("9")]: null,
  [commit("1")]: commit("0"),
  [commit("2")]: commit("1"),
  [commit("7")]: commit("0"),
};
async function isAncestor(ancestor: string, descendant: string) {
  if (!(descendant in PARENT)) return ok("missing" as const);
  for (let at: string | null = descendant; at !== null; at = PARENT[at]!) {
    if (at === ancestor) return ok(true);
  }
  return ok(false);
}

const CURRENT = {
  bundle_hash: hash("a"),
  code_commit: commit("0"),
  data_schema: 2,
};
const offer = (
  bundle: string,
  code: string,
  extra: Partial<OfferedRelease> = {},
): OfferedRelease => ({
  machine: A,
  bundle_hash: hash(bundle),
  code_commit: commit(code),
  data_schema: 2,
  created_at: "2026-11-10T00:00:00.000Z",
  ...extra,
});

test("옛 기계의 release와 이 기계가 내려놓은 release는 목표가 되지 않고, 갈라진 release가 있으면 아무것도 고르지 않는다", async () => {
  const cases: {
    name: string;
    offered: OfferedRelease[];
    dropped?: string[];
    want: { kind: string; bundle?: string };
  }[] = [
    {
      name: "일직선",
      offered: [offer("b", "1")],
      want: { kind: "target", bundle: hash("b") },
    },
    {
      name: "건너뛰기",
      offered: [offer("b", "1"), offer("c", "2", { machine: B })],
      want: { kind: "target", bundle: hash("c") },
    },
    {
      name: "조상(옛 기계)",
      offered: [offer("p", "9")],
      want: { kind: "current" },
    },
    {
      name: "같은 commit의 다른 bundle은 후보가 아니다",
      offered: [offer("s", "0")],
      want: { kind: "current" },
    },
    {
      name: "갈라짐",
      offered: [
        offer("b", "1"),
        offer("x", "7", { machine: B, created_at: "2026-11-11T00:00:00.000Z" }),
      ],
      want: { kind: "diverged", bundle: hash("x") },
    },
    {
      name: "낮은 data schema",
      offered: [offer("b", "1", { data_schema: 1 })],
      want: { kind: "current" },
    },
    {
      name: "superseded(이 기계가 내려놓았다)",
      offered: [offer("b", "1")],
      dropped: [hash("b")],
      want: { kind: "current" },
    },
    {
      name: "failed는 건너뛰고 그 앞 release로 간다",
      offered: [offer("b", "1"), offer("c", "2", { machine: B })],
      dropped: [hash("c")],
      want: { kind: "target", bundle: hash("b") },
    },
    {
      name: "commit이 아직 없다",
      offered: [offer("m", "5")],
      want: { kind: "current" },
    },
    {
      name: "같은 commit의 두 bundle은 먼저 활성된 쪽",
      offered: [
        offer("d", "1", { created_at: "2026-11-12T00:00:00.000Z" }),
        offer("e", "1", { machine: B, created_at: "2026-11-11T00:00:00.000Z" }),
      ],
      want: { kind: "target", bundle: hash("e") },
    },
  ];
  for (const one of cases) {
    const choice = await chooseRelease({
      current: CURRENT,
      offered: one.offered,
      dropped: new Set(one.dropped ?? []),
      isAncestor,
    });
    assert.deepEqual(
      {
        kind: choice.kind,
        bundle:
          choice.kind === "current" ? undefined : choice.release.bundle_hash,
      },
      { kind: one.want.kind, bundle: one.want.bundle },
      one.name,
    );
  }
});

test("따라가려는 release가 grant에 없는 바깥 자원을 요구하면 activation이 시작되지 않고 동의 줄만 선다", async () => {
  const net = (host: string) => ({
    kind: "net.fetch" as const,
    scope: { host, port: 443 },
    reason: "test",
  });
  const grant = {
    id: "grt_01arz3ndektsv4rrffq69g5fav",
    app: APP,
    scope: { kind: "net.fetch", host: "a.example", port: 443 },
    status: "active",
    created_at: "2026-10-16T00:00:00.000Z",
    revoked_at: null,
  } as AppGrant;
  const rows: Pick<
    ReleaseRecord,
    "id" | "bundle_hash" | "status" | "failure"
  >[] = [
    {
      id: "rel_01arz3ndektsv4rrffq69g5fb0" as never,
      bundle_hash: hash("a"),
      status: "active",
      failure: null,
    },
  ];
  const consents = new Map<string, "waiting" | "allowed">();
  const asked: string[] = [];
  const started: string[] = [];
  const handlers = createActivationHandlers({
    releases: {
      get: (id) =>
        ok(
          (rows.find((row) => row.id === id) as ReleaseRecord | undefined) ??
            null,
        ),
      comparison: () =>
        Promise.resolve(
          ok(
            compareForActivation({
              previous: { id: rows[0]!.id, data_schema: 2 },
              grants: [grant],
              // 새 release는 b.example도 부른다.
              facts: {
                permissions: [net("a.example"), net("b.example")],
                app_connections: [],
              },
              next: { data_changes: [] },
            }),
          ),
        ),
    },
    consents: {
      ask(release) {
        asked.push(release.id);
        consents.set(release.id, "waiting");
        return Promise.resolve(ok(undefined));
      },
    },
    enqueue(_app, release) {
      started.push(release);
      return ok(undefined);
    },
  });
  const follow = createFollow({
    apps: () => [{ app: APP, source_path: "/src", release: CURRENT }],
    offered: () => [offer("b", "1", { machine: B })],
    releases: () => ok(rows),
    consent: (release) => consents.get(release) ?? null,
    isAncestor: (_source, a, d) => isAncestor(a, d),
    takeIn(input) {
      const id = "rel_01arz3ndektsv4rrffq69g5fb1";
      rows.push({
        id: id as never,
        bundle_hash: input.release,
        status: "prepared",
        failure: null,
      });
      return Promise.resolve(ok({ release: id }));
    },
    async activate(id) {
      const release = {
        ...rows.find((row) => row.id === id)!,
        app: APP,
        data_changes: [],
      } as unknown as ReleaseRecord;
      const judged = await handlers.activate(release);
      if (!judged.ok) return judged;
      return ok(
        judged.value === "started"
          ? { status: "running" as const, release: id as never }
          : { status: "waiting_consent" as const, release: id as never },
      );
    },
  });

  await follow.sweep(APP);
  assert.deepEqual(asked, ["rel_01arz3ndektsv4rrffq69g5fb1"]);
  assert.deepEqual(started, []);
  assert.deepEqual(follow.state(APP), {
    state: "waiting_consent",
    release: hash("b"),
    reason: null,
  });

  // 줄이 서 있는 동안은 다시 묻지 않는다.
  await follow.sweep(APP);
  assert.equal(asked.length, 1);

  // 사람이 거절하면 이 core가 도는 동안 같은 release를 다시 묻지도 시작하지도 않는다.
  consents.delete("rel_01arz3ndektsv4rrffq69g5fb1");
  follow.consentClosed(APP, "rel_01arz3ndektsv4rrffq69g5fb1", "reject");
  await follow.sweep(APP);
  assert.equal(asked.length, 1);
  assert.deepEqual(started, []);
  assert.equal(follow.state(APP).state, "declined");
});
