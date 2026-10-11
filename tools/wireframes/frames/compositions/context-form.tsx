// 새 context form(C11)과 만드는 중 상태(C12). form은 사람 말로 의도와 재료를 받고 계약 말(kind, type, field, public)은
// 쓰지 않는다. [Create with Context Engineer]를 누르면 그 탭이 새 context의 탭(만드는 중)으로 바뀐다.
import { useState } from "react";
import {
  Card,
  IconButton,
  Input,
  lophnSpaceIcons,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Textarea,
  Tree,
  type TreeNode,
  workspaceIcons,
} from "@lophn/design/components";
import { Button, Checkbox, Field } from "@lophn/ui-control";

import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

export const NEW_CONTEXT_TAB: TabSpec = {
  key: "new-context",
  kind: "new-context",
  title: "New context",
};

/** 만드는 중인 context의 탭. 이름·목적·읽은 자료 수가 form에서 온다. */
export const draftTab = (
  name: string,
  draft: NonNullable<TabSpec["draft"]>,
): TabSpec => ({
  key: `context:${name}`,
  kind: "context",
  title: name,
  sub: "overview",
  draft,
});

export const RELEASE_NOTES_DRAFT = {
  purpose:
    "Keep release notes, changelogs and the issues they close findable, so an Operator can draft the next release note.",
  places: 3,
  documents: 24,
} as const;

// 고르는 자료. 폴더 행을 누르면 그 폴더를 통째로 고른다. 펼침은 고정이다.
const PROJECT_TREE: readonly TreeNode[] = [
  { id: "CHANGELOG.md", label: "CHANGELOG.md" },
  {
    id: "docs",
    label: "docs",
    children: [
      {
        id: "docs/issues",
        label: "issues",
        children: [
          { id: "docs/issues/issue-101.md", label: "issue-101.md" },
          { id: "docs/issues/issue-102.md", label: "issue-102.md" },
        ],
      },
      { id: "docs/notes.md", label: "notes.md" },
      {
        id: "docs/releases",
        label: "releases",
        children: [
          { id: "docs/releases/release-2.2.md", label: "release-2.2.md" },
          { id: "docs/releases/release-2.3.md", label: "release-2.3.md" },
        ],
      },
    ],
  },
  {
    id: "eval",
    label: "eval",
    children: [
      { id: "eval/experiments", label: "experiments" },
      { id: "eval/scenarios", label: "scenarios" },
    ],
  },
  {
    id: "loop",
    label: "loop",
    children: [{ id: "loop/findings", label: "findings" }],
  },
];

const EXPANDED = new Set([
  "docs",
  "docs/issues",
  "docs/releases",
  "eval",
  "loop",
]);
const FOLDERS = new Set([
  "docs",
  "docs/issues",
  "docs/releases",
  "eval",
  "eval/experiments",
  "eval/scenarios",
  "loop",
  "loop/findings",
]);
// 고른 자료가 문서 몇 개인지(고정 data).
const DOCUMENTS: Record<string, number> = {
  "docs/releases": 9,
  "docs/issues": 14,
  "eval/experiments": 13,
  "eval/scenarios": 34,
  "loop/findings": 14,
};

const chipName = (id: string) => FOLDERS.has(id) ? `${id}/` : id;

// 고른 것 안에 또 고른 것은 세지 않는다.
function countDocuments(picks: readonly string[]): number {
  return picks
    .filter((id) => !picks.some((other) => id.startsWith(`${other}/`)))
    .reduce((sum, id) => sum + (DOCUMENTS[id] ?? 1), 0);
}

const NEXT = [
  "Context Engineer reads the documents you picked",
  "drafts the overview and searches",
  "runs checks",
  "applies it — you can change anything later",
];

