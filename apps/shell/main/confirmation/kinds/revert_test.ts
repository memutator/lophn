import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { canonicalize } from "../canonical.ts";
import { contentBasis } from "../handle.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import {
  buildRevertGroups,
  newRevertId,
  type PreviewGroup,
  readRevert,
  REVERT_RUN,
  revertState,
  submitRevert,
} from "./revert.ts";

const RUN = id("run", 1);
const DOC = id("doc", 1);
const DOC_B = id("doc", 2);
const VER_1 = id("ver", 1);
const VER_2 = id("ver", 2);
const PREVIEW = "p".repeat(64);

const restore = {
  ordinal: 0,
  owner: "documents/versions",
  target: DOC,
  source_seqs: ["5"],
  capability: "reversible",
  reason: null,
  comparison: {
    kind: "restore",
    document: DOC,
    base_version: VER_2,
    base_revision: "4",
    restore_version: VER_1,
  },
  before_ref: { version: VER_1 },
  dependencies: [],
  app_revert: null,
};
const later = {
  ordinal: 1,
  owner: "documents/versions",
  target: DOC_B,
  source_seqs: ["6"],
  capability: "conflict",
  reason: "later_change",
  comparison: { kind: "document" },
  before_ref: null,
  dependencies: [],
  app_revert: null,
};
const fact = {
  ordinal: 2,
  owner: "lophn-agent/questions",
  target: null,
  source_seqs: ["7"],
  capability: "retained",
  reason: "audit_fact",
  comparison: null,
  before_ref: null,
  dependencies: [],
  app_revert: null,
};

function preview(groups: unknown[]) {
  return () => ok({ run: RUN, groups, binding_hash: PREVIEW });
}

let serial = 0;
const state = () => revertState(() => id("rvt", ++serial));

test("lophn-agent/revert#R3, lophn-agent/revert#R7: 복원 가능·유지·충돌을 묶음마다 보이고 안전하지 않은 묶음은 기본 적용에서 빼고 2차 확인을 둔다", async () => {
  const revert = state();
  const mixed = await readRevert(
    fakeCore({ "read:reverts/preview": preview([restore, later, fact]) }),
    revert,
    "cfw_1",
    RUN,
  );
  assert.equal(mixed.ok, true);
  if (!mixed.ok) return;
  const view = mixed.value.view!;
  assert.equal(view.allow_partial, true);
  assert.deepEqual(
    (view.groups as { capability: string; included: boolean }[]).map((
      group,
    ) => [group.capability, group.included]),
    [["reversible", true], ["conflict", false], ["retained", false]],
  );
  assert.equal(mixed.value.secondConfirm, true);
  assert.deepEqual(mixed.value.allowed, [REVERT_RUN]);
  const content = mixed.value.content as Record<string, unknown>;
  // handle은 RevertRun binding(id·run·allow_partial·preview_hash)에 묶이고 대상은 revert id다.
  assert.deepEqual(Object.keys(content).sort(), [
    "allow_partial",
    "id",
    "preview_hash",
    "run",
  ]);
  assert.equal(mixed.value.targetRef, content.id);
  assert.equal(content.preview_hash, PREVIEW);
  // 같은 창의 다시 읽기는 같은 id, 다른 창은 다른 id다.
  const again = await readRevert(
    fakeCore({ "read:reverts/preview": preview([restore, later, fact]) }),
    revert,
    "cfw_1",
    RUN,
  );
  assert.equal(
    again.ok && (again.value.content as { id: string }).id,
    content.id,
  );
  const other = await readRevert(
    fakeCore({ "read:reverts/preview": preview([restore]) }),
    revert,
    "cfw_2",
    RUN,
  );
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.notEqual((other.value.content as { id: string }).id, content.id);
  // 모두 복원 가능하면 부분 적용도 2차 확인도 없다.
  assert.equal(
    (other.value.content as { allow_partial: boolean }).allow_partial,
    false,
  );
  assert.equal(other.value.secondConfirm, false);
  // 복원 가능한 것이 없으면 고를 결정이 없다.
  const none = await readRevert(
    fakeCore({ "read:reverts/preview": preview([later, fact]) }),
    revert,
    "cfw_3",
    RUN,
  );
  assert.equal(none.ok && none.value.allowed.length, 0);
});

