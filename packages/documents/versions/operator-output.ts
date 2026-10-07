// Operator 출력 저장 범위(documents/versions#R14, lophn-agent/assignments). Operator 자격의 저장은
// 그 assignment가 선언한 기존 출력 Document에 새 판만 더한다. 새 Document·자리·format 변경·series의
// 다음 문서 생성은 forbidden이다. 어느 문서가 어느 assignment의 출력인지는 lophn-agent가 같은 Tx에서
// 답하는 OperatorOutput port가 정한다. 회차마다 같은 Document에 판이 쌓이므로 앞 회차의 결과는
// 고정 판으로 남는다.
import { err, type Result } from "../../base/mod.ts";
import type {
  Document,
  PreparedVersion,
} from "../../contracts/documents/mod.ts";
import { OperatorOutput } from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { loadLatestVersion } from "./store.ts";

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "forbidden", message });
}

// Operator 자격인지. 역할은 credential이 고정한 agent 상한에서만 읽고 본문 주장은 보지 않는다.
// Operator가 아닌 agent의 저장은 이 규칙의 대상이 아니다.
function operatorAssignment(ctx: RequestContext): string | null {
  const actor = parseActor(ctx.actor);
  if (actor?.kind !== "agent") return null;
  const agent = (ctx.scope as { agent?: { role?: unknown } }).agent;
  return agent?.role === "operator" ? actor.id : null;
}

// 문서가 없을 때 저장 command가 주는 답과 같다: 기준 판이 있거나 metadata가 없으면 새 문서
// 입력이 아니고, 새 문서 입력은 Operator가 만들 수 없어 forbidden이다. 출력이 아닌 문서와 다른
// assignment의 출력은 없는 문서와 똑같이 답해 존재를 새지 않는다.
function absentAnswer(prepared: PreparedVersion): Result<never> {
  return prepared.base_version !== null || prepared.metadata === undefined
    ? rejected("invalid_input", "new document needs metadata")
    : rejected("forbidden", "operator writes only its assignment outputs");
}

// Operator 자격의 `document.save` 검사. Operator가 아니면 undefined(검사 없음)다.
// document는 저장 대상으로 이미 있는 문서(없으면 null)다.
export function operatorOutputRejected(
  tx: Tx,
  ctx: RequestContext,
  document: Document | null,
  prepared: PreparedVersion,
): Result<never> | undefined {
  const assignment = operatorAssignment(ctx);
  if (assignment === null) return undefined;
  if (document === null) return absentAnswer(prepared);
  let lookup;
  try {
    lookup = tx.port(OperatorOutput).output(document.id);
  } catch {
    return rejected("unavailable", "operator output lookup unavailable");
  }
  if (!lookup.ok) return lookup;
  if (lookup.value === null || lookup.value.assignment !== assignment) {
    return absentAnswer(prepared);
  }
  // 자기 출력이다: 새 판만. 자리·이름·제목을 정하는 입력은 새 문서나 자리 변경이다.
  if (prepared.metadata !== undefined) {
    return rejected("forbidden", "operator output keeps its place and name");
  }
  // 새 판은 최신 판의 format 계약 그대로다(준비가 base 판의 FormatRef를 따른다).
  const latest = loadLatestVersion(tx.sql, document.id);
  if (!latest.ok) return latest;
  if (latest.value !== null) {
    const format = latest.value.format;
    if (
      prepared.format.name !== format.name ||
      prepared.format.module_hash !== format.module_hash ||
      prepared.format.explicit !== format.explicit
    ) {
      return rejected("forbidden", "operator output keeps its format");
    }
  }
  return undefined;
}
