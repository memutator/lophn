# Template: explorer

An explorer answers "find the one I mean among many": the answer and up to four
numbers on top, then a search box, one filter and the records, newest first,
30 at a time. A record shows its title, its date and its group in one line and
unfolds to its full text. The sample is a log of a shop's decisions; replace it.

Use it only when the person will search or filter. Keep each record's text to
what the person needs; it is still not a dump.

Data (`data/latest.json`):

- `collectedAt`: ISO time of collection. The tab head shows it.
- `answer`: one or two sentences about the whole set (how many, what changed).
- `stats`: up to four `StatTile` props.
- `records`: `{ id, date, topic, title, body }`. `date` is an ISO date, `topic`
  is the filter's group, `title` is one line, `body` is a list of paragraphs.
  For more than a few thousand records, split them by year into
  `data/<year>.json` and read `data/_entries.json` (see `kit.md`).

Copy this as `index.html`. Change the `<title>`, the description and the `TEXT`
labels to the person's language; keep the rest.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>내가 정한 것</title>
<meta name="description" content="가게 운영에서 전에 정한 것을 주제와 낱말로 찾는다.">
<link rel="stylesheet" href="/_lophn/kit.css">
<script src="/_lophn/kit.js"></script>
<style>
  body { margin: 0; background: var(--color-surface-base); color: var(--color-text-primary); font-family: var(--font-sans); font-size: var(--type-body-size); line-height: var(--type-body-line); word-break: keep-all; overflow-wrap: anywhere; }
  p, ul { margin: 0; }
  .answer { display: flex; flex-direction: column; gap: var(--space-2); }
  .lead { font-size: var(--type-title-size); line-height: var(--type-title-line); font-weight: var(--font-weight-semibold); letter-spacing: var(--type-tracking-title); max-width: 60ch; }
  .asof, .found { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .records { list-style: none; padding: 0; border-top: 1px solid var(--color-border-subtle); }
  .records > li { border-bottom: 1px solid var(--color-border-subtle); }
  .records summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-1) var(--space-4); padding: var(--space-3) 0; cursor: pointer; list-style: none; }
  .records summary::-webkit-details-marker { display: none; }
  .records .meta { grid-column: 1 / -1; color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .records .when { color: var(--color-text-muted); font-size: var(--type-small-size); white-space: nowrap; }
  .records .body { padding: 0 0 var(--space-4); color: var(--color-text-secondary); max-width: 72ch; display: flex; flex-direction: column; gap: var(--space-2); }
  .more { padding-top: var(--space-4); }
</style>
</head>
<body>
<div id="root"></div>
<script>
  const { h, render, useState, useMemo, useTabHead, ui } = LophnKit;
  const { DashboardFrame, DashboardCell } = ui.layout;
  const { StatRow, StatTile } = ui.data;
  const { FilterBar, SearchFilter, SelectFilter } = ui.input;
  const { Button } = ui.primitives;
  const { EmptyState } = ui.feedback;

  // Labels the page itself writes. Write them in the person's language.
  const LOCALE = "ko";
  const TEXT = { asOf: "기준", search: "찾기", allTopics: "모든 주제", found: (n) => `${n}건`, more: "더 보기", none: "맞는 것이 없습니다.", reset: "거르기 풀기" };
  const PAGE = 30;

  const asOf = (iso) => `${new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} ${TEXT.asOf}`;
  const day = (iso) => new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));

  function Record({ r }) {
    return h("li", null, h("details", null,
      h("summary", null,
        h("span", null, r.title),
        h("span", { className: "when" }, day(r.date)),
        h("span", { className: "meta" }, r.topic)),
      h("div", { className: "body" }, r.body.map((p, i) => h("p", { key: i }, p)))));
  }

  function Page({ d }) {
    const inLophn = useTabHead({ status: asOf(d.collectedAt) });
    const [query, setQuery] = useState("");
    const [topic, setTopic] = useState(null);
    const [shown, setShown] = useState(PAGE);
    const topics = useMemo(() => [...new Set(d.records.map((r) => r.topic))].sort().map((t) => ({ value: t, label: t })), [d]);
    const found = useMemo(() => {
      const q = query.trim().toLowerCase();
      return d.records
        .filter((r) => topic === null || r.topic === topic)
        .filter((r) => q === "" || [r.title, ...r.body].join(" ").toLowerCase().includes(q))
        .sort((a, b) => b.date.localeCompare(a.date));
    }, [d, query, topic]);
    const reset = () => { setQuery(""); setTopic(null); setShown(PAGE); };
    return h(DashboardFrame, null,
      h(DashboardCell, { span: 12 }, h("div", { className: "answer" },
        h("p", { className: "lead" }, d.answer),
        inLophn ? null : h("p", { className: "asof" }, asOf(d.collectedAt)))),
      h(DashboardCell, { span: 12 }, h(StatRow, null,
        d.stats.map((s) => h(StatTile, { key: s.label, locale: LOCALE, ...s })))),
      h(DashboardCell, { span: 12 },
        h(FilterBar, { dirty: query !== "" || topic !== null, onReset: reset },
          h(SearchFilter, { label: TEXT.search, value: query, onChange: (v) => { setQuery(v); setShown(PAGE); } }),
          h(SelectFilter, { allLabel: TEXT.allTopics, options: topics, value: topic, onChange: (v) => { setTopic(v); setShown(PAGE); } }))),
      h(DashboardCell, { span: 12 },
        h("p", { className: "found" }, TEXT.found(found.length)),
        found.length === 0
          ? h(EmptyState, { icon: LophnKit.icons.SearchX, message: TEXT.none, action: { label: TEXT.reset, onSelect: reset } })
          : h("ul", { className: "records" }, found.slice(0, shown).map((r) => h(Record, { key: r.id, r }))),
        found.length > shown ? h("div", { className: "more" },
          h(Button, { size: "sm", onClick: () => setShown(shown + PAGE) }, `${TEXT.more} (${found.length - shown})`)) : null));
  }

  fetch("data/latest.json").then((r) => r.json())
    .then((d) => render(document.getElementById("root"), h(Page, { d })));
