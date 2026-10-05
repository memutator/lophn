import { err, ok, type Result } from "../../packages/base/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  Subject,
} from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import {
  commandResultRead,
  createListEventsRead,
  type ReaderRegistration,
} from "../../packages/platform/ledger/mod.ts";

// reader Worker가 이 모듈을 먼저 import한다. 팀 read는 core가 API read로 붙인다.
// event 조회는 ledger의 credential 기록으로 제출 context를 다시 검증한다.
// events/list의 registry는 reader Worker가 모든 팀 module의 `createEventRegistration`
// (event 정의와 공개 정책)을 모은 뒤에 넘긴다. 여기에 팀 목록을 적지 않는다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [commandResultRead],
    eventReads: (registry) => [
      createListEventsRead({
        registry,
        current: currentFromLedger,
        subjects: subjectScope,
      }),
    ],
    ports: new Map(),
  };
}

// `subjects` 필터의 범위 판정(platform/api#R5, identity#R8). 어떤 subject를 볼 수 있는지는
// event마다 owner의 공개 정책이 정한다. 필터는 정책을 지난 event 위에서만 걸리므로, 볼 수 없는
// subject는 event가 없는 subject와 똑같이 빈 batch와 같은 `scanned_through_seq`로 답한다.
// 그래서 여기서 subject별로 거절하지 않는다. 거절하면 "있지만 못 본다"와 "없다"가 갈리고
// 존재가 샌다. 이 gate가 막는 것은 event를 읽을 operation(ListEvents)이 현재 scope에 없는
// 자격뿐이다.
function subjectScope(
  _snapshot: ReadSnapshot,
  ctx: RequestContext,
  _subjects: readonly Subject[],
): Result<boolean> {
  return ok(ctx.scope.operations.includes("ListEvents"));
}

function currentFromLedger(
  snapshot: ReadSnapshot,
  credentialRef: string,
): Result<RequestContext> {
  const row = snapshot.sql.get(
    `select context, state from credentials where credential_ref = ?`,
    [credentialRef],
  );
  if (
    !row || row["state"] !== "active" || typeof row["context"] !== "string"
  ) {
    return err({ code: "unauthorized", message: "현재 credential이 없다" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row["context"]);
  } catch {
    return err({ code: "internal", message: "credential 기록을 읽지 못했다" });
  }
  const context = authenticatedContextSchema.safeParse(parsed);
  if (!context.success || context.data.credential_ref !== credentialRef) {
    return err({ code: "unauthorized", message: "현재 credential이 없다" });
  }
  return ok(context.data);
}
