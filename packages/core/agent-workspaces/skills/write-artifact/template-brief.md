# Template: brief

A brief answers "where does this stand, and what needs me?": the answer on top,
the next actions, up to four numbers, then a few sections. Each section has a
title, its takeaway in one sentence, and one visual: a bar chart, a line chart
or a list of rows. The sample is a month of household spending; replace it.

Data (`data/latest.json`):

- `collectedAt`: ISO time of collection. The tab head shows it.
- `answer`, `more?`: the answer in one or two sentences, and one supporting line.
- `tone?`, `toneLabel?`: one overall state (`good`, `warning`, `serious`,
  `critical`, `neutral`) and its word.
- `next`: up to three `{ who, action, unblocks? }`. `nothingNext` is the line shown
  when `next` is empty.
- `stats`: up to four `StatTile` props (`label`, `value`, `unit?`, `change?`,
  `changeLabel?`).
- `sections`: up to six `{ id, title, takeaway?, basis?, wide? }` with one of
  `bar` (`BarChart` props: `xLabel`, `categories`, `series`), `line` (`LineChart`
  props with `x` as ISO dates) or `rows` (`{ label, value?, note?, tone? }`; past
  seven they fold behind "N more"). `basis` is the one line that says what was
  inferred. `wide` spans the full width; otherwise two sections share a line.

