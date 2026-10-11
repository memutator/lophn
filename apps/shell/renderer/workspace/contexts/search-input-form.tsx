// 선언된 검색의 입력 form(shell/workspace#R24). 선언의 입력 이름·타입에서 그린다: 고르는 입력은
// 타이핑으로 후보를 거르는 combobox, 여럿 고르는 입력은 chip, 범위 입력은 시작·끝 두 칸. 그릴 수
// 없는 입력 타입이면 form 대신 이유와 [Ask Context Engineer]를 보인다. 구현은 ctx-I47.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.input-ask
//   contexts.button.input-save-view
//   contexts.button.input-search
//   contexts.label.input-chip-on
//   contexts.label.input-from
//   contexts.label.input-no-matches
//   contexts.label.input-to
//   contexts.note.input-unsupported
import type { ReactNode } from "react";

import type {
  DeclaredSearch,
  PickOption,
  SearchInputValues,
} from "./source.ts";

export interface SearchInputFormProps {
  readonly search: DeclaredSearch;
  /** 채워 둔 값. 고르는 입력은 후보 value(여럿이면 value 목록), 범위는 RangeValue, 글은 문자열. */
  readonly values: SearchInputValues;
  /** 입력 이름 → 후보. 후보에 없는 값은 고를 수 없다. */
  readonly options: Readonly<Record<string, readonly PickOption[]>>;
  readonly onChange: (name: string, value: unknown) => void;
  /** [Search]. */
  readonly onSearch: () => void;
  /** [Save as view]. */
  readonly onSaveView: () => void;
  /** 그릴 수 없는 입력 타입일 때의 [Ask Context Engineer]. */
  readonly onAsk: () => void;
}

export function SearchInputForm(_props: SearchInputFormProps): ReactNode {
  return null;
}
