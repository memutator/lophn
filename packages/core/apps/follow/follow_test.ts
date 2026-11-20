import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok } from "../../../base/mod.ts";
import type { AppGrant, ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { createActivationHandlers } from "../releases/activation/handler.ts";
import { compareForActivation } from "../releases/compare.ts";
import { createFollow } from "./follow.ts";
import { chooseRelease, type OfferedRelease } from "./order.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav" as Id<"app">;
const A = "mch_01arz3ndektsv4rrffq69g5fa1" as Id<"mch">;
const B = "mch_01arz3ndektsv4rrffq69g5fa2" as Id<"mch">;
const commit = (c: string) => c.repeat(40);

// 작은 git 기록: p ← c0 ← c1 ← c2, 그리고 c0 ← x(c1과 갈라짐), p ← y(c0과 갈라짐). m은 이 저장소에 아직 없다.
const PARENT: Record<string, string | null> = {
  [commit("0")]: commit("9"),
  [commit("9")]: null,
  [commit("8")]: commit("9"),
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
  code_commit: commit("0"),
  data_schema: 2,
};
const offer = (
  code: string,
  extra: Partial<OfferedRelease> = {},
): OfferedRelease => ({
  machine: A,
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
    want: { kind: string; commit?: string; machine?: Id<"mch"> };
  }[] = [
    {
      name: "일직선",
      offered: [offer("1")],
      want: { kind: "target", commit: commit("1") },
    },
    {
      name: "건너뛰기",
      offered: [offer("1"), offer("2", { machine: B })],
      want: { kind: "target", commit: commit("2") },
    },
    {
      name: "조상(옛 기계)",
      offered: [offer("9")],
      want: { kind: "current" },
    },
    {
      name: "같은 commit은 후보가 아니다",
      offered: [offer("0", { machine: B })],
      want: { kind: "current" },
    },
    {
      name: "갈라짐",
      offered: [
        offer("1"),
        offer("7", { machine: B, created_at: "2026-11-11T00:00:00.000Z" }),
      ],
      want: { kind: "diverged", commit: commit("7") },
    },
    {
      name: "이 기계와 갈라짐(그 기계가 따로 release를 냈다)",
      offered: [offer("8")],
      want: { kind: "diverged", commit: commit("8") },
    },
    {
      name: "낮은 data schema",
      offered: [offer("1", { data_schema: 1 })],
      want: { kind: "current" },
    },
    {
      name: "superseded(이 기계가 내려놓았다)",
      offered: [offer("1")],
      dropped: [commit("1")],
      want: { kind: "current" },
    },
    {
      name: "failed는 건너뛰고 그 앞 release로 간다",
      offered: [offer("1"), offer("2", { machine: B })],
      dropped: [commit("2")],
      want: { kind: "target", commit: commit("1") },
    },
    {
      name: "commit이 아직 없다",
      offered: [offer("5")],
      want: { kind: "current" },
    },
    {
      name: "같은 commit을 두 기계가 냈으면 먼저 활성된 쪽",
      offered: [
        offer("1", { created_at: "2026-11-12T00:00:00.000Z" }),
        offer("1", { machine: B, created_at: "2026-11-11T00:00:00.000Z" }),
      ],
      want: { kind: "target", commit: commit("1"), machine: B },
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
        ...(choice.kind === "current"
          ? {}
          : { commit: choice.release.code_commit }),
        ...(one.want.machine === undefined
          ? {}
          : {
              machine:
                choice.kind === "current" ? undefined : choice.release.machine,
            }),
      },
      one.want,
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
    "id" | "code_commit" | "status" | "failure"
  >[] = [
    {
      id: "rel_01arz3ndektsv4rrffq69g5fb0" as never,
      code_commit: commit("0"),
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
    offered: () => [offer("1", { machine: B })],
    releases: () => ok(rows),
    consent: (release) => consents.get(release) ?? null,
    isAncestor: (_source, a, d) => isAncestor(a, d),
    takeIn(input) {
      const id = "rel_01arz3ndektsv4rrffq69g5fb1";
      rows.push({
        id: id as never,
        code_commit: input.release,
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
    release: commit("1"),
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

test("dependency_missing으로 멈춘 따라가기는 retryDependencies 뒤 다시 시도해 성공한다", async () => {
  const rows: Pick<
    ReleaseRecord,
    "id" | "code_commit" | "status" | "failure"
  >[] = [
    {
      id: "rel_01arz3ndektsv4rrffq69g5fb0" as never,
      code_commit: commit("0"),
      status: "active",
      failure: null,
    },
  ];
  let packageArrived = false;
  let attempts = 0;
  const activated: string[] = [];
  const follow = createFollow({
    apps: () => [{ app: APP, source_path: "/src", release: CURRENT }],
    offered: () => [offer("1", { machine: B })],
    releases: () => ok(rows),
    consent: () => null,
    isAncestor: (_source, a, d) => isAncestor(a, d),
    async takeIn(input) {
      attempts += 1;
      if (!packageArrived) {
        return err({
          code: "conflict",
          message: "@me/shared@1.0.0 is not published on this machine",
          details: {
            reason: "dependency_missing",
            packages: ["@me/shared@1.0.0"],
          },
        });
      }
      const id = "rel_01arz3ndektsv4rrffq69g5fb1";
      rows.push({
        id: id as never,
        code_commit: input.release,
        status: "prepared",
        failure: null,
      });
      return ok({ release: id });
    },
    async activate(id) {
      activated.push(id);
      return ok({
        status: "active" as const,
        release: id as never,
        previous_release: null,
      });
    },
  });

  await follow.sweep(APP);
  assert.equal(attempts, 1);
  assert.equal(follow.state(APP).state, "install_failed");

  // package가 오기 전에는 같은 commit을 반복 시도하지 않는다.
  await follow.sweep(APP);
  assert.equal(attempts, 1);

  // package가 도착해 retryDependencies가 불리면 다시 시도해 활성화한다.
  packageArrived = true;
  follow.retryDependencies();
  await follow.sweep(APP);
  assert.equal(attempts, 2);
  assert.deepEqual(activated, ["rel_01arz3ndektsv4rrffq69g5fb1"]);
  assert.equal(follow.state(APP).state, "current");
});
