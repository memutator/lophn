import { canonicalize } from "../../../base/mod.ts";
import {
  type DataEnvelope,
  type DataSerializer,
} from "../../../protocol/platform/mod.ts";

// lophn-agent/harness/safety가 쓰는 자료 경계 표식 모양. platform은 이 표식을
// 쓰지 않지만 직렬화하는 문자열이 이 표식을 흉내 내면 안 된다(platform/security#R10).
export const DATA_START_MARKER = "~~~data";
export const DATA_END_MARKER = "~~~";

// glue를 먼저 제거해야 ~ 사이에 숨은 zero-width가 접힌 뒤 3개 이상 run으로 잡힌다.
const GLUE = /[​‌‍⁠﻿]/g;
// 전각·물결 파문자는 ASCII 물결표로 접은 뒤 run 검사에 함께 걸린다.
const TILDE_LIKE = /[~˜⁓∼〜〰～]/g;
// 3개 미만 따옴표 run은 표식을 만들지 못한다.
const MARKER_RUN = /~{3,}/g;

export type DataOrigin = {
  source?: string;
  revision?: string;
};

// 문서·제목·주소·앱 응답·log·summary·수리 자료는 분류 없이 쓸 수 없다.
// 이 재료는 항상 data다. 출처를 알면 source·revision을 그대로 남긴다(R11).
export function dataEnvelope(text: string, origin?: DataOrigin): DataEnvelope {
  return {
    trust: "data",
    text,
    ...(origin?.source === undefined ? {} : { source: origin.source }),
    ...(origin?.revision === undefined ? {} : { revision: origin.revision }),
  };
}

export function defuseBoundaryMarkers(text: string): string {
  return text.replace(GLUE, "").replace(TILDE_LIKE, "~").replace(
    MARKER_RUN,
    (run) => run.split("").join(" "),
  );
}

// 출처 불명은 data다(platform/security#R11). source 없는 신뢰 주장은 승격 절차를
// 거치지 않았으므로 물린다. 실제 승격 검사는 identity·approvals 입구가 한다.
function demoted(value: DataEnvelope): DataEnvelope {
  return {
    trust: value.trust === "data" || value.source === undefined
      ? "data"
      : value.trust,
    text: defuseBoundaryMarkers(value.text),
    ...(value.source === undefined
      ? {}
      : { source: defuseBoundaryMarkers(value.source) }),
    ...(value.revision === undefined
      ? {}
      : { revision: defuseBoundaryMarkers(value.revision) }),
  };
}

// 같은 envelope면 같은 bytes다. 쌍 없는 surrogate는 여기서 실패하고 원문은 나가지 않는다.
export const serializeDataEnvelope: DataSerializer = (value) =>
  canonicalize(demoted(value));
