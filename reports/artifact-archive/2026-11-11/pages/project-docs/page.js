(function () {
  const { h, render, useState, useMemo, useEffect, useRef, useTabHead, ui } = LophnKit;
  const { StatTile, StatRow } = ui.data;
  const { StatusMark } = ui.feedback;
  const { FilterBar, MultiSelectFilter, SelectFilter, SearchFilter, SegmentedControl } = ui.input;
  const { Card } = ui.layout;
  const { Tabs, TabList, Tab } = ui.navigation;
  const { Button } = ui.primitives;
  const Fragment = LophnKit.React.Fragment;

  const VIEWS = [
    { id: "summary", label: "요약" },
    { id: "issues", label: "이슈" },
    { id: "journeys", label: "Journey" },
    { id: "scenarios", label: "Scenario" },
    { id: "wireframes", label: "Wireframe" },
  ];
  const STATUS = {
    open: { tone: "warning", label: "open" },
    fixed: { tone: "good", label: "fixed" },
    kept: { tone: "neutral", label: "kept" },
  };
  const STATUS_OPTIONS = ["open", "fixed", "kept"].map((v) => ({ value: v, label: v }));
  const DEFAULT_STATUS = ["open"];

  function fmtTime(iso) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  }
  const count = (list, key) => {
    const m = new Map();
    for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const includes = (hay, needle) => (hay || "").toLowerCase().includes(needle);

  // ---------- 요약 ----------
  function Summary({ d, go }) {
    const open = d.issues.filter((i) => i.status === "open");
    const journeys = d.journeyGroups.flatMap((g) => g.journeys);
    const scenarios = d.scenarioGroups.flatMap((g) => g.scenarios);
    const pages = d.gallery.flatMap((g) => g.areas.flatMap((a) => a.pages));
    const topics = count(open, "topic").slice(0, 10);
    const max = topics.length ? topics[0][1] : 1;
    const decide = open.filter((i) => i.decide);
    const kinds = count(open, "kind");
    return h("div", { className: "page" },
      h(StatRow, null,
        h(StatTile, { label: "열린 이슈", value: open.length, unit: `/ ${d.issues.length}건` }),
        h(StatTile, { label: "Journey", value: journeys.length }),
        h(StatTile, { label: "Scenario", value: scenarios.length }),
        h(StatTile, { label: "Wireframe 화면", value: pages.length })),
      h("div", { className: "split" },
        h("section", null,
          h("h2", { className: "section-title" }, "열린 이슈가 많은 topic"),
          h("div", { className: "topics" }, topics.map(([topic, n]) =>
            h("div", { key: topic, className: "topic-row" },
              h("button", { type: "button", onClick: () => go("issues", { topic }) }, topic),
              h("div", { className: "bar-track" }, h("div", { className: "bar", style: { width: `${(n / max) * 100}%` } })),
              h("span", { className: "count" }, `${n}건`))))),
        h("section", null,
          h("h2", { className: "section-title" }, "열린 이슈의 kind"),
          h("div", { className: "topics" }, kinds.map(([kind, n]) =>
            h("div", { key: kind, className: "topic-row" },
              h("button", { type: "button", onClick: () => go("issues", { kind }) }, kind),
              h("div", { className: "bar-track" }, h("div", { className: "bar", style: { width: `${(n / open.length) * 100}%` } })),
              h("span", { className: "count" }, `${n}건`)))),
          decide.length > 0 && h(Fragment, null,
            h("h2", { className: "section-title", style: { marginTop: "var(--space-5)" } }, `사람이 정할 것이 있는 열린 이슈 ${decide.length}건`),
            h("ul", { className: "steps" }, decide.slice(0, 8).map((i) =>
              h("li", { key: i.id }, h("button", { type: "button", className: "link", onClick: () => go("issues", { focus: i.id }) }, i.title))))))));
  }

  // ---------- 이슈 ----------
  function Field({ label, value }) {
    if (!value) return null;
    return h("div", null, h("div", { className: "label" }, label), h("div", { className: "prose" }, value));
  }
  function IssueRow({ issue, open }) {
    const s = STATUS[issue.status] || { tone: "neutral", label: issue.status };
    return h("details", { className: "row", open: open || undefined, id: `issue-${issue.id}` },
      h("summary", null,
        h("span", { className: "row-title" }, issue.title),
        h("span", { className: "row-meta" }, h("span", null, issue.topic), h("span", null, issue.kind), h(StatusMark, { tone: s.tone, label: s.label }))),
      h("div", { className: "row-body" },
        h(Field, { label: "지금", value: issue.now }),
        h(Field, { label: "영향", value: issue.impact }),
        issue.status === "open" ? h(Field, { label: "고치려면", value: issue.fix }) : h(Field, { label: "닫은 내용", value: issue.closed }),
        h(Field, { label: "정할 것", value: issue.decide })));
  }
  function Issues({ d, filter, setFilter }) {
    const topics = useMemo(() => count(d.issues, "topic").map(([t, n]) => ({ value: t, label: `${t} (${n})` })), [d]);
    const kinds = useMemo(() => count(d.issues, "kind").map(([k, n]) => ({ value: k, label: `${k} (${n})` })), [d]);
    const q = filter.q.trim().toLowerCase();
    const shown = d.issues.filter((i) =>
      (filter.status.length === 0 || filter.status.includes(i.status)) &&
      (!filter.kind || i.kind === filter.kind) &&
      (!filter.topic || i.topic === filter.topic) &&
      (!q || includes(i.title, q) || includes(i.id, q) || includes(i.now, q)));
    const order = { open: 0, kept: 1, fixed: 2 };
    shown.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.topic.localeCompare(b.topic));
    const dirty = filter.q !== "" || filter.kind !== null || filter.topic !== null || filter.status.join() !== DEFAULT_STATUS.join();
    useEffect(() => {
      if (filter.focus) document.getElementById(`issue-${filter.focus}`)?.scrollIntoView({ block: "center" });
    }, [filter.focus]);
    return h("div", { className: "page" },
      h(FilterBar, { dirty, onReset: () => setFilter({ status: DEFAULT_STATUS, kind: null, topic: null, q: "", focus: null }) },
        h(MultiSelectFilter, { dimension: "statuses", options: STATUS_OPTIONS, value: filter.status, onChange: (status) => setFilter({ ...filter, status }) }),
        h(SelectFilter, { allLabel: "All kinds", options: kinds, value: filter.kind, onChange: (kind) => setFilter({ ...filter, kind }) }),
        h(SelectFilter, { allLabel: "All topics", options: topics, value: filter.topic, onChange: (topic) => setFilter({ ...filter, topic }) }),
        h(SearchFilter, { label: "검색", value: filter.q, onChange: (q) => setFilter({ ...filter, q }) })),
      h("div", { className: "count" }, `${shown.length}건`),
      h("div", { className: "rows" }, shown.map((i) => h(IssueRow, { key: i.id, issue: i, open: i.id === filter.focus }))));
  }

  // ---------- journey ----------
  function Journeys({ d, focus, openScreen, pageTitles }) {
    const groups = d.journeyGroups.map((g) => g.group);
    const focusGroup = focus ? d.journeyGroups.find((g) => g.journeys.some((j) => j.id === focus))?.group : null;
    const [group, setGroup] = useState(focusGroup || groups[0]);
    const [q, setQ] = useState("");
    useEffect(() => { if (focusGroup) setGroup(focusGroup); }, [focus]);
    useEffect(() => {
      if (focus) setTimeout(() => document.getElementById(`journey-${focus}`)?.scrollIntoView({ block: "start" }), 0);
    }, [focus, group]);
    const needle = q.trim().toLowerCase();
    const list = (d.journeyGroups.find((g) => g.group === group)?.journeys || []).filter((j) =>
      !needle || includes(j.title, needle) || includes(j.id, needle) || includes(j.goal, needle) || j.steps.some((s) => includes(s.do, needle)));
    return h("div", { className: "page" },
      h(FilterBar, null,
        h(SegmentedControl, {
          label: "Journey group", size: "sm", value: group, onValueChange: setGroup,
          options: d.journeyGroups.map((g) => ({ value: g.group, label: `${g.group} ${g.journeys.length}` })),
        }),
        h(SearchFilter, { label: "검색", value: q, onChange: setQ })),
      h("div", { className: "rows" }, list.map((j) =>
        h("details", { key: j.id, className: "row", id: `journey-${j.id}`, open: j.id === focus || undefined },
          h("summary", null,
            h("span", { className: "row-title" }, j.title),
            h("span", { className: "row-meta" }, h("span", null, j.actor), h("span", null, `${j.steps.length} step`))),
          h("div", { className: "row-body" },
            h("div", { className: "secondary" }, j.goal),
            h("ol", { className: "steps" }, j.steps.map((s, n) =>
              h("li", { key: n }, s.do, s.screen && h(Fragment, null, " ",
                h("button", { type: "button", className: "link", onClick: () => openScreen(s.screen) }, `▣ ${pageTitles.get(s.screen) || s.screen}`))))),
            j.gaps.length > 0 && h(Field, { label: "빈 곳", value: j.gaps.join("\n") }))))));
  }

  // ---------- scenario ----------
  function Scenarios({ d, openJourney, journeyTitles }) {
    return h("div", { className: "page" }, d.scenarioGroups.map((g) =>
      h("section", { key: g.group },
        h("h2", { className: "section-title" }, g.group),
        h("div", { className: "cards" }, g.scenarios.map((s) =>
          h(Card, { key: s.id },
            h("div", { className: "kv" },
              h("div", null, h("div", { className: "label" }, "누구"), h("div", null, s.who)),
              h(Field, { label: "상황", value: s.situation }),
              s.says.length > 0 && h("div", null, h("div", { className: "label" }, "하는 말"),
                s.says.map((x, n) => h("p", { key: n, className: "quote" }, `“${x}”`))),
              h(Field, { label: "가진 것", value: s.has }),
              h(Field, { label: "바라는 것", value: s.expects }),
              h("div", null, h("div", { className: "label" }, "지나는 journey"),
                h("div", { className: "chips" }, s.journeys.map((id) =>
                  h("button", { key: id, type: "button", className: "link", onClick: () => openJourney(id) }, journeyTitles.get(id) || id)))),
              s.edges.length > 0 && h(Field, { label: "가장자리", value: s.edges.join(" · ") }))))))));
  }

  // ---------- wireframe ----------
  function themeOfPage() {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") return t;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function Frame({ id }) {
    const box = useRef(null);
    const [width, setWidth] = useState(1280);
    useEffect(() => {
      const el = box.current;
      if (!el) return;
      const measure = () => setWidth(el.clientWidth || 1280);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const frameWidth = Math.max(1280, width);
    const scale = width / frameWidth;
    const src = `gallery/index.html?frame=${encodeURIComponent(id)}&theme=${themeOfPage()}`;
    return h("div", { ref: box, className: "frame-box", style: { height: 800 * scale } },
      h("iframe", { key: src, src, title: id, style: { width: frameWidth, height: 800, transform: `scale(${scale})` } }));
  }
  function Wireframes({ d, selected, select, usedBy, openJourney }) {
    const pages = d.gallery.flatMap((g) => g.areas.flatMap((a) => a.pages.map((p) => ({ ...p, area: a, group: g }))));
    const at = Math.max(0, pages.findIndex((p) => p.id === selected));
    const page = pages[at];
    const tocRef = useRef(null);
    useEffect(() => { tocRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" }); }, [page?.id]);
    if (!page) return h("div", { className: "page muted" }, "화면이 없다.");
    const prev = pages[at - 1];
    const next = pages[at + 1];
    const users = usedBy.get(page.id) || [];
    return h("div", { className: "page" },
      h("div", { className: "wf" },
        h("nav", { className: "toc", ref: tocRef }, d.gallery.map((g) =>
          h("div", { key: g.id },
            h("div", { className: "toc-group" }, g.title),
            g.areas.map((a) =>
              h("details", { key: a.id, open: a.id === page.area.id || undefined },
                h("summary", null, a.title, " ", h("span", { className: "count" }, a.pages.length)),
                h("ol", null, a.pages.map((p) =>
                  h("li", { key: p.id },
                    h("button", { type: "button", className: "toc-item", "aria-current": p.id === page.id ? "true" : undefined, onClick: () => select(p.id) }, p.title))))))))),
        h("div", { className: "viewer" },
          h("div", { className: "small muted" }, `${page.group.title} › ${page.area.title}`),
          h("h2", null, page.title),
          h("div", { className: "secondary" }, page.description),
          h(Frame, { id: page.id }),
          users.length > 0 && h("div", null,
            h("div", { className: "label" }, `이 화면을 지나는 journey ${users.length}개`),
            h("div", { className: "chips" }, users.map((j) =>
              h("button", { key: j.id, type: "button", className: "link", onClick: () => openJourney(j.id) }, j.title)))),
          h("div", { className: "nav-row" },
            prev ? h(Button, { variant: "secondary", size: "sm", onClick: () => select(prev.id) }, `← ${prev.title}`) : h("span"),
            next ? h(Button, { variant: "secondary", size: "sm", onClick: () => select(next.id) }, `${next.title} →`) : h("span")))));
  }

  // ---------- 틀 ----------
  function Page({ d }) {
    const [view, setView] = useState("summary");
    const [filter, setFilter] = useState({ status: DEFAULT_STATUS, kind: null, topic: null, q: "", focus: null });
    const [journeyFocus, setJourneyFocus] = useState(null);
    const firstScreen = d.gallery.find((g) => g.id === "screens")?.areas[0]?.pages[0]?.id;
    const [screen, setScreen] = useState(firstScreen || d.gallery[0]?.areas[0]?.pages[0]?.id);
    const pageTitles = useMemo(() => new Map(d.gallery.flatMap((g) => g.areas.flatMap((a) => a.pages.map((p) => [p.id, p.title])))), [d]);
    const journeyTitles = useMemo(() => new Map(d.journeyGroups.flatMap((g) => g.journeys.map((j) => [j.id, j.title]))), [d]);
    const usedBy = useMemo(() => {
      const m = new Map();
      for (const g of d.journeyGroups) for (const j of g.journeys) for (const s of j.steps) {
        if (!s.screen) continue;
        const list = m.get(s.screen) || [];
        if (!list.includes(j)) list.push(j);
        m.set(s.screen, list);
      }
      return m;
    }, [d]);
    const scrollTop = () => window.scrollTo(0, 0);
    const go = (target, f) => {
      if (target === "issues") {
        setFilter({
          status: f.focus ? [] : DEFAULT_STATUS,
          kind: f.kind || null, topic: f.topic || null, q: "", focus: f.focus || null,
        });
      }
      setView(target);
      if (!f || !f.focus) scrollTop();
    };
    const openScreen = (id) => { setScreen(id); setView("wireframes"); scrollTop(); };
    const openJourney = (id) => { setJourneyFocus(id); setView("journeys"); };
    const changeView = (v) => { setView(v); scrollTop(); };
    const inHead = useTabHead(
      { tabs: { items: VIEWS, selected: view }, status: `${fmtTime(d.collectedAt)} 기준` },
      { onTab: changeView },
    );
    let body;
    if (view === "summary") body = h(Summary, { d, go });
    else if (view === "issues") body = h(Issues, { d, filter, setFilter });
    else if (view === "journeys") body = h(Journeys, { d, focus: journeyFocus, openScreen, pageTitles });
    else if (view === "scenarios") body = h(Scenarios, { d, openJourney, journeyTitles });
    else body = h(Wireframes, { d, selected: screen, select: setScreen, usedBy, openJourney });
    return h(Fragment, null,
      inHead ? null : h("div", { className: "page", style: { paddingBottom: 0 } },
        h(Tabs, { value: view, onValueChange: changeView },
          h(TabList, null, VIEWS.map((v) => h(Tab, { key: v.id, value: v.id, size: "sm" }, v.label)))),
        h("div", { className: "small muted" }, `${fmtTime(d.collectedAt)} 기준`)),
      body);
  }

  fetch("data/latest.json")
    .then((r) => r.json())
    .then((d) => render(document.getElementById("root"), h(Page, { d })));
})();
