(function () {
  const { h, render, useState, useMemo, useTabHead, ui } = LophnKit;
  const { StatTile, StatRow } = ui.data;
  const { SearchFilter, SegmentedControl } = ui.input;
  const { Tabs, TabList, Tab } = ui.navigation;
  const { Button } = ui.primitives;
  const { Tooltip } = ui.overlay;

  const VIEWS = [
    { id: "decisions", label: "결정" },
    { id: "policy", label: "agent 정책" },
  ];
  const WHO_OPTIONS = [
    { value: "person", label: "사람" },
    { value: "unmarked", label: "+ 표시 없음" },
    { value: "all", label: "+ agent" },
  ];
  const SOURCE = { change: "작업 기록", issue: "이슈", roadmap: "roadmap", skill: "작업 skill" };
  const SKILL_NAME = {
    "harness-gui": "harness GUI 작업", "planner-persona": "계획 세우기", "ui-design": "화면 디자인",
    issue: "이슈 다루기", orchestrate: "작업 나누기", "wrap-plan": "계획 마무리", "write-test": "test 쓰기",
  };
  const WHO_LABEL = { person: "사람", agent: "agent", unmarked: "표시 없음" };
  const PER_TOPIC = 6;

  const fmtDay = (d) => {
    if (!d) return "";
    const [, m, day] = d.split("-").map(Number);
    return `${m}월 ${day}일`;
  };
  const fmtTime = (iso) => new Intl.DateTimeFormat("ko-KR", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));

  // 글 안의 `code`는 글자 모양만 바꾸고, 검색어는 표시한다.
  function richText(text, needle) {
    const parts = text.split(/(`[^`]+`)/g);
    const out = [];
    parts.forEach((p, i) => {
      if (p.startsWith("`") && p.endsWith("`") && p.length > 1) {
        out.push(h("code", { key: i }, mark(p.slice(1, -1), needle, i)));
      } else {
        out.push(...[].concat(mark(p.replace(/\*\*/g, ""), needle, i)));
      }
    });
    return out;
  }
  function mark(s, needle, k) {
    if (!needle) return s;
    const low = s.toLowerCase();
    const res = [];
    let at = 0, idx, n = 0;
    while ((idx = low.indexOf(needle, at)) !== -1) {
      if (idx > at) res.push(s.slice(at, idx));
      res.push(h("mark", { key: `${k}-${n++}` }, s.slice(idx, idx + needle.length)));
      at = idx + needle.length;
    }
    if (at < s.length) res.push(s.slice(at));
    return res.length ? res : s;
  }

  function Item({ it, needle }) {
    const [open, setOpen] = useState(false);
    const ctx = it.source === "skill" ? (SKILL_NAME[it.context] || it.context) : it.context.replace(/`/g, "");
    const date = h("span", { className: "date" }, (it.dateGuess ? "~" : "") + fmtDay(it.date));
    return h("div", { className: `item ${it.by}` },
      it.dateGuess ? h(Tooltip, { content: "판 번호로 짐작한 날짜" }, date) : date,
      h("div", { className: "body" },
        h("div", {
          className: open ? "text" : "text clamp",
          role: "button", tabIndex: 0,
          onClick: () => setOpen(!open),
          onKeyDown: (e) => { if (e.key === "Enter") setOpen(!open); },
        }, richText(it.text, needle)),
        h("div", { className: "meta" },
          it.by !== "person" ? h("span", { className: "tag who" }, WHO_LABEL[it.by]) : null,
          it.reversal ? h("span", { className: "tag turn" }, "앞 결정을 바꿈") : null,
          h("span", null, SOURCE[it.source]),
          h("span", null, "·"),
          h("span", { className: "ctx" }, ctx))));
  }

  function Topic({ name, list, needle }) {
    const [all, setAll] = useState(false);
    const shown = all || needle ? list : list.slice(0, PER_TOPIC);
    return h("section", { className: "topic" },
      h("div", { className: "topic-head" },
        h("h2", null, name),
        h("span", { className: "muted small" }, `${list.length}건`)),
      shown.map((it) => h(Item, { key: it.n, it, needle })),
      list.length > shown.length
        ? h("div", { className: "topic-more" },
            h(Button, { size: "sm", variant: "ghost", onClick: () => setAll(true) }, `${list.length - shown.length}건 더 보기`))
        : null);
  }

  function Decisions({ d }) {
    const [query, setQuery] = useState("");
    const [who, setWho] = useState("person");
    const needle = query.trim().toLowerCase();
    const person = d.items.filter((i) => i.by === "person");
    const topicCount = new Set(person.map((i) => i.topic)).size;
    const groups = useMemo(() => {
      const allow = who === "person" ? ["person"] : who === "unmarked" ? ["person", "unmarked"] : ["person", "unmarked", "agent"];
      const words = needle.split(/\s+/).filter(Boolean);
      const hit = (i) => words.every((w) => `${i.text} ${i.context} ${i.topic}`.toLowerCase().includes(w));
      const m = new Map();
      for (const it of d.items) {
        if (!allow.includes(it.by) || !hit(it)) continue;
        if (!m.has(it.topic)) m.set(it.topic, []);
        m.get(it.topic).push(it);
      }
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    }, [d, who, needle]);
    const total = groups.reduce((s, g) => s + g[1].length, 0);
    const firstWord = needle.split(/\s+/)[0] || "";
    return h("div", { className: "page" },
      h(StatRow, null,
        h(StatTile, { label: "사람이 정한 것", value: person.length, unit: "건" }),
        h(StatTile, { label: "주제", value: topicCount, unit: "개" }),
        h(StatTile, { label: "앞 결정을 바꾼 것", value: person.filter((i) => i.reversal).length, unit: "건" }),
        h(StatTile, { label: "agent가 정한 것", value: d.items.filter((i) => i.by === "agent").length, unit: "건" })),
      h("div", { className: "controls" },
        h("div", { className: "grow" }, h(SearchFilter, { value: query, onChange: setQuery, label: "찾기" })),
        h(SegmentedControl, { options: WHO_OPTIONS, value: who, onValueChange: setWho, label: "누가 정했나", size: "sm" })),
      needle ? h("div", { className: "muted small" }, `${total}건 찾음`) : null,
      groups.length === 0
        ? h("div", { className: "empty" }, "맞는 결정이 없다. 다른 낱말로 찾거나 표시 없음·agent까지 넓혀 본다.")
        : groups.map(([name, list]) => h(Topic, { key: `${name}-${who}`, name, list, needle: firstWord })));
  }

  function Policy({ d }) {
    const secs = d.policy.sections;
    const decided = secs.reduce((s, x) => s + x.decided, 0);
    const proposed = secs.reduce((s, x) => s + x.proposed, 0);
    return h("div", { className: "page" },
      h(StatRow, null,
        h(StatTile, { label: "정한 정책", value: decided, unit: "줄" }),
        h(StatTile, { label: "아직 제안", value: proposed, unit: "줄" })),
      h("section", { className: "policy" },
        h("div", { className: "topic-head" }, h("h2", null, "agent가 일하는 규칙 (AGENT.md)"),
          d.policy.updated ? h("span", { className: "muted small" }, `${fmtDay(d.policy.updated)} 고침`) : null),
        secs.map((s) => h("div", { key: s.name, className: "policy-row" },
          h("div", null, s.name, s.subs.length ? h("div", { className: "muted small" }, s.subs.join(" · ")) : null),
          h("div", { className: "muted small" }, `정함 ${s.decided}` + (s.proposed ? ` · 제안 ${s.proposed}` : ""))))));
  }

  function Page({ d }) {
    const [view, setView] = useState("decisions");
    const inHead = useTabHead(
      { status: `${fmtTime(d.collectedAt)} 수집`, tabs: { items: VIEWS, selected: view } },
      { onTab: setView });
    return h("div", null,
      inHead ? null : h("div", { className: "page", style: { paddingBottom: 0 } },
        h(Tabs, { value: view, onValueChange: setView },
          h(TabList, null, VIEWS.map((v) => h(Tab, { key: v.id, value: v.id, size: "sm" }, v.label))))),
      view === "decisions" ? h(Decisions, { d }) : h(Policy, { d }));
  }

  async function load() {
    const d = await (await fetch("data/latest.json")).json();
    if (d.parts) {
      const parts = await Promise.all(d.parts.map((p) => fetch(`data/${p}`).then((r) => r.json())));
      d.items = parts.flat();
    }
    return d;
  }
  load().then((d) => render(document.getElementById("root"), h(Page, { d })));
})();
