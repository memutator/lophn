/**
 * confirm 접수 시험(platform#T32)의 소유 command. 제품 route가 아니라 시험 전용 team이다.
 * apps#T12의 `invocation.accept_confirm` handler가 들어오기 전까지 같은 contract route를 dispatchable로
 * 등록해, `apply_approved_action`이 접수와 approval 사용을 한 transaction에 묶는지 실제 core로 본다.
 * 기록은 apps의 실제 invocations 표·store와 InvocationAccepted event를 쓴다. apps#T12가 같은 route를
 * 등록하면 이 파일은 지우고 그 등록을 쓴다(이름이 겹치면 core 기동이 거절한다).
 */
import { createHash } from "node:crypto";
import { err, ok } from "../../../packages/base/mod.ts";
import {
  invocationAcceptConfirm,
  invocationAccepted,
} from "../../../packages/contracts/apps/mod.ts";
import type { CommandDefinition } from "../../../packages/contracts/platform/mod.ts";
import { insertInvocation } from "../../../packages/apps/invocations/store.ts";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

// 접수 하나의 invocation id. approval이 호출 하나에 묶이므로 approval에서 정해도 겹치지 않는다.
function invocationFor(approval: string): string {
  const digest = createHash("sha256").update(approval, "utf8").digest();
  let id = "inv_" + ALPHABET[digest[0] & 7];
  for (let index = 1; index < 26; index++) {
    id += ALPHABET[digest[index] & 31];
  }
  return id;
}

const PROOF_LIFETIME_MS = 60_000;

const command: CommandDefinition<typeof invocationAcceptConfirm> = {
  route: invocationAcceptConfirm,
  dispatchable: true,
  handle(tx, ctx, input) {
    // 접수는 machine이 한다. 원래 요청자는 approval에 고정된 호출 주체다.
    if (ctx.actor !== "machine") {
      return err({ code: "forbidden", message: "접수는 machine만 한다" });
    }
    const requester = tx.sql.get(
      "select requester from approval_requests where id = ?",
      [input.approval],
    );
    if (requester === undefined) {
      return err({ code: "forbidden", message: "approval이 없다" });
    }
    const existing = tx.sql.get(
      "select id from invocations where approval = ?",
      [input.approval],
    );
    if (existing !== undefined) {
      return err({ code: "conflict", message: "이미 접수한 approval이다" });
    }
    const invocation = invocationFor(input.approval);
    insertInvocation(tx, {
      id: invocation,
      app: input.app,
      release: input.release,
      operation: { kind: "command", command: input.command },
      trigger: { kind: "direct" },
      mode: "live",
      actor: String(requester["requester"]) as never,
      caller: input.caller,
      approval: input.approval,
      input_hash: input.input_hash,
      status: "accepted",
      started_at: null,
      finished_at: null,
      summary: {},
      detail_hash: null,
    });
    tx.emit(invocationAccepted, invocation, {
      app: input.app,
      release: input.release,
      command: input.command,
      input_hash: input.input_hash,
      approval: input.approval,
      caller: input.caller,
    });
    return ok({
      invocation,
      proof: {
        invocation,
        process_nonce: input.process_nonce,
        release: input.release,
        command: input.command,
        input_hash: input.input_hash,
        caller: input.caller,
        expires_at: new Date(Date.parse(tx.now()) + PROOF_LIFETIME_MS)
          .toISOString(),
      },
    });
  },
};

export function createCoreRegistration() {
  return { commands: [command] };
}
