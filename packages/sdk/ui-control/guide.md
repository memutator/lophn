# @lophn/ui-control

## 목적

높이 28·32·36px(sm·md·lg)의 버튼·입력·선택·체크박스·스위치·키 표시다. lophn 화면과 같은 component이고 시각 값의 정본은
shell/design-system이다.

## 공개 API와 type

```tsx
import {
  Button,
  Checkbox,
  Field,
  Input,
  Kbd,
  Select,
  Switch,
} from "@lophn/ui-control";
```

- `Button({variant, size, icon})` — primary·secondary·ghost·danger 버튼이다.
  내용 너비만 쓰고 주 행동은 줄 오른쪽 끝에 둔다.
- `IconButton({icon, label, size})` — 아이콘 버튼이다. `label`은 tooltip과
  이름이다.
- `Field({label, help, error})` — 입력·선택의 보이는 라벨과 도움말·오류다.
  `Input`·`Textarea`·`Select`는 Field 안에서만 쓴다(placeholder가 라벨을
  대신하지 않는다).
- `Input`, `Textarea`, `Select({options, size})` — 입력과 선택이다.
- `Checkbox({label, size})` — 나중에 제출하는 선택이다.
- `Switch({label, size})` — 바로 바뀌는 설정이다.
- `Kbd({keys})` — 함께 누르는 키 이름 표시다. 키 이름은 호출자가 플랫폼에 맞게
  준다.
- `CopyButton({text, label, clipboard})`, `systemClipboard` — 값 복사다.
- `Icon` — Lucide 아이콘을 token 크기로 그린다.
- type: `ControlSize`(`"sm" | "md" | "lg"`), `ButtonProps`, `ButtonVariant`,
  `IconButtonProps`, `FieldProps`, `InputProps`, `TextareaProps`, `SelectProps`,
  `SelectOption`, `CheckboxProps`, `SwitchProps`, `KbdProps`, `CopyButtonProps`,
  `Clipboard`, `IconProps`

같은 줄의 조작은 같은 `size`를 준다. 높이와 기준선이 맞는다.

## 요구 permission

없다. 그리기는 React의 일이다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer            | version |
| --------------- | ------- |
| `react`         | 19.3.0  |
| `lucide-react`  | 1.51.0  |
| `@lophn/tokens` | 1.0.0   |

## 예제

`examples/control-sizes.tsx`가 세 크기의 줄을 그린다.

```tsx
import { Button, Field, Input } from "@lophn/ui-control";

<Field label={t("app.label.name")}>
  <Input size="sm" />
</Field>;
<Button variant="primary" size="sm">{t("app.button.save")}</Button>;
```

문구는 앱의 message key로 준다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
