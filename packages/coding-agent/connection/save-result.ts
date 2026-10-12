// 저장 결과를 사람·모델이 읽는 한 모양으로 만든다. MCP `lophn_save`와 CLI `save`가
// 같은 요약·data·다음 조회를 낸다. 고정 주소·판·unchanged·검사 경고를
// 그대로 담고 본문은 담지 않는다.
import type { LophnError } from "../../base/mod.ts";
import { formatAddress } from "../../protocol/projects/mod.ts";
import type { SaveOutcome } from "./document-save.ts";

export type SaveReport = { summary: string; data: unknown; next: string[] };

// 저장 결과가 `place/name@version` 주소를 주면 그것이 고정 주소다. core는 문서 ID와
// 판 ID로 된 참조를 주므로 그때는 `document@version`이 고정 주소다(주소 문자열은 없다).
function addressOf(reference: unknown): string | null {
  const ref = reference as {
    place?: string;
    document: string;
    section: string | null;
    version: number | string | null;
  };
  if (typeof ref.place === "string" && typeof ref.version === "number") {
    const formatted = formatAddress({
      place: ref.place,
      document: ref.document,
      section: ref.section,
      version: ref.version,
    });
    return formatted.ok ? formatted.value : null;
  }
  return null;
}

export function describeSave(outcome: SaveOutcome): SaveReport {
  const { saved } = outcome;
  const address = addressOf(saved.reference);
  const next: string[] = [
    "lophn_read로 고정 판을 읽어 저장된 내용을 확인한다",
  ];
  if (!outcome.placed) {
    // 자리 선택은 사람의 관점 정리다. 원본 파일을 옮기거나 지우지 않는다.
    next.unshift(
      "자리 없이 저장했다. document id가 고정 주소다. 자리 선택은 사람이 lophn 화면에서 한다",
    );
  }
  if (saved.warnings.length > 0) {
    next.push(
      `format 경고 ${saved.warnings.length}건이 있다. lophn_format validate로 위치를 확인한다`,
    );
  }
  const verb = saved.status === "saved"
    ? (outcome.created ? "새 문서로 저장했다" : "새 판으로 저장했다")
    : "내용이 같아 새 판을 만들지 않았다";
  return {
    summary: `${verb}: ${address ?? `${saved.document}@${saved.version}`}`,
    data: {
      status: saved.status,
      document: saved.document,
      version: saved.version,
      reference: saved.reference,
      address,
      placed: outcome.placed,
      warnings: saved.warnings,
      event_seq: saved.event_seq,
      series: outcome.series,
      notes: outcome.notes,
    },
    next,
  };
}

export function describeSaveFailure(error: LophnError): SaveReport {
  const stored = error.details?.saved !== undefined;
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next: stored
      ? ["lophn_read로 저장된 문서를 확인한다", "series 가입은 사람이 정리한다"]
      : error.code === "invalid_input"
      ? [
        "lophn_format show·validate로 형식을 확인하고 입력을 고쳐 다시 저장한다",
      ]
      : ["lophn_document list로 현재 문서를 읽은 뒤 다시 시도한다"],
  };
}
