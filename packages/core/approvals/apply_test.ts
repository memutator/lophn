// approval 한 번 사용의 공통 gate(platform/approvals#R5, R7, R11). 실제 ledger(임시 파일 SQLite)에서
// 시험 전용 소유 command(probe_test.ts)가 `Tx.useApproval`을 부른다. 소유 command 쪽 dispatch와
// 기한·run·권한까지 포함한 끝에서 끝까지는 packages/core/approvals/apply-flow_test.ts가 실제 core로 본다.
// 사람 허락은 decisions_test와 같은 handle 경로로 만든다.

import { assert, assertEquals } from "@std/assert";
import type { ApprovalAction } from "../../protocol/server/mod.ts";
import {
  action,
  APPROVAL,
  create,
  decide,
  decisionInput,
  failure,
  issue,
  type LedgerHarness,
  openHarness,
  statusOf,
  user,
  value,
} from "./requests_fixture_test.ts";

const OTHER = "apr_01h455vb4pex5v6nkc6gd5fdw2";
const USE_COUNT = "select count(*) as n from approval_uses";
const PROBED = "select count(*) as n from events where type = 'ApprovalProbed'";

async function grant(harness: LedgerHarness, id: string): Promise<void> {
  value(await create(harness, user, { id }));
  const input = await decisionInput(harness, id);
  value(
    await decide(
      harness,
      user,
      "grant",
      input,
      `grant-${id}`,
      await issue(harness, "grant", input),
    ),
  );
  assertEquals(await statusOf(harness, id), "granted");
}

function probe(
  harness: LedgerHarness,
  id: string,
  fixed: ApprovalAction,
  options: { seq?: string; concern?: string; key: string },
) {
  return harness.command(user, {
    command: "probe_use_approval",
    input: {
      approval: id,
      action: fixed,
      seq: options.seq ?? null,
      concern: options.concern ?? null,
    },
    idempotency_key: options.key,
    compare: {},
    prepared: [],
  });
}

async function n(harness: LedgerHarness, query: string): Promise<bigint> {
  return value(await harness.inspect(query))[0]["n"] as bigint;
}

Deno.test("platform/approvals#R7: 허락 하나는 소유 접수와 함께 한 번만 사용되고 두 번째 사용은 거절되며 그 변경은 되돌아간다", async () => {
  const harness = await openHarness([user]);
  try {
    await grant(harness, APPROVAL);
    const fixed = await action();

    const first = value(await probe(harness, APPROVAL, fixed, { key: "u-1" }));
    const use = (first.result as { use: { approval: string; concern: string } })
      .use;
    assertEquals(use.approval, APPROVAL);
    assertEquals(use.concern, fixed.concern);
    assertEquals(await n(harness, USE_COUNT), 1n);
    assertEquals(await n(harness, PROBED), 1n);

    // 다른 키(다른 요청)로 다시 쓰면 거절이고 두 번째 접수 event도 남지 않는다.
    assertEquals(
      failure(await probe(harness, APPROVAL, fixed, { key: "u-2" })).code,
      "conflict",
    );
    assertEquals(await n(harness, USE_COUNT), 1n);
    assertEquals(await n(harness, PROBED), 1n);
    // 같은 키 재전송은 처음 결과다(command 결과 재전송).
    const replay = value(await probe(harness, APPROVAL, fixed, { key: "u-1" }));
    assertEquals(replay.replayed, true);
    assertEquals(await n(harness, USE_COUNT), 1n);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R5 #R10: 정확한 action이 아니면 사용하지 못하고 사용 기록·접수 변경이 남지 않는다", async () => {
  const harness = await openHarness([user]);
  try {
    await grant(harness, APPROVAL);
    const fixed = await action();
    const changes: ApprovalAction[] = [
      {
        ...fixed,
        targets: [...fixed.targets, "doc_01h455vb4pex5v6nkc6gd5fdw2"],
      },
      { ...fixed, command: "record_other" },
      { ...fixed, comparison: { release: "rel_01h455vb4pex5v6nkc6gd5fdw9" } },
      { ...fixed, input: { kind: "inline", value: { release: "other" } } },
      { ...fixed, caller: "machine" },
    ];
    let key = 0;
    for (const changed of changes) {
      assertEquals(
        failure(
          await probe(harness, APPROVAL, changed, { key: `m-${++key}` }),
        ).code,
        "conflict",
      );
    }
    assertEquals(await n(harness, USE_COUNT), 0n);
    assertEquals(await n(harness, PROBED), 0n);
    // 정확한 action은 그대로 쓸 수 있다.
    value(await probe(harness, APPROVAL, fixed, { key: "ok" }));
    assertEquals(await n(harness, USE_COUNT), 1n);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R4 #R11: 대기·거절된 request나 없는 approval은 사용하지 못한다", async () => {
  const harness = await openHarness([user]);
  try {
    const fixed = await action();
    // 대기 중이다: 허락이 아니다.
    value(await create(harness, user));
    assertEquals(
      failure(await probe(harness, APPROVAL, fixed, { key: "p-1" })).code,
      "conflict",
    );
    // 거절됐다.
    value(await create(harness, user, { id: OTHER }));
    const input = await decisionInput(harness, OTHER, null);
    value(
      await decide(
        harness,
        user,
        "reject",
        input,
        "reject-1",
        await issue(harness, "reject", input),
      ),
    );
    assertEquals(
      failure(await probe(harness, OTHER, fixed, { key: "p-2" })).code,
      "conflict",
    );
    // 없는 approval이다.
    assertEquals(
      failure(
        await probe(harness, "apr_01h455vb4pex5v6nkc6gd5fdw9", fixed, {
          key: "p-3",
        }),
      ).code,
      "not_found",
    );
    assertEquals(await n(harness, USE_COUNT), 0n);
    assertEquals(await n(harness, PROBED), 0n);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/approvals#R7: 접수 근거는 허락 뒤에 실제로 남은 event여야 하고 concern이 action과 같아야 한다", async () => {
  const harness = await openHarness([user]);
  try {
    await grant(harness, APPROVAL);
    const fixed = await action();
    const request = value(
      await harness.read({ resource: "approvals", method: "get" }, user, {
        approval: APPROVAL,
      }),
    ) as { request: { created_seq: string; closed_seq: string } };

    // 허락 전에 있던 event(요청 생성)와 허락 결정 event는 접수 근거가 될 수 없다.
    for (
      const seq of [request.request.created_seq, request.request.closed_seq]
    ) {
      assertEquals(
        failure(await probe(harness, APPROVAL, fixed, { seq, key: `s-${seq}` }))
          .code,
        "conflict",
      );
    }
    // 아직 없는 event도 근거가 될 수 없다.
    assertEquals(
      failure(
        await probe(harness, APPROVAL, fixed, { seq: "999999", key: "s-none" }),
      ).code,
      "conflict",
    );
    // 다른 concern의 사용 기록은 이 action의 사용이 아니다.
    assertEquals(
      failure(
        await probe(harness, APPROVAL, fixed, {
          concern: "apps/permissions",
          key: "s-concern",
        }),
      ).code,
      "invalid_input",
    );
    assertEquals(await n(harness, USE_COUNT), 0n);
    assert(await n(harness, PROBED) === 0n);
  } finally {
    await harness.close();
  }
});
