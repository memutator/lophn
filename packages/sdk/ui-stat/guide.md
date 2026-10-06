# @lophn/ui-stat

## 목적

read command 결과의 수치와 변화량이다(apps/sdk#R18). lophn 화면과 같은 수치
타일이고 시각 값의 정본은 shell/design-system이다(apps/sdk#R20, R21,
shell/design-system#R31).

## 공개 API와 type

```tsx
import { StatRow, StatTile } from "@lophn/ui-stat";
```

- `StatTile({label, value, unit?, change?, changeLabel?, locale?})` — 라벨→28px
  값→변화량과 방향 아이콘이다. 값은 Intl 숫자이고 10만 이상은 compact(`182K`)다.
  변화량은 같은 단위의 차이이고 0이 아니면 부호를 붙인다. 값과 변화량은
  중립색이고 방향은 아이콘 모양(오름·내림·변화 없음)과 부호로 읽는다.
  `changeLabel`은 비교 기준이다("vs last period").
- `StatRow({children})` — 한 줄에 최대 4개를 놓고 더 많으면 다음 줄로 넘긴다.
  창이 아니라 넣은 칸이 640px 미만이면 한 줄에 2개다.
- type: `StatTileProps`, `StatDirection`(`up`·`down`·`flat`)

## 요구 permission

없다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer            | version |
| --------------- | ------- |
| `react`         | 19.3.0  |
| `lucide-react`  | 1.51.0  |
| `@lophn/tokens` | 1.0.0   |

## 예제

`examples/orders-summary.tsx`가 주문 read command 결과의 이번 기간과 지난 기간
값으로 수치와 변화량을 보인다.

```tsx
import { StatRow, StatTile } from "@lophn/ui-stat";

<StatRow>
  <StatTile
    label={t("app.label.orders")}
    value={orders.current}
    change={orders.current - orders.previous}
    changeLabel={t("app.label.versus-last-period")}
  />
</StatRow>;
```

문구는 앱의 message key로 준다(apps/sdk#R41).

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
