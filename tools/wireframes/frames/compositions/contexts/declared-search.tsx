// 선언된 검색: context 계약에 선언한 검색의 입력 form과 결과(table·board). Finding·Scenario·Experiment는 링크다.
// project 키워드 검색은 이 탭이 아니다.
import { useState } from "react";
import { Card, Icon, iconPixels, Input } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { Button, Field, Select } from "@lophn/ui-control";

import menuStyles from "../../../../../packages/design/components/menu/menu.module.css";
import tableStyles from "../../../../../packages/design/components/table/table.module.css";
import { Link } from "../link.tsx";
import {
  contextTab,
  EXPERIMENT_NAMES,
  experimentTab,
  FINDINGS,
  findingTab,
  scenarioTab,
} from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { SAVED_VIEWS } from "./contexts-data.ts";
import { useOpenTab } from "./open-tab.ts";
import styles from "./contexts.module.css";

// 고르는 입력은 타이핑을 받는 combobox다. 쓰면 맞는 후보만 아래에 걸러진다(ui-control에 combobox가 없어
// Field·Input에 menu CSS Module로 후보 목록을 붙여 만든 look-alike다).
interface Pick {
  value: string;
  label: string;
}

const CHANGES: readonly Pick[] = [
  { value: "any", label: "Any" },
  {
    value: "c-049",
    label: "C-049 · 행동 전에 로드된 월드와 등록 정보를 조회한다",
  },
  { value: "c-041", label: "C-041 · 상자 이름 조회를 한 번에 묶는다" },
  { value: "c-040", label: "C-040 · 레시피 조회 결과를 캐시한다" },
  { value: "c-050", label: "C-050 · 읽기 전용 과제에서 월드 행동을 막는다" },
  { value: "c-038", label: "C-038 · 일정 도구의 재시도를 줄인다" },
];

const METRICS: readonly Pick[] = [
  { value: "any", label: "Any metric" },
  { value: "world_actions", label: "world_actions" },
  { value: "tool_calls", label: "tool_calls" },
  { value: "answer_match", label: "answer_match" },
];

const SCENARIOS: readonly Pick[] = [
  { value: "any", label: "Any" },
  { value: "query-leave-still", label: "query-leave-still" },
  { value: "query-chest-name", label: "query-chest-name" },
  { value: "query-recipe-gap", label: "query-recipe-gap" },
];

function Combo(
  { label, options, defaultText, typed = false }: {
    label: string;
    options: readonly Pick[];
    defaultText: string;
    /** true면 쓰는 중이고 후보가 펼쳐진 상태로 시작한다. */
    typed?: boolean;
  },
) {
  const [text, setText] = useState(defaultText);
  const [shownList, setShownList] = useState(typed);
  const [filtering, setFiltering] = useState(typed);
  const query = text.trim().toLowerCase();
  const shown = filtering && query !== ""
    ? options.filter((option) => option.label.toLowerCase().includes(query))
    : options;
  return (
    <Field label={label}>
      <div className={styles.combo}>
        <Input
          role="combobox"
          aria-expanded={shownList}
          aria-autocomplete="list"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFiltering(true);
            setShownList(true);
          }}
          onFocus={() => setShownList(true)}
          onBlur={() => setShownList(false)}
        />
        <span className={styles.comboCaret}>
          <Icon icon={lophnSpaceIcons.collapse} pixels={iconPixels("base")} />
        </span>
        {shownList
          ? (
            <div
              className={`${menuStyles.menu} ${styles.comboList}`}
              role="listbox"
            >
              {shown.length === 0
                ? <div className={styles.comboEmpty}>No matches</div>
                : shown.map((option, index) => (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={index === 0}
                    className={menuStyles.item}
                    data-highlighted={index === 0 ? "" : undefined}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setText(option.label);
                      setFiltering(false);
                      setShownList(false);
                    }}
                  >
                    {option.label}
                  </div>
                ))}
            </div>
          )
          : null}
      </div>
    </Field>
  );
}

