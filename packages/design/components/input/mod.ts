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
