import { err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import {
  type ProblemCodeDeclaration,
  problemCodeDeclarationsSchema,
  RESERVED_PROBLEM_CODES,
  type ReservedProblemCode,
} from "../../contracts/problems/mod.ts";

// 거절은 선언 원문·stack·검증기 문장을 그대로 노출하지 않는다(platform/api#R4).
const INVALID_DECLARATIONS = "problem code 선언이 올바르지 않다";

const RESERVED_EXCEPTION_CODE: ReservedProblemCode["code"] = "_exception";
const RESERVED_FEEDBACK_CODE: ReservedProblemCode["code"] = "_feedback";

// 앱이 같은 이름으로 다른 실패를 뜻하게 바꾸면 확인 대상이 되지만(valid declarations와
// 별개 관측), message_key rename은 안내 표의 이동일 뿐 뜻의 변경이 아니다.
const MEANING_FIELDS = ["message", "fixer"] as const;

const NO_VIEW_REASON =
  "이 실행 묶음에 앱 화면이 없어 화면 검사를 적용하지 않는다";

export function checkProblemCodeDeclarations(
  value: unknown,
): Result<ProblemCodeDeclaration[], LophnError> {
  const parsed = problemCodeDeclarationsSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: INVALID_DECLARATIONS });
  }
  return ok(parsed.data.map((declaration) => ({ ...declaration })));
}

export function reservedProblemCodes(): ReservedProblemCode[] {
  return RESERVED_PROBLEM_CODES.map((reserved) => ({ ...reserved }));
}

// 앱이 아무것도 선언하지 않아도 예약 3종은 언제나 별개로 보고된다(R6).
export function reportableProblemCodes(
  declarations: readonly ProblemCodeDeclaration[],
): ProblemCodeDeclaration[] {
  return [
    ...declarations.map((declaration) => ({ ...declaration })),
    ...reservedProblemCodes(),
  ];
}

export type MeaningChange = {
  code: string;
  changed: readonly (typeof MEANING_FIELDS)[number][];
};

export function observeMeaningChanges(
  previous: readonly ProblemCodeDeclaration[],
  current: readonly ProblemCodeDeclaration[],
): MeaningChange[] {
  const before = new Map(
    previous.map((declaration) => [declaration.code, declaration]),
  );
  return current.flatMap((declaration) => {
    const prior = before.get(declaration.code);
    if (!prior) return [];
    const changed = MEANING_FIELDS.filter((field) =>
      prior[field] !== declaration[field]
    );
    return changed.length ? [{ code: declaration.code, changed }] : [];
  });
}

export type ProblemCodeBundle = {
  problem_codes: ProblemCodeDeclaration[];
  has_view: boolean;
};

export type ReportPathKind =
  | "failure_path"
  | "process_exception"
  | "redaction"
  | "view_exception"
  | "feedback";

export type RequiredReportPath = {
  kind: ReportPathKind;
  code: string | null;
  status: "required" | "not_applicable";
  reason: string;
};

export function requiredReportPaths(
  bundle: ProblemCodeBundle,
): RequiredReportPath[] {
  const paths: RequiredReportPath[] = bundle.problem_codes.map((
    declaration,
  ) => ({
    kind: "failure_path",
    code: declaration.code,
    status: "required",
    reason: "선언한 실패가 실제 보고로 접수되는 경로",
  }));
  paths.push(
    {
      kind: "process_exception",
      code: RESERVED_EXCEPTION_CODE,
      status: "required",
      reason: "처리되지 않은 process 예외가 예약 code로 접수되는 경로",
    },
    {
      kind: "redaction",
      code: null,
      status: "required",
      reason: "보고가 저장되기 전에 redaction 검사를 거치는 경로",
    },
  );
  for (const kind of ["view_exception", "feedback"] as const) {
    const code = kind === "view_exception"
      ? RESERVED_EXCEPTION_CODE
      : RESERVED_FEEDBACK_CODE;
    paths.push(
      bundle.has_view
        ? {
          kind,
          code,
          status: "required",
          reason: kind === "view_exception"
            ? "처리되지 않은 view 예외가 예약 code로 접수되는 경로"
            : "사람이 제출한 feedback이 예약 code로 접수되는 경로",
        }
        : { kind, code, status: "not_applicable", reason: NO_VIEW_REASON },
    );
  }
  return paths;
}
