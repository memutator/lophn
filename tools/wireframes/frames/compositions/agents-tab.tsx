// project의 Agents 탭(A7)과 agent 편집 탭(A8). 카드 목록과 Instructions·Skills·MCP servers 세 section, 그리고
// Operator 하나의 form. 정의는 project 폴더가 아니라 lophn에 저장된다.
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  lophnSpaceIcons,
  Select,
  Switch,
  Textarea,
} from "@lophn/design/components";

import {
  LOPHN_MD_PREVIEW,
  operatorTab,
  PROJECT_MCP,
  PROJECT_SKILLS,
  type ToggleItem,
} from "./agents-data.ts";
import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

type Open = (tab: TabSpec, other?: boolean) => void;

const STATUS_TEXT = {
  connected: "Connected",
  "needs-sign-in": "Needs sign-in",
  off: "Off",
} as const;

/** 켬/끔 줄 목록(skill·MCP server). MCP는 이름 옆에 상태 점이 있다. */
export function ToggleList({ items }: { items: readonly ToggleItem[] }) {
  return (
    <ul className={a.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={a.toggleRow}>
          <span className={a.toggleName}>
            {item.status === undefined ? null : (
              <span
                className={`${a.stateDot} ${a[`mcp_${item.status}`]}`}
                role="img"
                aria-label={STATUS_TEXT[item.status]}
                title={STATUS_TEXT[item.status]}
              />
            )}
            <Switch label={item.name} defaultChecked={item.on} />
          </span>
          <span className={a.toggleDetail}>
            {item.detail}
            {item.status === undefined ? "" : ` · ${STATUS_TEXT[item.status]}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface AgentCard {
  readonly id: string;
  readonly name: string;
  readonly kind: "Built in" | "Operator";
  readonly text: string;
  readonly facts: readonly { text: string; tone?: "good" | "critical" }[];
}

const CARDS: readonly AgentCard[] = [
  {
    id: "lophn",
    name: "lophn",
    kind: "Built in",
    text: "Talks with you about this project.",
    facts: [{ text: "Model: default (Sonnet 5.5)" }],
  },
  {
    id: "engineer",
    name: "Context Engineer",
    kind: "Built in",
    text: "Keeps contexts and searches in shape.",
    facts: [{ text: "Model: default (Sonnet 5.5)" }],
  },
  {
    id: "weekly-eval-report",
    name: "Weekly eval report",
    kind: "Operator",
    text: "Every Monday 09:00",
    facts: [
      { text: "Last run 2 days ago ✓", tone: "good" },
      { text: "Model: Sonnet 5.5" },
      { text: "2 skills · 1 MCP" },
    ],
  },
  {
    id: "nightly-scenario-check",
    name: "Nightly scenario check",
    kind: "Operator",
    text: "Every day 02:00",
    facts: [{ text: "Last run failed ✕", tone: "critical" }],
  },
];

/** A7: project의 Agents 탭. */
export function AgentsBody({ open }: { open: Open }) {
  return (
    <div className={a.agentsPage}>
      <h1 className={styles.searchTitle}>Agents in phroner</h1>
      <div className={styles.cards}>
        {CARDS.map((card) => (
          <Card key={card.id}>
            <div className={styles.cardHead}>
              <h3>{card.name}</h3>
              <span className={styles.chip}>{card.kind}</span>
            </div>
            <p className={styles.purpose}>{card.text}</p>
            <ul className={styles.rows}>
              {card.facts.map((fact) => (
                <li
                  key={fact.text}
                  className={fact.tone === "good"
                    ? styles.good
                    : fact.tone === "critical"
                    ? styles.regression
                    : undefined}
                >
                  {fact.text}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <Button onClick={() => open(operatorTab(card.id))}>Open</Button>
            </div>
          </Card>
        ))}
      </div>
      <div className={styles.newContext}>
        <Button
          variant="primary"
          icon={lophnSpaceIcons.add}
          onClick={() => open(operatorTab("new"))}
        >
          New Operator
        </Button>
      </div>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>Instructions</h2>
          <Button size="sm">Edit</Button>
        </div>
        <p className={a.sectionLead}>LOPHN.md for agents in phroner</p>
        <pre className={styles.code}>{LOPHN_MD_PREVIEW}</pre>
        <p className={styles.note}>
          Your project's AGENTS.md is for coding agents; lophn agents read
          LOPHN.md.
        </p>
      </section>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>Skills</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add skill</Button>
        </div>
        <ToggleList items={PROJECT_SKILLS} />
      </section>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>MCP servers</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add server</Button>
        </div>
        <ToggleList items={PROJECT_MCP} />
      </section>
      <p className={`${styles.note} ${a.stored}`}>
        Stored in lophn, not in your project folder.
      </p>
    </div>
  );
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
].map((day) => ({ value: day, label: day }));

const INSTRUCTIONS = `# Weekly eval report
Write the report for the week that just ended.

1. Read the findings added since last Monday.
2. Group them as improvements and regressions.
3. Write docs/reports/<year>-w<week>.md and link each finding.
Keep it under one page. Name the scenario for every regression.`;

const MODELS = [
  { value: "default", label: "Use default (Sonnet 5.5)" },
  { value: "sonnet", label: "Sonnet 5.5" },
  { value: "opus", label: "Opus 5.5" },
  { value: "haiku", label: "Haiku 5.5" },
];
const EFFORTS = ["Low", "Medium", "High"].map((value) => ({
  value,
  label: value,
}));

/** A8: Operator 하나의 편집 탭. 내장 agent는 이름·하는 일·주기를 바꾸지 못한다. */
export function OperatorEditor(
  { id, onDone }: { id: string; onDone: () => void },
) {
  const builtIn = id === "lophn" || id === "engineer";
  const fresh = id === "new";
  const name = fresh
    ? ""
    : id === "lophn"
    ? "lophn"
    : id === "engineer"
    ? "Context Engineer"
    : id === "nightly-scenario-check"
    ? "Nightly scenario check"
    : "Weekly eval report";
  const weekly = id === "weekly-eval-report";
  return (
    <div className={a.editorPage}>
      <div className={a.editorHead}>
        <h1 className={styles.searchTitle}>
          {fresh ? "New Operator" : name}
        </h1>
        {fresh || builtIn ? null : (
          <p className={a.lastRun}>
            <span className={weekly ? styles.good : styles.regression}>
              {weekly ? "Last run 2 days ago ✓" : "Last run failed ✕"}
            </span>
            {" · "}
            <Button size="sm" variant="ghost">See runs</Button>
          </p>
        )}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => event.preventDefault()}
      >
        {builtIn
          ? (
            <p className={styles.purpose}>
              {id === "lophn"
                ? "Built in. Talks with you about this project."
                : "Built in. Keeps contexts and searches in shape."}{" "}
              It reads LOPHN.md for phroner.
            </p>
          )
          : (
            <>
              <Field label="Name">
                <Input defaultValue={name} />
              </Field>
              <Field label="What it does">
                <Input
                  defaultValue={fresh
                    ? ""
                    : weekly
                    ? "Writes the weekly eval report from the new findings."
                    : "Runs every scenario overnight and lists what failed."}
                />
              </Field>
              <Field
                label="Instructions"
                help="Markdown. These come after LOPHN.md."
              >
                <Textarea
                  rows={8}
                  defaultValue={fresh
                    ? ""
                    : weekly
                    ? INSTRUCTIONS
                    : "Run all scenarios in eval/scenarios. Write the failures to eval/runs/<date>.md."}
                />
              </Field>
              <fieldset className={a.group}>
                <legend className={styles.legend}>Schedule</legend>
                <div className={a.scheduleRow}>
                  <span className={a.scheduleText}>Every</span>
                  <Field label="Day">
                    <Select options={DAYS} defaultValue="Monday" />
                  </Field>
                  <span className={a.scheduleText}>at</span>
                  <Field label="Time">
                    <Input defaultValue={weekly ? "09:00" : "02:00"} />
                  </Field>
                  <Button>Run now</Button>
                </div>
              </fieldset>
            </>
          )}
        <div className={a.pairRow}>
          <Field label="Model">
            <Select
              options={MODELS}
              defaultValue={weekly ? "sonnet" : "default"}
            />
          </Field>
          <Field label="Effort">
            <Select options={EFFORTS} defaultValue="Medium" />
          </Field>
        </div>
        <fieldset className={a.group}>
          <legend className={styles.legend}>Reads contexts</legend>
          <div className={a.checks}>
            <Checkbox label="eval" defaultChecked />
            <Checkbox label="harness" />
          </div>
        </fieldset>
        <fieldset className={a.group}>
          <legend className={styles.legend}>Skills</legend>
          <div className={a.checks}>
            <Checkbox label="weekly-report" defaultChecked={weekly} />
            <Checkbox label="eval-metrics" defaultChecked={weekly} />
            <Checkbox label="scenario-authoring" />
          </div>
        </fieldset>
        <fieldset className={a.group}>
          <legend className={styles.legend}>MCP servers</legend>
          <div className={a.checks}>
            <Checkbox label="github" defaultChecked={weekly} />
            <Checkbox label="linear" />
          </div>
        </fieldset>
        <div className={a.pairRow}>
          <Field label="Permissions">
            <Select
              options={[
                { value: "ask", label: "Ask first" },
                { value: "edits", label: "Allow document edits" },
              ]}
              defaultValue="ask"
            />
          </Field>
          <Field label="Can write in">
            <Input defaultValue={fresh ? "" : "docs/reports/"} />
          </Field>
        </div>
        {builtIn ? null : (
          <Field label="Leaves documents in">
            <Input defaultValue={fresh ? "" : "docs/reports/"} />
          </Field>
        )}
        <div className={styles.actions}>
          <Button variant="primary" onClick={onDone}>Save</Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
        <p className={styles.note}>
          Stored in lophn, not in your project folder.
        </p>
      </form>
    </div>
  );
}