const DECLARATION = `search: findings-about-change
title: Findings about a change
inputs:
  change: { type: pick, of: harness.Change }
  kind:   { type: choose-many, of: Finding.kind }
  metric: { type: choose-one, of: Finding.effects.metric, optional: true }
result:
  view: table
  columns: [finding, kind, scenario, effect, experiment]`;

const BOARD = [
  {
    title: "Draft",
    cards: [
      { id: "exp-013", meta: "4 scenarios" },
      { id: "exp-014", meta: "2 scenarios" },
    ],
  },
  {
    title: "Running",
    cards: [
      { id: "exp-008", meta: "6 scenarios · 3 findings" },
      { id: "exp-011", meta: "3 scenarios" },
      { id: "exp-012", meta: "5 scenarios" },
    ],
  },
  {
    title: "Reported",
    count: 8,
    cards: [
      { id: "exp-007", meta: "5 scenarios · 4 findings" },
      { id: "exp-006", meta: "6 scenarios · 2 findings" },
      { id: "exp-005", meta: "4 scenarios · 1 finding" },
    ],
  },
] as const;

const PAGE_SIZE = 5;
const KINDS = ["improvement", "regression", "neutral"] as const;

type Searching = "findings" | "experiments";
const SEARCH_NAMES: readonly { name: string; id?: Searching }[] = [
  { name: "Findings about a change", id: "findings" },
  { name: "Experiments by status", id: "experiments" },
  { name: "Scenarios using a rubric" },
];

