// project 화면의 탭 본문들(대화·터미널·검색·Contexts·객체). 탭을 여는 일은 `open`으로 부른 쪽(ProjectApp)이 한다.
import { type ReactNode, useState } from "react";
import {
  Card,
  conversationIcons,
  Icon,
  IconButton,
  iconPixels,
  Input,
  lophnSpaceIcons,
  Textarea,
} from "@lophn/design/components";
import { Button, Field, Select } from "@lophn/ui-control";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import tableStyles from "../../../../packages/design/components/table/table.module.css";
import { CHAT, Mono, type TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

export type Open = (tab: TabSpec) => void;

/** lophn 대화 탭. */
export function Conversation() {
  return (
    <div className={styles.chat}>
      <div className={styles.turns}>
        {CHAT.map((turn, index) => (
          <div
            key={index}
            className={`${styles.turn} ${
              turn.who === "You" ? styles.mine : ""
            }`}
          >
            <span className={styles.who}>{turn.who}</span>
            <p className={styles.said}>{turn.text}</p>
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <Field label="Message">
          <Textarea rows={2} placeholder="Message lophn" />
        </Field>
        <IconButton
          icon={conversationIcons.send}
          label="Send"
          variant="secondary"
        />
      </div>
    </div>
  );
}

const PROMPT = "mina@lophn:~/work/phroner$ ";

/** 새 터미널 탭. PTY 없이 고정된 출력만 보인다. */
export function TerminalBody() {
  return (
    <pre className={styles.terminal}>
      {`${PROMPT}ls\ndocs  eval  loop\n${PROMPT}git status --short\n M eval/experiments/exp-008-query-tools.md\n${PROMPT}`}
    </pre>
  );
}

// 도메인 객체: 검색 결과의 Finding·Scenario·Experiment는 링크이고 누르면 객체 탭이 열린다.

export interface FindingRow {
  id: string;
  title: string;
  kind: "improvement" | "regression";
  scenario: string;
  effect: string;
  experiment: string;
}

const row = (
  id: string,
  title: string,
  kind: FindingRow["kind"],
  scenario: string,
  effect: string,
  experiment: string,
): FindingRow => ({ id, title, kind, scenario, effect, experiment });

// 먼저 만진 순서. 첫 page에 F-009가 보인다.
export const FINDINGS: readonly FindingRow[] = [
  row(
    "F-009",
    "읽고 멈추는 과제에서 월드 행동 시도가 사라진다",
    "improvement",
    "query-leave-still",
    "world_actions 3 → 0",
    "exp-008",
  ),
  row(
    "F-010",
    "상자 이름을 묻는 과제에서 불필요한 열기 호출이 줄었다",
    "improvement",
    "query-chest-name",
    "tool_calls 5 → 2",
    "exp-008",
  ),
  row(
    "F-011",
    "레시피 빈틈을 묻는 과제에서 오답이 늘었다",
    "regression",
    "query-recipe-gap",
    "answer_match 0.8 → 0.6",
    "exp-008",
  ),
  row(
    "F-013",
    "길 찾기 과제의 단계 수가 줄었다",
    "improvement",
    "query-route-plan",
    "steps 12 → 7",
    "exp-011",
  ),
  row(
    "F-014",
    "상자 이름 과제의 호출이 한 번 더 줄었다",
    "improvement",
    "query-chest-name",
    "tool_calls 4 → 3",
    "exp-011",
  ),
  row(
    "F-001",
    "일정 도구가 같은 요청을 두 번 보내지 않는다",
    "improvement",
    "sched-basic",
    "retries 4 → 1",
    "exp-005",
  ),
  row(
    "F-002",
    "일정 겹침 확인에서 오답이 줄었다",
    "improvement",
    "sched-overlap",
    "answer_match 0.6 → 0.9",
    "exp-005",
  ),
  row(
    "F-003",
    "긴 일정 목록에서 응답이 느려졌다",
    "regression",
    "sched-long-list",
    "latency_s 3 → 6",
    "exp-005",
  ),
  row(
    "F-004",
    "재고 읽기에서 불필요한 쓰기 시도가 없어졌다",
    "improvement",
    "inv-read",
    "world_actions 2 → 0",
    "exp-006",
  ),
  row(
    "F-005",
    "재고 합계 계산이 정확해졌다",
    "improvement",
    "inv-total",
    "answer_match 0.7 → 1.0",
    "exp-006",
  ),
  row(
    "F-006",
    "레시피 조회 결과 캐시로 호출이 줄었다",
    "improvement",
    "recipe-lookup",
    "tool_calls 6 → 3",
    "exp-007",
  ),
  row(
    "F-007",
    "레시피 이름이 겹칠 때 엉뚱한 결과를 고른다",
    "regression",
    "recipe-dup",
    "answer_match 0.9 → 0.7",
    "exp-007",
  ),
  row(
    "F-008",
    "재료 대체 질문에서 답이 길어졌다",
    "improvement",
    "recipe-swap",
    "tokens 900 → 600",
    "exp-007",
  ),
  row(
    "F-012",
    "상자 위치 질문에서 첫 응답이 빨라졌다",
    "improvement",
    "query-chest-name",
    "latency_s 5 → 3",
    "exp-011",
  ),
];

const EXPERIMENT_NAMES: Record<string, string> = {
  "exp-005": "schedule tools",
  "exp-006": "inventory read",
  "exp-007": "recipe lookup",
  "exp-008": "query tools",
  "exp-011": "chest names",
  "exp-012": "ftb quests 021 q8",
  "exp-013": "ftb quests 2",
  "exp-014": "route planner",
};

function Link(
  { onClick, children }: { onClick: () => void; children: ReactNode },
) {
  return (
    <a
      className={styles.link}
      href="#"
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  );
}

/** 탭을 여는 요청. 객체 탭의 key는 대상이 같으면 같아 이미 열린 탭을 고른다. */
export const objectTab = (
  kind: "finding" | "scenario" | "experiment",
  id: string,
): TabSpec => ({
  key: `object:${kind}:${id}`,
  kind: "object",
  title: id,
  label: kind[0].toUpperCase() + kind.slice(1),
  sub: `${kind}:${id}`,
});

export const documentTab = (path: string): TabSpec => ({
  key: `doc:${path}`,
  kind: "document",
  title: path.split("/").pop() ?? path,
  sub: path,
});

const Field2 = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className={styles.objField}>
    <span className={styles.objName}>{name}</span>
    <span>{children}</span>
  </div>
);

/** 객체 탭 본문: 선언된 field를 사람 말로, 관계는 링크, 맨 아래에 원본 문서. */
export function ObjectBody({ target, open }: { target: string; open: Open }) {
  const [kind, id] = target.split(":") as [string, string];
  let title = id;
  let where = "Finding in eval";
  let fields: ReactNode = null;
  let relations: ReactNode = null;
  let source = "";
  if (kind === "finding") {
    const finding = FINDINGS.find((item) => item.id === id) ?? FINDINGS[0];
    title = `${finding.id} · ${finding.title}`;
    fields = (
      <>
        <Field2 name="Kind">{finding.kind}</Field2>
        <Field2 name="Effect">{finding.effect}</Field2>
      </>
    );
    relations = (
      <>
        <Field2 name="About">
          <Link onClick={() => {}}>C-049 (harness)</Link>
        </Field2>
        <Field2 name="From scenario">
          <Link onClick={() => open(objectTab("scenario", finding.scenario))}>
            {finding.scenario}
          </Link>
        </Field2>
        <Field2 name="From experiment">
          <Link
            onClick={() => open(objectTab("experiment", finding.experiment))}
          >
            {finding.experiment}
          </Link>
        </Field2>
      </>
    );
    source = `loop/findings/${finding.id}.md`;
  } else if (kind === "scenario") {
    where = "Scenario in eval";
    const findings = FINDINGS.filter((item) => item.scenario === id);
    fields = (
      <>
        <Field2 name="Tags">query · read-only</Field2>
        <Field2 name="Stages">ask · answer · score</Field2>
      </>
    );
    relations = (
      <>
        <Field2 name="Graded by">
          <Link onClick={() => {}}>rubric schedule-quality</Link>
        </Field2>
        <Field2 name="Used by">
          {[...new Set(findings.map((item) => item.experiment))].map(
            (experiment) => (
              <span key={experiment} className={styles.objLink}>
                <Link onClick={() => open(objectTab("experiment", experiment))}>
                  {experiment}
                </Link>
              </span>
            ),
          )}
        </Field2>
        <Field2 name="Findings">
          {findings.map((item) => (
            <span key={item.id} className={styles.objLink}>
              <Link
                onClick={() =>
                  open(objectTab("finding", item.id))}
              >
                {item.id}
              </Link>
            </span>
          ))}
        </Field2>
      </>
    );
    source = `eval/scenarios/${id}/r2.yaml`;
  } else {
    where = "Experiment in eval";
    title = `${id} · ${EXPERIMENT_NAMES[id] ?? id}`;
    const findings = FINDINGS.filter((item) => item.experiment === id);
    fields = (
      <>
        <Field2 name="Status">running</Field2>
        <Field2 name="Question">
          Does the change help on read-only tasks?
        </Field2>
        <Field2 name="Baseline">The C-049 baseline run</Field2>
      </>
    );
    relations = (
      <>
        <Field2 name="Checks">
          <Link onClick={() => {}}>C-049 (harness)</Link>
        </Field2>
        <Field2 name="Runs on">
          {[...new Set(findings.map((item) => item.scenario))].map(
            (scenario) => (
              <span key={scenario} className={styles.objLink}>
                <Link onClick={() => open(objectTab("scenario", scenario))}>
                  {scenario}
                </Link>
              </span>
            ),
          )}
        </Field2>
        <Field2 name="Produces">
          {findings.map((item) => (
            <span key={item.id} className={styles.objLink}>
              <Link
                onClick={() =>
                  open(objectTab("finding", item.id))}
              >
                {item.id}
              </Link>
            </span>
          ))}
        </Field2>
      </>
    );
    source = id === "exp-008"
      ? "eval/experiments/exp-008-query-tools.md"
      : `eval/experiments/${id}.md`;
  }
  return (
    <article className={styles.object}>
      <h1>{title}</h1>
      <p className={styles.note}>{where}</p>
      <h2 className={styles.objHead}>Fields</h2>
      {fields}
      <h2 className={styles.objHead}>Relations</h2>
      {relations}
      <p className={styles.objSource}>
        Source: <Mono>{source}</Mono>{" "}
        <Button size="sm" onClick={() => open(documentTab(source))}>
          Open document
        </Button>
      </p>
    </article>
  );
}

/** Contexts 탭: 이 project의 context 목록. */
export function ContextsBody({ open }: { open: Open }) {
  const cards = [
    {
      name: "eval",
      purpose:
        "Keep experiments, scenarios, rubrics and findings of the eval loop findable.",
      kinds: "4 kinds of things (Experiment, Scenario, Rubric, Finding)",
      version: "Version r3, tests passed",
      violations: "2 violations",
      warn: true,
      used: "Used by 1 Operator",
    },
    {
      name: "harness",
      purpose: "Keep harness changes and components findable.",
      kinds: "2 kinds of things (Change, Component)",
      version: "Version r5, tests passed",
      violations: "no violations",
      warn: false,
      used: "Used by 2 Operators",
    },
  ];
  return (
    <div className={styles.contexts}>
      <h1 className={styles.searchTitle}>Contexts in phroner</h1>
      <div className={styles.cards}>
        {cards.map((card) => (
          <Card key={card.name}>
            <div className={styles.cardHead}>
              <h3>{card.name}</h3>
            </div>
            <p className={styles.purpose}>{card.purpose}</p>
            <ul className={styles.rows}>
              <li>{card.kinds}</li>
              <li>{card.version}</li>
              <li className={card.warn ? styles.warnText : undefined}>
                {card.violations}
              </li>
              <li>{card.used}</li>
            </ul>
            <div className={styles.actions}>
              <Button
                onClick={() =>
                  open({
                    key: `context:${card.name}`,
                    kind: "context",
                    title: card.name,
                    sub: "overview",
                  })}
              >
                Open
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <div className={styles.newContext}>
        <Button variant="primary" icon={lophnSpaceIcons.add}>
          New context
        </Button>
        <p className={styles.note}>
          Context Engineer sets it up with you in a conversation.
        </p>
      </div>
    </div>
  );
}

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

/** Search 탭: 선언된 검색의 입력 form과 결과(table·board). Finding·Scenario·Experiment는 링크다. */
export function SearchBody(
  { initial = "findings", typed = false, open }: {
    initial?: Searching;
    typed?: boolean;
    open: Open;
  },
) {
  const [searching, setSearching] = useState<Searching>(initial);
  const [kinds, setKinds] = useState<readonly string[]>([
    "improvement",
    "regression",
  ]);
  const [page, setPage] = useState(0);
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
          defaultValue="eval"
        />
      </Field>
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
          {["Findings for C-049", "Running experiments"].map((name) => (
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
          <h1 className={styles.searchTitle}>Experiments by status</h1>
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
                      onClick={() => open(objectTab("experiment", card.id))}
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
    );
  }
  return (
    <div className={styles.search}>
      {side}
      <div className={styles.results}>
        <h1 className={styles.searchTitle}>Findings about a change</h1>
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
        <div className={tableStyles.scroller}>
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
                        open(objectTab("finding", finding.id))}
                    >
                      {finding.id} · {finding.title}
                    </Link>
                  </td>
                  <td className={tableStyles.text}>
                    <span className={styles[finding.kind]}>{finding.kind}</span>
                  </td>
                  <td className={tableStyles.text}>
                    <Link
                      onClick={() =>
                        open(objectTab("scenario", finding.scenario))}
                    >
                      {finding.scenario}
                    </Link>
                  </td>
                  <td className={tableStyles.text}>{finding.effect}</td>
                  <td className={tableStyles.text}>
                    <Link
                      onClick={() =>
                        open(objectTab("experiment", finding.experiment))}
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
            Written by Context Engineer. lophn draws the form and the table from
            it with the shared parts.
          </p>
        </div>
      </div>
    </div>
  );
}
