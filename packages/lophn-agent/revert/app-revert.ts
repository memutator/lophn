import type { PreviewItem } from "../../contracts/lophn-agent/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";

// 앱 write의 되돌림 분류(lophn-agent/revert R9·R10·R18). checkpoint 이후 같은 session의 성공한 앱
// write를 apps/blueprint의 선언(revert command)과 apps/invocations의 receipt로 판정한다. 근거가
// 없는 write는 되돌렸다고 쓰지 않고 남는 영향으로 올린다. 구현은 agent-RW3c가 채운다.

// ToolCall 기록에서 읽은 성공한 앱 write 하나.
export type AppWriteCall = {
  tool_call: string;
  // 성공 완료의 seq. 이 순서가 원래 호출 순서다.
  seq: string;
  command: {
    app: string;
    release: string;
    command: string;
    // 앱이 revert command를 선언하지 않았으면 null.
    revert_command: string | null;
  };
  // 성공 출력의 revert 영수증. 앱이 돌려주지 않았으면 null.
  receipt: {
    invocation: string;
    receipt: string;
    expected_revision: string;
  } | null;
};

// tool_calls에서 session의 checkpoint 이후(state_seq가 after_seq보다 큰) 성공한(outcome.kind=success)
// 앱 write(app_command가 있고 effect가 write·external)를 호출 순서(state_seq 오름차순)로 읽는다.
// 읽기·실패·거절·앱 command가 아닌 호출은 들지 않는다. revert_command와 영수증은 app_command와
// result.content.revert(JSON)에서 좁힌다.
export function readAppWrites(
  lookup: { sql: Pick<Sql, "get" | "all"> },
  input: { session: string; after_seq: string },
): AppWriteCall[] {
  void lookup;
  void input;
  throw new Error("not implemented: agent-RW3c");
}

// 호출 순서의 역순(실행 순서)으로 PreviewItem(class="app", target=tool_call, source=[tool_call])을
// 만든다. ordinal은 0부터다.
//   revert_command 없음            → remain `no_revert_command`
//   revert_command 있고 영수증 없음 → remain `no_receipt`
//   둘 다 있음                     → plan=restore, app_revert 근거(step_key는 `${revert ?? "preview"}:${invocation}`)
// 같은 앱의 가장 나중 write(실행 순서로 첫 단계)만 revisions의 지금 revision과 expected_revision을
// 비교한다. 다르거나 알 수 없으면(revisions에 없거나 null) 그 단계와 같은 앱의 더 앞선 복원 단계도
// 모두 skip `app_revision_changed`로 돌린다(근거는 남긴다). 다른 앱은 독립이다.
export function classifyAppWrites(input: {
  revert: string | null;
  calls: readonly AppWriteCall[];
  revisions: ReadonlyMap<string, string | null>;
}): PreviewItem[] {
  void input;
  throw new Error("not implemented: agent-RW3c");
}
