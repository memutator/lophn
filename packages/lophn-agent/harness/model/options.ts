import type { Result } from "../../../base/mod.ts";
import type { CatalogEntry } from "../../../contracts/lophn-agent/mod.ts";

// option 축 규칙이다(harness/model#R15-R16, R21, R24-R25). 어떤 model에 어떤 축과 값이 있는지는
// catalog 자료(CatalogEntry.options)만 말하고 이 모듈은 그 목록을 코드에 적지 않는다.
// 요청 필드로 옮기는 일은 wire.ts의 몫이다.

// 축 id → 값. 없는 축은 "모델에 맡김"이다.
export type OptionValues = Readonly<Record<string, string>>;

// 선택 화면이 보는 축이다. wire는 화면이 모르므로 싣지 않는다.
export type AxisView = {
  id: string;
  label: string;
  values: { value: string; label: string }[];
  default_value: string | null;
};

// model을 바꿔 값을 맞췄다는 알림 한 건이다. 문구는 shell/wording이 만든다.
export type OptionNotice = { axis: string; from: string; to: string };

export type FitResult = {
  option_values: Record<string, string>;
  notices: OptionNotice[];
};

// 고른 model이 가진 축만, catalog가 선언한 순서와 표시 이름 그대로 낸다(R21).
// options가 null(미확인)이거나 빈 배열(없음)이면 축이 없다.
export function optionAxesOf(_entry: CatalogEntry): AxisView[] {
  throw new Error("not implemented: agent-I3");
}

// 저장·호출 전에 없는 축이나 지원하지 않는 값을 invalid_input으로 거절한다(R24).
// 다른 값으로 조용히 바꾸지 않고, 통과한 값은 입력과 같다. 맡김(없는 축)은 그대로 둔다.
export function validateOptionValues(
  _entry: CatalogEntry,
  _values: OptionValues,
): Result<Record<string, string>> {
  throw new Error("not implemented: agent-I3");
}

// 검증한 뒤 호출에 쓸 값을 정한다. 값이 없는 축은 catalog가 확인한 default_value가 있으면
// 그 값을 채우고, 없으면 그 축을 비워 둔다(R16).
export function resolveOptionValues(
  _entry: CatalogEntry,
  _values: OptionValues,
): Result<Record<string, string>> {
  throw new Error("not implemented: agent-I3");
}

// 사람이 model을 바꿀 때 값을 새 model에 맞춘다(R25). 입력을 바꾸지 않는다.
// - 새 model에 그 축이 없으면 값을 버린다(알림 없음).
// - 값이 지원되면 그대로 둔다.
// - 지원되지 않는 effort 값은 더 약하면서 가장 가까운 지원 값으로, 그런 값이 없으면 가장 약한
//   지원 값으로 맞춘다. off는 맞춤 대상이 아니다. 맞춘 값마다 알림 한 건, 순서는 current의 키 순서.
// - effort 밖 축은 약하고 강함을 비교할 이름 순서가 없어 가장 약한(첫) 지원 값으로 맞춘다.
export function fitOptionValues(
  _next: CatalogEntry,
  _current: OptionValues,
): FitResult {
  throw new Error("not implemented: agent-I3");
}
