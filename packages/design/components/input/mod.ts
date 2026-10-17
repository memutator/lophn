// input: 값을 받는 입력 control.
// Input·Textarea·Select에 보이는 라벨과 도움말·오류를 붙인다. placeholder는 라벨이 아니다.
export { Field, type FieldProps } from "./field/field.tsx";
// Field가 자식 입력에 id와 오류 상태를 넘기는 context. 새 입력 control을 만들 때만 쓴다.
export { FieldContext, type FieldContextValue } from "./field/field-context.ts";
// 한 줄 글 입력. 여러 줄이면 Textarea, 정해진 목록이면 Select를 쓴다.
export { Input, type InputProps } from "./input/input.tsx";
// 여러 줄 글 입력. 설명·메모처럼 길어질 수 있는 글에 쓴다.
export { Textarea, type TextareaProps } from "./textarea/textarea.tsx";
// 정해진 목록에서 하나 고른다. 목록이 길어 검색이 필요하면 Palette를 쓴다.
export {
  Select,
  type SelectOption,
  type SelectProps,
} from "./select/select.tsx";
// 나중에 제출하는 선택. 바로 바뀌는 설정은 Switch를 쓴다.
export { Checkbox, type CheckboxProps } from "./checkbox/checkbox.tsx";
// 누르는 즉시 켜고 끄는 설정. 제출하는 선택은 Checkbox를 쓴다.
export { Switch, type SwitchProps } from "./switch/switch.tsx";
// 필터 조각(기간·다중 선택·검색)을 결과 위 한 줄로 묶고 기본값과 다르면 [Reset filters]를 붙인다.
export { FilterBar, type FilterBarProps } from "./filter/filter-bar.tsx";
// 필터 줄 안의 글 검색 칸. 언제 read command를 부를지는 앱이 정하고, 값 하나를 받는 일반 입력은 Input이다.
export { SearchFilter, type SearchFilterProps } from "./filter/filter-bar.tsx";
// 기간을 정한 preset이나 직접 입력한 양 끝 날짜로 고른다. 날짜 하나를 받으면 Input이다.
export {
  DateRangeFilter,
  type DateRangeFilterProps,
} from "./filter/date-range-filter.tsx";
// 기간 버튼에 보이는 이름. 기간 필터 말고 같은 이름을 다른 곳에 보일 때 쓴다.
export { rangeLabel } from "./filter/date-range-filter.tsx";
// 정해진 목록에서 여러 개를 고르는 필터. 하나만 고르면 Select, 제출하는 선택이면 Checkbox다.
export {
  type FilterOption,
  MultiSelectFilter,
  type MultiSelectFilterProps,
} from "./filter/multi-select-filter.tsx";
// 다중 선택 필터가 목록 위에 검색 칸을 두는 기준 개수. 같은 기준이 필요한 test와 목록이 쓴다.
export { SEARCH_AFTER } from "./filter/multi-select-filter.tsx";
// 다중 선택 버튼에 보이는 고른 것. 아무것도 안 골랐거나 모두 골랐으면 전체다.
export { selectionLabel } from "./filter/multi-select-filter.tsx";
// 기간 preset 목록. 기간 필터의 줄을 다시 짜거나 같은 목록이 필요할 때 쓴다.
export { RANGE_PRESETS } from "./filter/range.ts";
// 기간 필터가 만든 값을 시작·끝 날짜로 푼다. 앱이 read command 입력 날짜를 만들 때 쓴다.
export {
  type DateRange,
  parseDay,
  type RangePreset,
  resolveRange,
  toDay,
} from "./filter/range.ts";
