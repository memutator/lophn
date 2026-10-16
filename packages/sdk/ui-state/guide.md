# @lophn/ui-state

## 목적

읽기 결과의 loading·empty·error·freshness 상태와 앱 화면 root의
`AppErrorBoundary`다. 상태 표시는 lophn 화면과 같은 component이고
시각 값의 정본은 shell/design-system이다.

## 공개 API와 type

```tsx
import { AppErrorBoundary, ReadState } from "@lophn/ui-state";
```

- `AppErrorBoundary({children})` — 앱 화면 root의 오류 경계다. 앱 진입에서
  root를 감싼다. 아래에서 render 오류가 나면 `window`에 `RENDER_ERROR_EVENT`
  (`lophn:render-error`) DOM event를 보낸다. `detail`은 오류의 `name`과
  `message`다. lophn의 앱 preload가 그것을 플랫폼 오류 수집으로 넘기므로 앱이
  따로 보고하지 않아도 된다. 화면에는 원문 오류 없이 "Couldn't show this
  screen."과 [Try again]만 보인다. 보고 처리 규칙은 problems/reporting을 따른다.
- `ReadState(props)` — 읽기 결과의 상태 하나만 그린다. props는 `loading`,
  `failed`, `onRetry`, `isEmpty`, `empty`, `freshness`, `placeholder`다.
  loading은 300ms 전에는 아무것도 그리지 않고 그 뒤 skeleton을, `failed`(대상의
  사람 말 이름)는 "Couldn't load …"와 [Reload]를, 비었으면 한 문장과 행동
  하나를, 내용이 `freshness.staleAfterMs`보다 오래됐으면 "Last updated …"를 내용
  위에 붙인다.
- `isStale(freshness)` — 마지막 갱신이 기준보다 오래됐는지다.
- `Loading`, `Skeleton`, `EmptyState`, `ErrorState`, `StaleNote` — 상태를 직접
  조립할 때 쓴다.
- `systemTimer`, type `Timer` — loading 지연을 재는 timer다. 테스트가 바꿔
  끼운다.
- type: `AppErrorBoundaryProps`, `ReadStateProps`, `Freshness`, `EmptyAction`,
  `EmptyStateProps`, `ErrorStateProps`, `LoadingProps`, `SkeletonProps`,
  `SkeletonShape`, `StaleNoteProps`

## 요구 permission

없다. `AppErrorBoundary`의 오류 전달은 플랫폼이 이미 여는 통로라 따로 선언하지
않는다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer            | version |
| --------------- | ------- |
| `react`         | 19.3.0  |
| `lucide-react`  | 1.51.0  |
| `@lophn/tokens` | 1.0.0   |

## 예제

`examples/orders-status.tsx`가 root 경계와 읽기 결과의 상태를 보인다.

```tsx
import { AppErrorBoundary, ReadState } from "@lophn/ui-state";

createRoot(element).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

<ReadState
  loading={loading}
  failed={failed ? t("app.label.orders") : undefined}
  onRetry={reload}
  isEmpty={orders.length === 0}
  empty={{ message: t("app.empty.orders"), action: reloadAction }}
  freshness={{ updatedAt, now, staleAfterMs: 60 * 60 * 1000 }}
>
  <OrderList orders={orders} />
</ReadState>;
```

문구는 앱의 message key로 준다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
