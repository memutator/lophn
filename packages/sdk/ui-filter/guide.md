# @lophn/ui-filter

## 목적

read command 결과를 좁히는 기간·다중 선택·검색 filter다(apps/sdk#R18). 고른 값은
앱의 read command 입력에 그대로 싣고, 결과의 loading·empty·error·freshness는
@lophn/ui-state가 보인다(apps/sdk#R19). 조작은 lophn 화면과 같은 component이고
시각 값의 정본은 shell/design-system이다(apps/sdk#R20, R21).

## 공개 API와 type

```tsx
import {
  DateRangeFilter,
  FilterBar,
  MultiSelectFilter,
  resolveRange,
  SearchFilter,
} from "@lophn/ui-filter";
```

- `FilterBar({children, dirty?, onReset?})` — 결과 위에 놓는 filter 한 줄이다.
  기간을 먼저, 그다음 다중 선택과 검색을 둔다. 칸이 좁으면 다음 줄로 넘긴다.
  `dirty`이고 `onReset`이 있으면 [Reset filters]를 보인다.
- `DateRangeFilter({value, onChange, now, defaultOpen?})` — 기간 고르기다.
  Today, Last 7 days, Last 30 days, Last 90 days, This month와 직접 기간(시작·끝
  날짜, [Apply])이다. `now`는 앱의 clock에서 받는다.
- `resolveRange(range, now)` — 기간을 `{from, to}` 달력 날짜(`YYYY-MM-DD`, 양 끝
  포함)로 푼다. "Last 7 days"는 오늘을 포함한 7일이다. read command 입력에
  싣는다.
- `rangeLabel(range)` — 여는 버튼에 보이는 기간 이름이다. 직접 기간은 Intl
  날짜다.
- `MultiSelectFilter({dimension, options, value, onChange, searchable?, defaultOpen?})`
  — 여러 값 고르기다. 체크박스 목록과 [Select all]·[Clear]이고 고를 것이
  `SEARCH_AFTER`(6)보다 많으면 검색 칸을 둔다. `value`가 비어 있으면 전체이고,
  바꾼 값은 `options` 순서로 돌려준다. `dimension`은 사람 말 복수 이름이다 ("All
  statuses").
- `selectionLabel(dimension, value, options)` — 여는 버튼에 보이는 고른 것이다.
- `SearchFilter({value, onChange, label?})` — 글 검색 칸이다. 언제 read
  command를 부를지는 앱이 정한다.
- `parseDay(day)`, `toDay(date)` — 달력 날짜 글과 `Date` 사이를 바꾼다. 없는
  날짜는 `undefined`다.
- `RANGE_PRESETS` — 정한 기간의 순서다.
- type: `DateRange`, `RangePreset`, `FilterOption`, `DateRangeFilterProps`,
  `MultiSelectFilterProps`, `SearchFilterProps`, `FilterBarProps`

## 요구 permission

없다. filter는 값만 만들고, read command 호출은 앱의 `lophnApp.call`이 한다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer            | version |
| --------------- | ------- |
| `react`         | 19.3.0  |
| `lucide-react`  | 1.51.0  |
| `@lophn/tokens` | 1.0.0   |

## 예제

`examples/orders-filters.tsx`가 기간·상태·검색으로 주문 read command 입력을
만들고 바뀔 때마다 그 command를 부른다.

```tsx
import {
  DateRangeFilter,
  FilterBar,
  MultiSelectFilter,
  resolveRange,
  SearchFilter,
} from "@lophn/ui-filter";

const query = { ...resolveRange(range, now), statuses, text: text.trim() };
await lophnApp.call("list-orders", query);

<FilterBar dirty={dirty} onReset={reset}>
  <DateRangeFilter value={range} now={now} onChange={setRange} />
  <MultiSelectFilter
    dimension={t("app.label.statuses")}
    options={statusOptions}
    value={statuses}
    onChange={setStatuses}
  />
  <SearchFilter
    label={t("app.label.search-orders")}
    value={text}
    onChange={setText}
  />
</FilterBar>;
```

문구는 앱의 message key로 주고 command key와 섞지 않는다(apps/sdk#R41).

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
