import { err } from "../../base/mod.ts";
import {
  type AppRevertBinding,
  appRevertBindingSchema,
  TOOL_CALL_EVENTS,
  toolCallFinished,
} from "../../contracts/lophn-agent/mod.ts";
import type { JsonObject } from "../../contracts/platform/mod.ts";
import {
  type GroupDraft,
  type RevertOwner,
  sortSeqs,
  targetOf,
} from "./model.ts";

// 앱 되돌림 근거의 복원 판정(apps/invocations). 다른 owner는 apps/invocations의 표를 모르지만
// 이 owner 하나만 원래 run의 tool_calls를 읽는다(lophn-agent#T48): run의 ToolCallFinished를
// 대상(ToolCall)별로 묶고, 기록이 되돌리기 지원 앱 write(app_command.revert_command)이며
// result.content.revert receipt가 남은 것은 AppRevertBinding이 있는 reversible 묶음이다.
// 감사 사실(run 재시작 기록·읽기·실패·근거가 없는 호출)은 유지이고 복원 command는 없다.
// 실제 앱 revert 호출과 단계 기록은 commands.ts의 checkpoint·finish가 하고, 이 owner의
// restore는 호출하지 않는다.

export const APP_REVERT_OWNER = "apps/invocations";

const OWNED = new Set<string>(TOOL_CALL_EVENTS.map((event) => event.type));
const FINISHED = toolCallFinished.type;

// 기록의 app_command(JSON 열 값)를 되돌림 근거로 좁힌다. revert_command가 없으면 되돌리기를
// 선언하지 않은 호출이다.
function bindingOf(
  appCommand: unknown,
  result: unknown,
): AppRevertBinding | null {
  if (typeof appCommand !== "object" || appCommand === null) return null;
  const command = appCommand as Record<string, unknown>;
  if (typeof command.revert_command !== "string") return null;
  // result.content.revert가 receipt의 근거다(T44). content는 JSON 문자열로 남는다.
  let content: unknown;
  try {
    const stored = (result as Record<string, unknown> | null)?.["content"];
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    content = (parsed as Record<string, unknown> | null)?.["revert"];
  } catch {
    return null;
  }
  if (typeof content !== "object" || content === null) return null;
  const receipt = content as Record<string, unknown>;
  // step_key는 아직 prefix(저장한 revert나 run)를 모른다. 자리 표시로 파싱하고,
  // classify가 prefix를 붙여 다시 파싱한다.
  const parsed = appRevertBindingSchema.safeParse({
    app: command.app,
    release: command.release,
    command: command.command,
    tool_call: command.id,
    invocation: receipt.invocation,
    receipt: receipt.receipt,
    expected_revision: receipt.expected_revision,
    revert_command: command.revert_command,
    step_key: "-",
    revert_invocation: receipt.revert_invocation ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function retainedDraft(
  target: string | null,
  seqs: readonly string[],
): GroupDraft {
  return {
    owner: APP_REVERT_OWNER,
    target,
    source_seqs: sortSeqs(seqs),
    capability: "retained",
    reason: "audit_fact",
    comparison: null,
    before_ref: null,
    dependencies: [],
    app_revert: null,
  };
}

export function createAppRevertOwner(): RevertOwner {
  return {
    concern: APP_REVERT_OWNER,
    claims: (type) => OWNED.has(type),
    classify({ run, events, lookup, revert }) {
      // tool_calls 표가 같은 wire에 없는 등록(revert engine만 붙인 harness)은 기록이
      // 없는 것이다. 문서 표가 없는 조회(handoffReads.savedVersion)와 같은 관용이다.
      let calls: Map<string, { app_command: unknown; result: unknown }>;
      try {
        const rows = lookup.sql.all(
          `select id, app_command, result from tool_calls where run = ?`,
          [run],
        );
        calls = new Map(
          rows.map((row) => [String(row["id"]), {
            app_command: row["app_command"] === null
              ? null
              : JSON.parse(String(row["app_command"])),
            result: row["result"] === null
              ? null
              : JSON.parse(String(row["result"])),
          }]),
        );
      } catch {
        calls = new Map();
      }
      // step_key의 앞부분은 저장한 revert id다. preview는 저장한 revert가 없어 run을 쓴다.
      const prefix = revert === "" ? run : revert;
      const drafts: GroupDraft[] = [];
      const bySubject = new Map<string, string[]>();
      for (const event of events) {
        const key = event.subject ?? "";
        const list = bySubject.get(key) ?? [];
        list.push(event.seq);
        bySubject.set(key, list);
      }
      for (const [toolCall, seqs] of bySubject.entries()) {
        // subject가 target이 아니면 run 재시작 기록 같은 과거 사실이다(R8).
        if (toolCall === "" || targetOf(toolCall) === null) {
          drafts.push(retainedDraft(null, seqs));
          continue;
        }
        // 되돌림 근거는 완료 event에서 본다. 완료 뒤 보충이 있어도 완료가 근거다.
        const finished = events.find((event) =>
          event.type === FINISHED && seqs.includes(event.seq)
        );
        const binding = finished === undefined ? null : bindingOf(
          calls.get(toolCall)?.app_command ?? null,
          calls.get(toolCall)?.result ?? null,
        );
        if (finished !== undefined && binding !== null) {
          const prepared = appRevertBindingSchema.safeParse({
            ...binding,
            step_key: `${prefix}:${binding.invocation}`,
          });
          drafts.push({
            owner: APP_REVERT_OWNER,
            target: toolCall,
            source_seqs: sortSeqs(seqs),
            capability: "reversible",
            reason: null,
            comparison: {
              kind: "app",
              app: binding.app,
              release: binding.release,
              command: binding.command,
              expected_revision: binding.expected_revision,
            },
            before_ref: prepared.success
              ? (prepared.data as unknown as JsonObject)
              : null,
            dependencies: [],
            app_revert: prepared.success ? prepared.data : null,
          });
          continue;
        }
        drafts.push(retainedDraft(targetOf(toolCall), seqs));
      }
      return drafts;
    },
    restore() {
      return err({
        code: "invalid_input",
        message: "an app revert step is recorded by the checkpoint",
      });
    },
  };
}
