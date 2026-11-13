# Template: inbox

An inbox answers "what do I have to decide?": the answer on top (how many,
and the one to look at first), then one card per decision, grouped by when it
must be decided. A card says what to decide, why it is waiting and what waiting
costs, your recommendation and its cost, the other options folded, and where it
came from. The sample is a small shop; replace it.

Data (`data/latest.json`):

- `collectedAt`: ISO time of collection. The tab head shows it.
- `answer`: one or two sentences. With no items the page says the `TEXT.nothing` line.
- `items`: `{ id, group, question, why, recommend, cost?, options?, from }`.
  `group` is one of the `GROUPS` ids (`now`, `week`, `later`); change the
  groups' labels to fit, keep three or fewer. `recommend` is `null` when you have
  none. `from` is where it came from, in the person's words, and since when.
- Only open decisions. A decided item leaves the inbox; it belongs in an
  explorer of past decisions if the person keeps one.

Copy this as `index.html`. Change the `<title>`, the description and the `TEXT`
labels to the person's language; keep the rest.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>정할 것</title>
<meta name="description" content="가게 운영에서 내가 정해야 일이 풀리는 것과 각각의 추천을 본다.">
<link rel="stylesheet" href="/_lophn/kit.css">
<script src="/_lophn/kit.js"></script>
<style>
  body { margin: 0; background: var(--color-surface-base); color: var(--color-text-primary); font-family: var(--font-sans); font-size: var(--type-body-size); line-height: var(--type-body-line); word-break: keep-all; overflow-wrap: anywhere; }
  h2, h3, p, ul { margin: 0; }
  .answer { display: flex; flex-direction: column; gap: var(--space-2); }
  .lead { font-size: var(--type-title-size); line-height: var(--type-title-line); font-weight: var(--font-weight-semibold); letter-spacing: var(--type-tracking-title); max-width: 60ch; }
  .asof { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .group { display: flex; align-items: center; gap: var(--space-3); padding-top: var(--space-2); }
  .group h2 { font-size: var(--type-title-small-size); line-height: var(--type-title-small-line); font-weight: var(--font-weight-semibold); }
  .count { color: var(--color-text-muted); }
  .item { display: flex; flex-direction: column; gap: var(--space-3); }
  .item h3 { font-size: var(--type-title-small-size); line-height: var(--type-title-small-line); font-weight: var(--font-weight-semibold); }
  .why { color: var(--color-text-secondary); }
  .rec { display: flex; flex-direction: column; gap: var(--space-1); padding-left: var(--space-3); border-left: 2px solid var(--status-good-marker); }
  .rec.none { border-left-color: var(--color-border-strong); color: var(--color-text-secondary); }
  .label { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .cost { color: var(--color-text-secondary); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  .from { color: var(--color-text-muted); font-size: var(--type-small-size); line-height: var(--type-small-line); }
  details > summary { cursor: pointer; color: var(--color-link); font-size: var(--type-small-size); }
  details ul { padding-left: var(--space-5); margin-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); }
  .none-left { color: var(--color-text-secondary); }
</style>
</head>
<body>
<div id="root"></div>
<script>
  const { h, render, useTabHead, ui } = LophnKit;
  const { DashboardFrame, DashboardCell, Card } = ui.layout;
  const { StatusMark } = ui.feedback;

  // Labels the page itself writes. Write them in the person's language.
  const LOCALE = "ko";
  const TEXT = { asOf: "기준", recommend: "추천", cost: "대가", noRecommend: "추천 없음. 당신의 판단이 필요합니다.", options: (n) => `다른 길 ${n}개`, nothing: "지금 정할 것은 없습니다." };
  // Groups in order. Leave out a group with no items.
  const GROUPS = [
    { id: "now", label: "먼저 볼 것", tone: "critical" },
    { id: "week", label: "이번 주 안에", tone: "warning" },
    { id: "later", label: "급하지 않음", tone: "neutral" },
  ];

  const asOf = (iso) => `${new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} ${TEXT.asOf}`;

  function Item({ it }) {
    return h(Card, null, h("article", { className: "item" },
      h("h3", null, it.question),
      h("p", { className: "why" }, it.why),
      it.recommend
        ? h("div", { className: "rec" },
            h("span", { className: "label" }, TEXT.recommend),
            h("span", null, it.recommend),
            it.cost ? h("span", { className: "cost" }, `${TEXT.cost}: ${it.cost}`) : null)
        : h("div", { className: "rec none" }, TEXT.noRecommend),
      it.options && it.options.length ? h("details", null,
        h("summary", null, TEXT.options(it.options.length)),
        h("ul", null, it.options.map((o, i) => h("li", { key: i }, o)))) : null,
      h("p", { className: "from" }, it.from)));
  }

  function Page({ d }) {
    const inLophn = useTabHead({ status: asOf(d.collectedAt) });
    const groups = GROUPS.map((g) => ({ ...g, items: d.items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
    return h(DashboardFrame, null,
      h(DashboardCell, { span: 12 }, h("div", { className: "answer" },
        h("p", { className: "lead" }, d.items.length ? d.answer : TEXT.nothing),
        inLophn ? null : h("p", { className: "asof" }, asOf(d.collectedAt)))),
      groups.flatMap((g) => [
        h(DashboardCell, { key: g.id, span: 12 }, h("div", { className: "group" },
          h(StatusMark, { tone: g.tone, label: g.label }), h("span", { className: "count" }, g.items.length))),
        ...g.items.map((it) => h(DashboardCell, { key: it.id, span: 6 }, h(Item, { it }))),
      ]));
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
  "answer": "네 가지가 당신을 기다립니다. 원두 단가는 금요일까지 답해야 다음 주 물량이 들어옵니다.",
  "items": [
    {
      "id": "bean-price",
      "group": "now",
      "question": "원두 공급처의 단가 8% 인상을 받아들일까",
      "why": "금요일까지 답하지 않으면 다음 주 물량을 보내지 않겠다고 했습니다. 지금 재고로는 9일을 버팁니다.",
      "recommend": "이번 달은 받아들이고, 다음 달 계약 전에 다른 공급처 두 곳의 견적을 받습니다.",
      "cost": "이번 달 원가가 약 26만 원 늘어납니다.",
      "options": [
        "거절하고 다른 공급처로 바로 옮긴다. 맛이 달라질 수 있고 첫 주문은 2주 걸립니다.",
        "인상폭을 4%로 깎아 보자고 답한다. 금요일을 넘기면 물량이 끊깁니다."
      ],
      "from": "공급처 메일 · 11월 10일"
    },
    {
      "id": "weekend-hours",
      "group": "week",
      "question": "토요일 영업을 한 시간 늘릴까",
      "why": "지난 4주 동안 토요일 마감 30분 전 손님이 평일의 세 배였습니다.",
      "recommend": "12월 한 달만 저녁 9시까지 열어 보고 매출을 봅니다.",
      "cost": "아르바이트 한 명이 한 시간 더 필요합니다(한 달 약 4만 원).",
      "options": ["지금처럼 8시에 닫는다."],
      "from": "매출 기록 · 지난 4주"
    },
    {
      "id": "refund-rule",
      "group": "week",
      "question": "단체 주문 취소를 하루 전까지 받아 줄까",
      "why": "이번 달 단체 주문 취소 문의가 세 번 있었고, 지금 규정에는 단체 주문 취소가 적혀 있지 않습니다.",
      "recommend": "이틀 전까지는 전액, 하루 전에는 절반을 돌려줍니다.",
      "cost": "하루 전 취소 때 준비한 재료 일부를 버립니다.",
      "options": ["취소를 받지 않는다고 적는다.", "하루 전까지 전액 돌려준다."],
      "from": "손님 문의 · 이번 달 3건"
    },
    {
      "id": "logo",
      "group": "later",
      "question": "새 컵에 찍을 로고를 둘 중 무엇으로 할까",
      "why": "다음 컵 주문은 12월 말입니다. 그 전에만 정하면 됩니다.",
      "recommend": null,
      "options": ["지금 로고를 그대로 쓴다.", "디자이너가 보낸 새 로고를 쓴다(인쇄비 같음)."],
      "from": "디자이너 메일 · 11월 3일"
    }
  ]
}
```