Copy this as `index.html`. Change the `<title>`, the description and the `TEXT`
labels to the person's language; keep the rest.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>이번 달 지출</title>
<meta name="description" content="이번 달 어디에 얼마를 썼고 지난달과 무엇이 달라졌는지 본다.">
<link rel="stylesheet" href="/_lophn/kit.css">
<script src="/_lophn/kit.js"></script>
<style>
  body { margin: 0; background: var(--color-surface-base); color: var(--color-text-primary); font-family: var(--font-sans); font-size: var(--type-body-size); line-height: var(--type-body-line); word-break: keep-all; overflow-wrap: anywhere; }
  h2, p, ol, ul { margin: 0; }
  .answer { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .lead { font-size: var(--type-title-size); line-height: var(--type-title-line); font-weight: var(--font-weight-semibold); letter-spacing: var(--type-tracking-title); max-width: 60ch; }
  .more { color: var(--color-text-secondary); max-width: 72ch; }
  .asof { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .next { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-5); border-radius: var(--radius-md); background: var(--color-surface-subtle); }
  h2 { font-size: var(--type-title-small-size); line-height: var(--type-title-small-line); font-weight: var(--font-weight-semibold); }
  .next ol { padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); }
  .who { font-weight: var(--font-weight-semibold); }
  .then { color: var(--color-text-secondary); }
  .section { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
  .takeaway { color: var(--color-text-secondary); }
  .rows { list-style: none; padding: 0; }
  .rows li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-1) var(--space-4); padding: var(--space-3) 0; border-top: 1px solid var(--color-border-subtle); }
  .rows li:first-child { border-top: none; }
  .rows .name { overflow-wrap: anywhere; }
  .rows .value { font-family: var(--font-numeric); font-variant-numeric: tabular-nums; text-align: right; }
  .rows .note { grid-column: 1 / -1; color: var(--color-text-secondary); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .basis { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  details > summary { cursor: pointer; color: var(--color-link); font-size: var(--type-small-size); padding-top: var(--space-2); }
</style>
</head>
<body>
<div id="root"></div>
<script>
  const { h, render, useTabHead, ui } = LophnKit;
  const { DashboardFrame, DashboardCell } = ui.layout;
  const { StatRow, StatTile, BarChart, LineChart } = ui.data;
  const { StatusMark } = ui.feedback;

  // Labels the page itself writes. Write them in the person's language.
  const LOCALE = "ko";
  const TEXT = { next: "할 일", more: (n) => `${n}개 더 보기`, asOf: "기준", empty: "보일 값이 없습니다.", reload: "다시 읽기" };
  const SHOWN = 7;

  const reload = () => location.reload();
  const chartState = { onRetry: reload, empty: { message: TEXT.empty, action: { label: TEXT.reload, onSelect: reload } } };
  const asOf = (iso) => `${new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} ${TEXT.asOf}`;

  function Row({ r }) {
    return h("li", null,
      r.tone ? h(StatusMark, { tone: r.tone, label: r.label }) : h("span", { className: "name" }, r.label),
      h("span", { className: "value" }, r.value ?? ""),
      r.note ? h("span", { className: "note" }, r.note) : null);
  }

  function Rows({ rows }) {
    const rest = rows.slice(SHOWN);
    return h("div", null,
      h("ul", { className: "rows" }, rows.slice(0, SHOWN).map((r, i) => h(Row, { key: i, r }))),
      rest.length ? h("details", null, h("summary", null, TEXT.more(rest.length)),
        h("ul", { className: "rows" }, rest.map((r, i) => h(Row, { key: i, r })))) : null);
  }

  function Visual({ s }) {
    if (s.bar) return h(BarChart, { ...chartState, locale: LOCALE, ...s.bar });
    if (s.line) return h(LineChart, { ...chartState, locale: LOCALE, ...s.line, x: s.line.x.map((d) => new Date(d)) });
    if (s.rows) return h(Rows, { rows: s.rows });
    return null;
  }

  function Page({ d }) {
    const inLophn = useTabHead({ status: asOf(d.collectedAt) });
    return h(DashboardFrame, null,
      h(DashboardCell, { span: 12 }, h("div", { className: "answer" },
        d.tone ? h(StatusMark, { tone: d.tone, label: d.toneLabel }) : null,
        h("p", { className: "lead" }, d.answer),
        d.more ? h("p", { className: "more" }, d.more) : null,
        inLophn ? null : h("p", { className: "asof" }, asOf(d.collectedAt)))),
      h(DashboardCell, { span: 12 }, h("div", { className: "next" },
        h("h2", null, TEXT.next),
        d.next.length
          ? h("ol", null, d.next.map((n, i) => h("li", { key: i },
              h("span", { className: "who" }, n.who), ` · ${n.action}`,
              n.unblocks ? h("span", { className: "then" }, ` → ${n.unblocks}`) : null)))
          : h("p", null, d.nothingNext))),
      d.stats.length ? h(DashboardCell, { span: 12 }, h(StatRow, null,
        d.stats.map((s) => h(StatTile, { key: s.label, locale: LOCALE, ...s })))) : null,
      d.sections.map((s) => h(DashboardCell, { key: s.id, span: s.wide ? 12 : 6 },
        h("section", { className: "section" },
          h("h2", null, s.title),
          s.takeaway ? h("p", { className: "takeaway" }, s.takeaway) : null,
          h(Visual, { s }),
          s.basis ? h("p", { className: "basis" }, s.basis) : null))));
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
  "tone": "warning",
  "toneLabel": "예산 넘음",
  "answer": "이번 달 지출은 412만 원으로 지난달보다 9% 많습니다. 늘어난 몫은 거의 다 외식입니다.",
  "more": "고정비는 그대로이고, 남은 예산으로는 이달 말까지 하루 2만 원꼴입니다.",
  "next": [
    { "who": "당신", "action": "쓰지 않는 구독 3개를 끊을지 정하기", "unblocks": "다음 달부터 매달 3만 9천 원이 줄어듭니다" },
    { "who": "저", "action": "카드 두 장의 이번 주 내역을 다시 모으기", "unblocks": "말일 예상치가 정확해집니다" }
  ],
  "nothingNext": "지금 할 일은 없습니다.",
  "stats": [
    { "label": "이번 달 지출", "value": 4120000, "unit": "원", "change": 340000, "changeLabel": "지난달보다" },
    { "label": "외식", "value": 980000, "unit": "원", "change": 310000, "changeLabel": "지난달보다" },
    { "label": "남은 예산", "value": 380000, "unit": "원" },
    { "label": "남은 날", "value": 19, "unit": "일" }
  ],
  "sections": [
    {
      "id": "categories",
      "title": "어디에 썼나",
      "takeaway": "고정비가 가장 크고, 지난달과 달라진 것은 외식뿐입니다.",
      "bar": {
        "xLabel": "분류",
        "categories": ["고정비", "외식", "장보기", "교통", "구독", "기타"],
        "series": [
          { "key": "last", "label": "지난달", "values": [1650000, 670000, 720000, 240000, 120000, 380000] },
          { "key": "this", "label": "이번 달", "values": [1650000, 980000, 730000, 250000, 120000, 390000] }
        ]
      }
    },
    {
      "id": "trend",
      "title": "주마다",
      "takeaway": "둘째 주에 회식과 모임이 몰렸습니다.",
      "line": {
        "xLabel": "주",
        "x": ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"],
        "series": [{ "key": "spend", "label": "지출", "values": [910000, 1020000, 880000, 960000, 1480000, 640000] }]
      }
    },
    {
      "id": "big",
      "title": "눈에 띄는 지출",
      "takeaway": "10만 원이 넘는 것 다섯 건입니다.",
      "wide": true,
      "rows": [
        { "label": "팀 회식", "value": "32만 원", "note": "11월 5일, 법인카드로 바꿀 수 있는지 확인 필요" },
        { "label": "가족 모임", "value": "24만 원", "note": "11월 8일" },
        { "label": "자동차 보험", "value": "18만 원", "note": "해마다 11월에 나갑니다" },
        { "tone": "warning", "label": "같은 가게에서 두 번 결제", "value": "12만 원", "note": "11월 9일, 같은 금액이 1분 차이로 두 번 찍혔습니다" },
        { "label": "겨울 옷", "value": "11만 원", "note": "11월 2일" }
      ],
      "basis": "구독 3개를 쓰지 않는다는 것은 지난 60일 동안 쓴 기록이 없어서 추정한 것입니다."
    }
  ]
}
```