</script>
</body>
</html>
```

Sample `data/latest.json`:

```json
{
  "collectedAt": "2026-11-11T09:00:00+09:00",
  "answer": "올해 정한 것 42건 가운데 이번 달에 바꾼 것이 3건입니다. 가장 최근은 단체 주문 취소 규정입니다.",
  "stats": [
    { "label": "정한 것", "value": 42, "unit": "건" },
    { "label": "이번 달", "value": 5, "unit": "건", "change": 2, "changeLabel": "지난달보다" },
    { "label": "앞 결정을 바꾼 것", "value": 3, "unit": "건" }
  ],
  "records": [
    { "id": "d42", "date": "2026-11-10", "topic": "손님", "title": "단체 주문은 이틀 전까지 전액 돌려준다", "body": ["하루 전 취소는 절반을 돌려준다.", "버린 길: 취소를 받지 않는다(단골 단체 손님을 잃는다)."] },
    { "id": "d41", "date": "2026-11-04", "topic": "직원", "title": "주말 아르바이트를 한 명 더 뽑는다", "body": ["토요일 오후에만 쓴다. 12월에 다시 본다."] },
    { "id": "d40", "date": "2026-11-02", "topic": "메뉴", "title": "겨울 음료 두 가지를 11월 셋째 주에 낸다", "body": ["뱅쇼는 빼고 유자차와 생강라테만 낸다.", "앞 결정(10월 12일, 세 가지를 낸다)을 바꿨다: 뱅쇼 재료 단가가 맞지 않는다."] },
    { "id": "d39", "date": "2026-10-28", "topic": "공급", "title": "우유는 지금 공급처를 그대로 쓴다", "body": ["다른 곳이 5% 싸지만 배송이 주 2회뿐이다."] },
    { "id": "d38", "date": "2026-10-20", "topic": "손님", "title": "적립 쿠폰을 앱으로 옮긴다", "body": ["종이 쿠폰은 12월 말까지 받는다."] },
    { "id": "d37", "date": "2026-10-12", "topic": "메뉴", "title": "겨울 음료 세 가지를 낸다", "body": ["유자차, 생강라테, 뱅쇼."] },
    { "id": "d36", "date": "2026-10-05", "topic": "가격", "title": "아메리카노는 올리지 않는다", "body": ["원두 단가가 10% 넘게 오르면 다시 본다."] }
  ]
}
```