/** C11: 새 context form. */
export function NewContextForm(
  { onCreate, onCancel }: {
    onCreate: (name: string, draft: NonNullable<TabSpec["draft"]>) => void;
    onCancel: () => void;
  },
) {
  const [name, setName] = useState("release-notes");
  const [purpose, setPurpose] = useState<string>(RELEASE_NOTES_DRAFT.purpose);
  const [picks, setPicks] = useState<readonly string[]>([
    "docs/releases",
    "CHANGELOG.md",
    "docs/issues",
  ]);
  const [questions, setQuestions] = useState<readonly string[]>([
    "Which issues did release 2.3 close?",
    "Release notes that mention the sync feature",
    "Issues still open that a release note promised",
  ]);
  const [change, setChange] = useState(true);
  const [component, setComponent] = useState(false);
  const [words, setWords] = useState(
    "hotfix — a release outside the normal schedule",
  );

  const toggle = (id: string) =>
    setPicks((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  const create = () =>
    onCreate(name.trim(), {
      purpose: purpose.trim(),
      places: picks.length,
      documents: countDocuments(picks),
    });

  return (
    <div className={styles.newForm}>
      <div className={styles.formColumn}>
        <h1 className={styles.searchTitle}>New context</h1>
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="What is it for?">
          <Textarea
            rows={3}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </Field>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Where are the documents?</legend>
          <p className={styles.note}>
            Pick folders or files. Context Engineer works out what's inside.
          </p>
          <div
            className={styles.pickTree}
            onClick={(event) => {
              // 폴더 행을 누르면 그 폴더를 고른다(파일은 Tree의 onOpen이 맡는다).
              if (event.ctrlKey || event.metaKey) return;
              const row = (event.target as HTMLElement).closest<HTMLElement>(
                '[role="treeitem"]',
              );
              if (
                row?.getAttribute("aria-expanded") != null && row.dataset.id
              ) {
                toggle(row.dataset.id);
              }
            }}
          >
            <Tree
              nodes={PROJECT_TREE}
              expanded={EXPANDED}
              onExpandedChange={() => {}}
              selectedIds={new Set(picks)}
              onSelectionChange={(ids) => setPicks([...ids])}
              onOpen={toggle}
              label="Project folders"
            />
          </div>
          <ul className={styles.pickChips} aria-label="Picked">
            {picks.map((id) => (
              <li key={id} className={styles.pickChip}>
                <span className={styles.mono}>{chipName(id)}</span>
                <IconButton
                  icon={workspaceIcons.close}
                  label={`Remove ${chipName(id)}`}
                  size="sm"
                  onClick={() => toggle(id)}
                />
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>What do you want to find?</legend>
          <p className={styles.note}>
            Context Engineer turns these into searches.
          </p>
          {questions.map((question, index) => (
            <div key={index} className={styles.questionRow}>
              <Field label={`Question ${index + 1}`}>
                <Input
                  value={question}
                  onChange={(event) =>
                    setQuestions(
                      questions.map((item, at) =>
                        at === index ? event.target.value : item
                      ),
                    )}
                />
              </Field>
              <IconButton
                icon={workspaceIcons.close}
                label={`Remove question ${index + 1}`}
                size="md"
                onClick={() =>
                  setQuestions(questions.filter((_, at) =>
                    at !== index
                  ))}
              />
            </div>
          ))}
          <div>
            <Button
              size="sm"
              icon={lophnSpaceIcons.add}
              onClick={() => setQuestions([...questions, ""])}
            >
              Add a question
            </Button>
          </div>
        </fieldset>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>
            Use things from other contexts{" "}
            <span className={styles.muted}>(optional)</span>
          </legend>
          <p className={styles.note}>Only what other contexts share.</p>
          <Checkbox
            label="Change (from harness)"
            checked={change}
            onCheckedChange={setChange}
          />
          <Checkbox
            label="Component (from harness)"
            checked={component}
            onCheckedChange={setComponent}
          />
        </fieldset>
        <Field
          label="Words to know (optional)"
          help="One per line: the word, a dash, what it means here."
        >
          <Textarea
            rows={2}
            value={words}
            onChange={(event) => setWords(event.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={name.trim() === ""}
            onClick={create}
          >
            Create with Context Engineer
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
        <p className={styles.note}>
          Context Engineer drafts the overview and searches, runs the checks,
          and applies it when they pass. You'll see it in this tab.
        </p>
      </div>
      <aside className={styles.next} aria-label="What happens next">
        <h2>What happens next</h2>
        <ol>
          {NEXT.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </aside>
    </div>
  );
}

type SubTab = "overview" | "search" | "violations" | "glossary" | "contract";

/** C12: 만드는 중인 context 탭. 진행 표시와 아직 확정 아닌 초안. 막히면 오른쪽 대화로 묻는다. */
export function ContextDrafting(
  { name, draft }: { name: string; draft: NonNullable<TabSpec["draft"]> },
) {
  const [tab, setTab] = useState<SubTab>("overview");
  const steps = [
    {
      state: "done",
      text: `Read ${draft.places} places (${draft.documents} documents)`,
    },
    { state: "now", text: "Drafting overview and searches" },
    { state: "later", text: "Run checks" },
    { state: "later", text: "Apply" },
  ] as const;
  const marks = { done: "✓", now: "●", later: "○" } as const;
  return (
    <>
      <div className={styles.ctxHead}>
        <div>
          <div className={styles.ctxTitle}>
            <h1>{name}</h1>
            <span className={styles.chip}>Context</span>
          </div>
          <p className={styles.purpose}>{draft.purpose}</p>
          <p className={styles.applied}>
            <span className={styles.drafting}>
              Context Engineer is drafting · step 2 of 4
            </span>
          </p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as SubTab)}>
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="search">Search</Tab>
          <Tab value="violations">Violations</Tab>
          <Tab value="glossary">Glossary</Tab>
          <Tab value="contract">Contract</Tab>
        </TabList>
        <TabPanel value="overview">
          <ol className={styles.steps} aria-label="Progress">
            {steps.map((step) => (
              <li key={step.text} className={styles[`step_${step.state}`]}>
                <span className={styles.stepMark}>{marks[step.state]}</span>
                {step.text}
              </li>
            ))}
          </ol>
          <section className={styles.fns}>
            <h2>
              Draft overview <span className={styles.chip}>Draft</span>
            </h2>
            <div className={styles.draftRow}>
              <Card>
                <div className={`${styles.draftCard}`}>
                  <h3>Changelog entry</h3>
                  <span className={styles.chip}>Draft</span>
                </div>
              </Card>
              <span className={styles.draftArrow}>
                <span>mentions</span>→
              </span>
              <Card>
                <div className={`${styles.draftCard}`}>
                  <h3>Release</h3>
                  <span className={styles.chip}>Draft</span>
                </div>
              </Card>
              <span className={styles.draftArrow}>
                <span>closes</span>→
              </span>
              <Card>
                <div className={`${styles.draftCard}`}>
                  <h3>Issue</h3>
                  <span className={styles.chip}>Draft</span>
                </div>
              </Card>
            </div>
            <p className={styles.note}>
              Not final. Context Engineer applies it when the checks pass.
            </p>
          </section>
        </TabPanel>
        {(["search", "violations", "glossary", "contract"] as const).map((
          value,
        ) => (
          <TabPanel key={value} value={value}>
            <p className={styles.note}>
              Available after Context Engineer applies the first version.
            </p>
          </TabPanel>
        ))}
      </Tabs>
    </>
  );
}
