import { err, ok, type Result } from "../../packages/base/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import {
  commandResultRead,
  createEventVisibilityRegistry,
  createListEventsRead,
  type ReaderRegistration,
} from "../../packages/platform/ledger/mod.ts";

// reader Worker가 이 모듈만 import한다. 팀 read는 core가 API read로 붙인다.
// event 조회는 ledger의 credential 기록으로 제출 context를 다시 검증한다.
export function createReaderRegistration(): ReaderRegistration {
  const registry = createEventVisibilityRegistry([], []);
  if (!registry.ok) throw new Error("event visibility 등록이 비어 있지 않다");
  return {
    reads: [
      commandResultRead,
      createListEventsRead({
        registry: registry.value,
        current: currentFromLedger,
      }),
    ],
    ports: new Map(),
  };
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