test("lophn-agent/revert#R9: 입력 groups는 buildRevertInput 규칙이다(준비 결과는 comparison.prepared, prepared_ref는 그 hash)", async () => {
  const groups = [restore, fact] as unknown as PreviewGroup[];
  const asked: number[] = [];
  const built = await buildRevertGroups(groups, (group) => {
    asked.push(group.ordinal);
    return Promise.resolve({ ok: true, value: { token: "p" } });
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(asked, [0]);
  const hash = createHash("sha256").update(canonicalize({ token: "p" }))
    .digest("hex");
  assert.equal(built.value[0]!.prepared_ref, hash);
  assert.deepEqual(built.value[0]!.comparison, {
    ...restore.comparison,
    prepared: { token: "p" },
  });
  assert.deepEqual(built.value[1], {
    source_seqs: ["7"],
    comparison: {},
    prepared_ref: null,
  });
  const none = await buildRevertGroups(
    [restore] as unknown as PreviewGroup[],
    () => Promise.resolve({ ok: true, value: null }),
  );
  assert.equal(none.ok && none.value[0]!.prepared_ref, null);
});

test("lophn-agent/revert#R5, lophn-agent/revert#R6: 제출은 이전 판을 사람 자격으로 준비해 RevertRun에 싣고 실제 결과를 돌려준다", async () => {
  const revert = state();
  const prepared = {
    preparation_ref: "prep-1",
    document: DOC,
    base_version: VER_2,
  };
  const core = fakeCore({
    "read:reverts/preview": preview([restore, later]),
    "read:documents/get": () =>
      ok({
        version: {
          id: VER_1,
          format: { name: "document", module_hash: "m".repeat(64) },
          files: [{
            path: "a.md",
            blob_hash: "f".repeat(64),
            bytes: 10,
            media_type: "text/markdown",
            primary: true,
          }],
        },
      }),
    "worker:documents/prepare": () => ok(prepared),
    "command:reverts/apply": () =>
      ok({
        id: "x",
        run: RUN,
        outcome: "partial",
        result_seq: "30",
        replayed: false,
      }),
  });
  const read = await readRevert(core, revert, "cfw_1", RUN);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const content = read.value.content as Record<string, unknown>;
  const sent = await submitRevert(core, revert, {
    handle: handle("cfw_1"),
    content,
  });
  assert.deepEqual(sent, {
    ok: true,
    value: {
      receipt: { kind: "entity", id: content.id },
      result: "partial",
    },
  });
  const prepare = core.calls.find((call) => call.method === "prepare")!;
  const body = prepare.body as {
    document: string;
    base_version: string;
    files: { content: { kind: string; reference: { owner_key: string } } }[];
  };
  assert.equal(body.document, DOC);
  assert.equal(body.base_version, VER_2);
  assert.equal(body.files[0]!.content.kind, "existing");
  assert.equal(body.files[0]!.content.reference.owner_key, `${VER_1}/a.md`);
  const apply = core.calls.find((call) => call.method === "apply")!
    .body as Record<string, unknown>;
  const input = apply.input as Record<string, unknown>;
  assert.equal(input.allow_partial, true);
  assert.equal(input.preview_hash, PREVIEW);
  const groups = input.groups as {
    comparison: Record<string, unknown>;
    prepared_ref: string | null;
  }[];
  assert.deepEqual(groups[0]!.comparison.prepared, prepared);
  assert.equal(groups[0]!.prepared_ref, contentBasis(prepared));
  assert.equal(groups[1]!.prepared_ref, null);
  assert.deepEqual(apply.prepared, ["prep-1"]);
  assert.deepEqual(apply.compare, { preview_hash: PREVIEW });
  assert.equal(apply.confirmation, "H".repeat(43));
  // 본 preview와 다른 지문이면 보내지 않는다.
  const before = core.calls.length;
  const stale = await submitRevert(core, revert, {
    handle: handle("cfw_1"),
    content: { ...content, preview_hash: "q".repeat(64) },
  });
  assert.equal(stale.ok, false);
  assert.equal(core.calls.length, before);
});

const appStep = {
  ordinal: 0,
  owner: "apps/invocations",
  target: id("tcl", 1),
  source_seqs: ["5", "6"],
  capability: "reversible",
  reason: null,
  comparison: { kind: "app", app: id("app", 1), command: "add_todo" },
  before_ref: { kind: "app" },
  dependencies: [],
  app_revert: { step_key: "x" },
};

async function submitApp(
  applied: { outcome: string },
  ran: (() => ReturnType<typeof ok>) | undefined,
) {
  const core = fakeCore({
    "read:reverts/preview": preview([appStep]),
    "command:reverts/apply": () =>
      ok({ id: "x", run: RUN, result_seq: null, replayed: false, ...applied }),
    ...(ran === undefined ? {} : { "memory:reverts/run_apps": ran }),
  });
  const revert = state();
  const read = await readRevert(core, revert, "cfw_1", RUN);
  assert.equal(read.ok, true);
  if (!read.ok) return { core, sent: undefined };
  const sent = await submitRevert(core, revert, {
    handle: handle("cfw_1"),
    content: read.value.content as Record<string, unknown>,
  });
  return { core, sent, content: read.value.content as { id: string } };
}

test("lophn-agent/revert#R10: 앱 단계가 있어 applying으로 접수되면 core의 run_apps로 이어 실행하고 끝낸 revert의 실제 결과를 돌려준다", async () => {
  const { core, sent, content } = await submitApp(
    { outcome: "applying" },
    () => ok({ revert: "x", outcome: "partial", called: ["a"] }),
  );
  assert.deepEqual(sent, {
    ok: true,
    value: {
      receipt: { kind: "entity", id: content!.id },
      result: "partial",
    },
  });
  const ran = core.calls.find((call) => call.method === "run_apps")!;
  assert.equal(ran.kind, "memory");
  assert.equal(ran.resource, "reverts");
  const body = ran.body as { revert: string; groups: unknown[] };
  assert.equal(body.revert, content!.id);
  assert.equal(body.groups.length, 1);
  // 이어 실행이 닿지 못하면 접수 결과(applying) 그대로이고 같은 revert를 다시 이어 받을 수 있다.
  const lost = await submitApp({ outcome: "applying" }, () => ({
    ok: false,
    error: { code: "unavailable", message: "no" },
  }));
  assert.deepEqual(lost.sent, {
    ok: true,
    value: {
      receipt: { kind: "entity", id: lost.content!.id },
      result: "applying",
    },
  });
  // 앱 단계가 없어 이미 확정된 revert는 이어 실행하지 않는다.
  const done = await submitApp({ outcome: "applied" }, undefined);
  assert.equal(
    done.core.calls.some((call) => call.method === "run_apps"),
    false,
  );
});

test("lophn-agent/revert#R2: revert id는 rvt 접두사의 고정 ID 모양이다", () => {
  const made = newRevertId(1_700_000_000_000, (bytes) => bytes.fill(7));
  assert.match(made, /^rvt_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
});
