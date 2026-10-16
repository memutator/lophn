# @lophn/ui-overlay

## 목적

tooltip·popover·메뉴·dialog·toast·command palette다. lophn 화면과
같은 component이고 시각 값의 정본은 shell/design-system이다.
앱 안에서는 모두 앱 view의 문서 안에 그린다. lophn 화면의 overlay 층을 빌리는
통로는 없다.

## 공개 API와 type

```tsx
import {
  Dialog,
  Menu,
  Palette,
  Popover,
  PopoverRow,
  ToastProvider,
  Tooltip,
  useToast,
} from "@lophn/ui-overlay";
```

- `Tooltip({content, children})` — hover·focus 400ms 뒤 보이는 설명이다.
- `Popover({trigger, children})`, `PopoverRow({onSelect})` — modal이 아닌 떠
  있는 표면과 그 안의 32px 행이다. 바깥 click·focus 이동·Escape에 닫힌다.
- `Menu({trigger, items, onSelect})` — 행 32px 메뉴다.
- `Dialog({open, onOpenChange, title, actions, width})` — 폭 480·640px
  modal이다. 주 행동은 `actions`의 오른쪽 끝에 둔다. 닫히면 연 자리로 focus가
  돌아간다.
- `Palette({open, onOpenChange, title, items, onSelect})` — 폭 640px·위 20%의
  command palette다. 검색어로 이름을 거른다. 여는 키는 앱이 정한다.
- `ToastProvider`, `useToast()` — `show(options)`는 id를 돌려주고
  `dismiss(id)`로 닫는다. options는 `title`, `body`, `tone`, `actions`,
  `duration`이다. 폭 360px, 5초(짧은 조작은 `duration: "brief"` 2초),
  hover·focus에 멈추고 행동은 최대 2개, error는 시간으로 닫지 않는다.
- `Toast`, `ToastStack` — queue 없이 직접 그릴 때 쓴다.
- type: `TooltipProps`, `PopoverProps`, `PopoverRowProps`, `MenuProps`,
  `MenuItem`, `DialogProps`, `DialogWidth`, `PaletteProps`, `PaletteItem`,
  `ToastProps`, `ToastAction`, `ToastTone`, `ToastDuration`, `ToastOptions`,
  `ToastQueue`, `ToastProviderProps`, `Timer`, `Clock`

## 요구 permission

없다. 그리기는 React의 일이다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer                | version |
| ------------------- | ------- |
| `react`             | 19.3.0  |
| `lucide-react`      | 1.51.0  |
| `@lophn/tokens`     | 1.0.0   |
| `@lophn/ui-control` | 1.0.0   |

## 예제

`examples/overlays.tsx`가 여섯 overlay를 각각 연다.

```tsx
import { ToastProvider, useToast } from "@lophn/ui-overlay";

function SaveButton() {
  const toast = useToast();
  return (
    <Button
      onClick={() =>
        toast.show({ title: t("app.toast.saved"), duration: "brief" })}
    >
      {t("app.button.save")}
    </Button>
  );
}

<ToastProvider>
  <SaveButton />
</ToastProvider>;
```

문구는 앱의 message key로 준다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
