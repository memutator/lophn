import type { PreviewItem } from "../../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../../protocol/platform/mod.ts";

// 앱 write의 되돌림 분류(lophn-agent/revert R9·R10·R18). checkpoint 이후 같은 session의 성공한 앱
// write를 apps/blueprint의 선언(revert command)과 apps/invocations의 receipt로 판정한다. 근거가
// 없는 write는 되돌렸다고 쓰지 않고 남는 영향으로 올린다.

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

type Lookup = { sql: Pick<Sql, "get" | "all"> };

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// tool_calls.result의 content에서 revert 영수증을 좁힌다. content는 객체이거나 그 JSON 문자열이다.
function receiptOf(result: unknown): AppWriteCall["receipt"] {
  const content = (result as { content?: unknown } | null)?.content;
  const body = typeof content === "string" ? parseJson(content) : content;
  const revert = (body as { revert?: unknown } | null)?.revert;
  if (typeof revert !== "object" || revert === null) return null;
  const record = revert as Record<string, unknown>;
  const invocation = text(record["invocation"]);
  const receipt = text(record["receipt"]);
  const expected = text(record["expected_revision"]);
  return invocation === null || receipt === null || expected === null
    ? null
    : { invocation, receipt, expected_revision: expected };
}

// tool_calls에서 session의 checkpoint 이후(state_seq가 after_seq보다 큰) 성공한(outcome.kind=success)
// 앱 write(app_command가 있고 effect가 write·external)를 호출 순서(state_seq 오름차순)로 읽는다.
// 읽기·실패·거절·앱 command가 아닌 호출은 들지 않는다. revert_command와 영수증은 app_command와
// result.content.revert에서 좁힌다.
export function readAppWrites(
  lookup: Lookup,
  input: { session: string; after_seq: string },
): AppWriteCall[] {
  const rows = lookup.sql.all(
    `select t.id as id, t.state_seq as seq, t.app_command as app_command, t.result as result
       from tool_calls t join runs r on r.id = t.run
      where r.session = ? and t.app_command is not null
        and t.effect in ('write', 'external') and t.state_seq > ?
        and json_extract(t.outcome, '$.kind') = 'success'
      order by t.state_seq`,
    [input.session, Number(input.after_seq)],
  );
  const calls: AppWriteCall[] = [];
  for (const row of rows) {
    const command = parseJson(row["app_command"]) as
      | Record<string, unknown>
      | null;
    const app = text(command?.["app"]);
    const release = text(command?.["release"]);
    const name = text(command?.["command"]);
    if (app === null || release === null || name === null) continue;
    calls.push({
      tool_call: String(row["id"]),
      seq: String(row["seq"]),
      command: {
        app,
        release,
        command: name,
        revert_command: text(command?.["revert_command"]),
      },
      receipt: receiptOf(parseJson(row["result"])),
    });
  }
  return calls;
}

// 앱의 지금 revision으로 platform이 알 수 있는 값이다. 앱 data의 revision은 앱이 소유하므로 읽을 통로가
// 없고, ledger에 남은 가장 최근 성공 write의 영수증(그 write 직후의 revision)을 쓴다. 영수증이 없으면
// null이다. 이 값 뒤에 앱이 바꾼 것은 앱이 revert command의 CAS로 거절한다.
export function latestAppRevision(
  app: string,
  lookup: Lookup,
): string | null {
  const rows = lookup.sql.all(
    `select result from tool_calls
      where json_extract(app_command, '$.app') = ?
        and effect in ('write', 'external')
        and json_extract(outcome, '$.kind') = 'success'
      order by state_seq desc limit 20`,
    [app],
  );
  for (const row of rows) {
    const receipt = receiptOf(parseJson(row["result"]));
    if (receipt !== null) return receipt.expected_revision;
  }
  return null;
}

// 호출 순서의 역순(실행 순서)으로 PreviewItem(class="app", target=tool_call, source=[tool_call])을
// 만든다. ordinal은 0부터다.
//   revert_command 없음            → remain `no_revert_command`
//   revert_command 있고 영수증 없음 → remain `no_receipt`
//   둘 다 있음                     → plan=restore, app_revert 근거(step_key는 `${revert ?? "preview"}:${invocation}`)
// 같은 앱에서 실행 순서로 첫 복원 단계(가장 나중 write)만 revisions의 지금 revision과 expected_revision을
// 비교한다. 다르거나 알 수 없으면(revisions에 없거나 null) 그 단계와 같은 앱의 더 앞선 복원 단계도
// 모두 skip `app_revision_changed`로 돌린다(근거는 남긴다). 다른 앱은 독립이다.
export function classifyAppWrites(input: {
  revert: string | null;
  calls: readonly AppWriteCall[];
  revisions: ReadonlyMap<string, string | null>;
}): PreviewItem[] {
  const owner = input.revert ?? "preview";
  // 앱마다 첫 복원 단계의 검사 결과다. 한 번 막히면 그 앱의 뒤 단계는 모두 막힌다.
  const blocked = new Map<string, boolean>();
  return [...input.calls].reverse().map((call, ordinal): PreviewItem => {
    const base = {
      ordinal,
      class: "app" as const,
      target: call.tool_call,
      source: [call.tool_call],
    };
    const { revert_command, app, release, command } = call.command;
    if (revert_command === null) {
      return {
        ...base,
        plan: "remain",
        reason: "no_revert_command",
        app_revert: null,
      };
    }
    if (call.receipt === null) {
      return {
        ...base,
        plan: "remain",
        reason: "no_receipt",
        app_revert: null,
      };
    }
    const app_revert = {
      app,
      release,
      command,
      tool_call: call.tool_call,
      invocation: call.receipt.invocation,
      receipt: call.receipt.receipt,
      expected_revision: call.receipt.expected_revision,
      revert_command,
      step_key: `${owner}:${call.receipt.invocation}`,
      revert_invocation: null,
    };
    if (!blocked.has(app)) {
      blocked.set(
        app,
        input.revisions.get(app) !== call.receipt.expected_revision,
      );
    }
    return blocked.get(app) === true
      ? { ...base, plan: "skip", reason: "app_revision_changed", app_revert }
      : { ...base, plan: "restore", reason: null, app_revert };
  });
}
