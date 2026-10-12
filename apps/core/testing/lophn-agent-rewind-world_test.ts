import { assert } from "@std/assert";
import type { Result } from "../../../packages/base/mod.ts";
import { redo, rewind } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { LedgerHarness } from "./ledger.ts";
import { confirmationBinding } from "../../../packages/core/server/identity/mod.ts";
import {
  NOW,
  sql,
  userCred,
  value,
} from "../../../packages/core/lophn-agent/session/world_test.ts";

// conversation 시험이 실제 Rewind·Redo를 한 번 쓰는 도우미다(lophn-agent/revert). 앱 단계도 문서
// 파일도 없는 messages_only라 파일 준비가 필요 없다. 이 도우미를 쓰는 시험은 conversation 시험
// 등록이 revert의 command·읽기·표를 함께 올린 뒤에 초록이 된다(agent-RW3b·RW3d).

let counter = 0;

// 사람이 messages_only로 checkpoint 메시지까지 되돌린다. preview를 읽어 그 hash와 확인 handle로
// Rewind를 보낸다.
export async function rewindMessagesOnly(
  h: LedgerHarness,
  input: { id: string; session: string; checkpoint: string },
): Promise<Result<unknown>> {
  const shown = value(
    await h.read({ resource: "rewind", method: "preview" }, userCred, {
      kind: "rewind",
      session: input.session,
      checkpoint: input.checkpoint,
      choice: "messages_only",
    }),
  ) as { preview_hash: string };
  const body = {
    id: input.id,
    session: input.session,
    checkpoint: input.checkpoint,
    choice: "messages_only",
    accept_remaining: true,
    preview_hash: shown.preview_hash,
    summary_call: null,
    files: [],
  };
  const binding = await confirmationBinding(rewind, body);
  assert(binding !== undefined);
  counter++;
  const issued = value(
    await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: `rewind-win-${counter}`,
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [rewind.name],
        expires_at: new Date(NOW + 86_400_000).toISOString(),
      },
    }),
  ) as { confirmation: string };
  counter++;
  return await h.command(userCred, {
    command: rewind.name,
    input: body,
    compare: {
      session_state: "open",
      active_run: null,
      applying_revert: null,
    },
    idempotency_key: `rewind-k-${counter}`,
    prepared: [],
    confirmation: issued.confirmation,
  });
}

export async function redoRewind(
  h: LedgerHarness,
  revert: string,
): Promise<Result<unknown>> {
  const row = (await sql(
    h,
    "select cast(result_seq as text) as seq from reverts where id = ?",
    [revert],
  ))[0];
  assert(row !== undefined, "no such revert");
  counter++;
  return await h.command(userCred, {
    command: redo.name,
    input: { revert, result_seq: String(row["seq"]), files: [] },
    compare: { redo: "available" },
    idempotency_key: `redo-k-${counter}`,
    prepared: [],
  });
}

export async function redoOf(
  h: LedgerHarness,
  revert: string,
): Promise<string> {
  const row = (await sql(h, "select redo from reverts where id = ?", [
    revert,
  ]))[0];
  assert(row !== undefined, "no such revert");
  return String(row["redo"]);
}