export function DeclaredSearch(
  { initial = "findings", typed = false }: {
    initial?: Searching;
    typed?: boolean;
  },
) {
  const open = useOpenTab();
  const [searching, setSearching] = useState<Searching>(initial);
  const [kinds, setKinds] = useState<readonly string[]>([
    "improvement",
    "regression",
  ]);
  const [page, setPage] = useState(0);
  const [context, setContext] = useState("eval");
  const rows = FINDINGS.filter((item) => kinds.includes(item.kind));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = rows.length === 0 ? 0 : current * PAGE_SIZE + 1;
  const to = current * PAGE_SIZE + slice.length;
  const side = (
    <aside className={styles.searchSide}>
      <Field label="Context">
        <Select
          options={[{ value: "eval", label: "eval" }, {
            value: "harness",
            label: "harness",
          }]}
          value={context}
          onValueChange={setContext}
        />
      </Field>
      <Link onClick={() => open(contextTab(context))}>Open context</Link>
      <div>
        <p className={styles.groupLabel}>Searches</p>
        <ul className={styles.rows}>
          {SEARCH_NAMES.map((item) => (
            <li
              key={item.name}
              className={item.id === searching ? styles.selected : undefined}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={item.id ? () => setSearching(item.id!) : undefined}
              >
                {item.name}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className={styles.groupLabel}>Saved views</p>
        <ul className={styles.rows}>
          {SAVED_VIEWS.map((name) => (
            <li key={name}>
              <Button
                variant="ghost"
                size="sm"
                icon={lophnSpaceIcons.savedView}
              >
                {name}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
  if (searching === "experiments") {
    return (
      <div className={styles.search}>
        {side}
        <div className={styles.results}>
          <div className={styles.resultsColumn}>
            <h1 className={styles.title}>Experiments by status</h1>
            <div className={styles.formRow}>
              <Combo label="Scenario" options={SCENARIOS} defaultText="Any" />
              <Combo label="About change" options={CHANGES} defaultText="Any" />
            </div>
            <div className={styles.board}>
              {BOARD.map((column) => (
                <section key={column.title} className={styles.boardColumn}>
                  <h2 className={styles.boardHead}>
                    {column.title}{" "}
                    <span className={styles.muted}>
                      {"count" in column ? column.count : column.cards.length}
                    </span>
                  </h2>
                  {column.cards.map((card) => (
                    <Card key={card.id}>
                      <Link
                        onClick={() => open(experimentTab(card.id))}
                      >
                        {card.id}
                      </Link>{" "}
                      · {EXPERIMENT_NAMES[card.id]}
                      <p className={styles.note}>{card.meta}</p>
                    </Card>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.search}>
      {side}
      <div className={styles.results}>
        <div className={styles.resultsColumn}>
          <h1 className={styles.title}>Findings about a change</h1>
          <div className={styles.form}>
            <Combo
              label="Change"
              options={CHANGES}
              defaultText={typed ? "C-04" : "Any"}
              typed={typed}
            />
            <div className={styles.formGroup}>
              <span className={styles.legend}>Kind</span>
              <div className={styles.chips}>
                {KINDS.map((kind) => {
                  const on = kinds.includes(kind);
                  return (
                    <Button
                      key={kind}
                      variant={on ? "secondary" : "ghost"}
                      size="sm"
                      aria-pressed={on}
                      onClick={() => {
                        setKinds(
                          on
                            ? kinds.filter((item) => item !== kind)
                            : [...kinds, kind],
                        );
                        setPage(0);
                      }}
                    >
                      {on ? `✓ ${kind}` : kind}
                    </Button>
                  );
                })}
              </div>
            </div>
            <Combo label="Metric" options={METRICS} defaultText="Any metric" />
            <div className={styles.actions}>
              <Button variant="primary">Search</Button>
              <Button>Save as view</Button>
            </div>
          </div>
          <p className={styles.resultCount}>{rows.length} findings</p>
          <div className={`${tableStyles.scroller} ${styles.resultTable}`}>
            <table className={tableStyles.table} data-density="compact">
              <colgroup>
                <col style={{ width: "40%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "13%" }} />
              </colgroup>
              <thead>
                <tr>
                  {["Finding", "Kind", "Scenario", "Effect", "Experiment"].map(
                    (header) => (
                      <th key={header} scope="col" className={tableStyles.head}>
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {slice.map((finding) => (
                  <tr key={finding.id} className={tableStyles.row}>
                    <td className={tableStyles.text}>
                      <Link
                        onClick={() =>
                          open(findingTab(finding.id))}
                      >
                        {finding.id} · {finding.title}
                      </Link>
                    </td>
                    <td className={tableStyles.text}>
                      <span className={styles[finding.kind]}>
                        {finding.kind}
                      </span>
                    </td>
                    <td className={tableStyles.text}>
                      <Link
                        onClick={() =>
                          open(scenarioTab(finding.scenario))}
                      >
                        {finding.scenario}
                      </Link>
                    </td>
                    <td className={tableStyles.text}>{finding.effect}</td>
                    <td className={tableStyles.text}>
                      <Link
                        onClick={() => open(experimentTab(finding.experiment))}
                      >
                        {finding.experiment}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pager}>
            <span className={styles.muted}>
              {from}–{to} of {rows.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ‹ Prev
            </Button>
            {Array.from({ length: pages }, (_, index) => (
              <Button
                key={index}
                size="sm"
                variant={index === current ? "secondary" : "ghost"}
                aria-current={index === current ? "page" : undefined}
                onClick={() => setPage(index)}
              >
                {String(index + 1)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next ›
            </Button>
          </div>
          <div className={styles.declaration}>
            <span className={styles.declarationHead}>Show declaration ▾</span>
            <pre className={styles.code}>{DECLARATION}</pre>
            <p className={styles.note}>
              Written by Project Manager. lophn draws the form and the table
              from it with the shared parts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 선언된 검색의 탭. 본문을 직접 준다(종류별 본문 대신). */
export const declaredSearchTab = (
  initial: Searching = "findings",
  typed = false,
): TabSpec => ({
  key: "search:declared",
  kind: "search",
  title: "eval",
  body: <DeclaredSearch initial={initial} typed={typed} />,
});
