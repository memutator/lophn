// 문서 탭. 본문이 탭 바로 아래부터 시작하고(머리 블록 없음), 조작은 탭 줄 오른쪽 끝 icon이다. Info는 그 칸 오른쪽에
// 붙어 본문을 좁힌다(Info · Outline · Contexts). 본문은 고정 data의 stand-in이고 문서마다 제목이 따로 있다.
import { type ReactNode, useRef, useState } from "react";
import {
  editorIcons,
  IconButton,
  Menu,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  workspaceIcons,
} from "@lophn/design/components";
import { Button } from "@lophn/ui-control";

import { Link } from "./link.tsx";
import {
  contextOf,
  contextTab,
  EXPERIMENT_NAMES,
  experimentTab,
  FINDINGS,
  findingTab,
  scenarioTab,
} from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

type Open = (tab: TabSpec) => void;

export type InfoPanel = "info" | "outline" | "contexts";

interface Heading {
  readonly text: string;
  readonly level: 1 | 2;
}

const head = (title: string, ...sections: string[]): readonly Heading[] => [
  { text: title, level: 1 },
  ...sections.map((text) => ({ text, level: 2 as const })),
];

interface Page {
  readonly title: string;
  /** Outline에 나오는 제목과 단계. 첫 항목은 문서 제목이다. */
  readonly outline: readonly Heading[];
  readonly body: ReactNode;
}

function findingPage(id: string, open: Open): Page {
  const finding = FINDINGS.find((item) => item.id === id) ?? FINDINGS[0];
  const title = `${finding.id} · ${finding.title}`;
  return {
    title,
    outline: head(title, "무엇을 봤나", "근거"),
    body: (
      <>
        <h2>## 무엇을 봤나</h2>
        <p>
          On{" "}
          <Link onClick={() => open(scenarioTab(finding.scenario))}>
            {finding.scenario}
          </Link>{" "}
          the change moved <code>{finding.effect}</code>. This is a{" "}
          {finding.kind}.
        </p>
        <h2>## 근거</h2>
        <p>
          Measured in{" "}
          <Link onClick={() => open(experimentTab(finding.experiment))}>
            {finding.experiment}
          </Link>, about harness C-049.
        </p>
      </>
    ),
  };
}

function experimentPage(id: string, open: Open): Page {
  const findings = FINDINGS.filter((item) => item.experiment === id);
  const title = `${id} · ${EXPERIMENT_NAMES[id] ?? id}`;
  return {
    title,
    outline: head(title, "질문", "기준선", "찾은 것"),
    body: (
      <>
        <h2>## 질문</h2>
        <p>
          Do the query tools stop the agent from trying world actions on
          read-only tasks, without hurting the answers?
        </p>
        <h2>## 기준선</h2>
        <p>
          The C-049 baseline run, scored with the query-hygiene rubric r2.
        </p>
        <h2>## 찾은 것</h2>
        <p>
          {findings.length === 0
            ? "Nothing yet."
            : findings.map((item, at) => (
              <span key={item.id}>
                {at === 0 ? "" : " · "}
                <Link onClick={() => open(findingTab(item.id))}>
                  {item.id}
                </Link>
              </span>
            ))}
        </p>
      </>
    ),
  };
}

function scenarioPage(id: string): Page {
  return {
    title: id,
    outline: head(id),
    body: (
      <pre className={styles.code}>
        {`id: ${id}
version: r1
tags: [query, read-only]
stages:
  - ask:    "What is in the chest by the door?"
  - answer: read-only, no world actions
  - score:  rubric query-hygiene`}
      </pre>
    ),
  };
}

function pageFor(path: string, open: Open): Page {
  const finding = /^loop\/findings\/(F-\d+)\.md$/.exec(path);
  if (finding) return findingPage(finding[1], open);
  const experiment = /^eval\/experiments\/(exp-\d+)/.exec(path);
  if (experiment) return experimentPage(experiment[1], open);
  const scenario = /^eval\/scenarios\/([^/]+)\//.exec(path);
  if (scenario) return scenarioPage(scenario[1]);
  const title = (path.split("/").pop() ?? path).replace(/\.md$/, "").replace(
    /-/g,
    " ",
  );
  return {
    title,
    outline: head(title),
    body: <p>Plain notes. Nothing in here is declared by a context.</p>,
  };
}

/** 이 문서가 context 안에서 어떤 종류의 것인가. */
function roleIn(path: string): string {
  if (path.startsWith("eval/experiments/")) return "Experiment";
  if (path.startsWith("eval/scenarios/")) return "Scenario";
  return "Finding";
}

function InfoColumn(
  { path, outline, current, panel, onPanel, open, jump }: {
    path: string;
    outline: readonly Heading[];
    /** 지금 읽는 section 제목. */
    current: string;
    panel: InfoPanel;
    onPanel: (panel: InfoPanel) => void;
    open: Open;
    jump: (heading: string) => void;
  },
) {
  const context = contextOf(path);
  return (
    <aside className={styles.docInfo} aria-label="Document info">
      <Tabs
        value={panel}
        onValueChange={(value) => onPanel(value as InfoPanel)}
      >
        <TabList>
          <Tab value="info">Info</Tab>
          <Tab value="outline">Outline</Tab>
          <Tab value="contexts">Contexts</Tab>
        </TabList>
        <TabPanel value="info">
          <dl className={styles.facts}>
            <dt>Path</dt>
            <dd className={styles.mono}>{path}</dd>
            <dt>Modified</dt>
            <dd>2 hours ago</dd>
          </dl>
        </TabPanel>
        <TabPanel value="outline">
          <ul className={styles.outlineList} aria-label="Outline">
            {outline.map((heading) => (
              <li
                key={heading.text}
                style={{
                  paddingLeft: `calc(var(--space-5) * ${heading.level - 1})`,
                }}
                aria-current={heading.text === current ? "location" : undefined}
                className={heading.text === current
                  ? styles.outlineCurrent
                  : undefined}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => jump(heading.text)}
                >
                  {heading.text}
                </Button>
              </li>
            ))}
          </ul>
        </TabPanel>
        <TabPanel value="contexts">
          {context === null
            ? <p className={styles.note}>No context includes this document.</p>
            : (
              <div className={styles.inContext}>
                <span>
                  {context} — as a{roleIn(path) === "Experiment" ? "n" : ""}
                  {" "}
                  {roleIn(path)}
                </span>
                <Button size="sm" onClick={() => open(contextTab(context))}>
                  Open
                </Button>
              </div>
            )}
        </TabPanel>
      </Tabs>
    </aside>
  );
}

/** 탭 안 맨 위의 얇은 view bar. 왼쪽에 project 안 경로, 오른쪽에 그 탭의 조작. 탭 줄에는 조작을 두지 않는다. */
export function ViewBar(
  { path, lead, children }: {
    path: string;
    /** 경로 대신 왼쪽에 둘 것(Agent 탭의 agent header). */
    lead?: ReactNode;
    children?: ReactNode;
  },
) {
  return (
    <div className={styles.viewBar}>
      {lead ?? (
        <span className={styles.viewPath}>{path.split("/").join(" / ")}</span>
      )}
      <div className={styles.viewActions}>{children}</div>
    </div>
  );
}

/** 문서 칸 본문. `info`가 있으면 오른쪽에 info 칸이 붙어 본문이 좁아진다. 다른 칸은 덮지 않는다. */
export function DocumentPane(
  { path, open, info, onInfo, onToggleInfo, editing, onEditing }: {
    path: string;
    open: Open;
    info: InfoPanel | null;
    onInfo: (panel: InfoPanel) => void;
    onToggleInfo: () => void;
    editing: boolean;
    onEditing: () => void;
  },
) {
  const page = pageFor(path, open);
  const main = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(page.outline[0].text);
  // Outline의 제목을 누르면 본문에서 그 제목으로 간다.
  const jump = (heading: string) => {
    const target = [...main.current?.querySelectorAll("h1, h2") ?? []].find(
      (element) =>
        element.textContent?.replace(/^#+\s*/, "").trim() === heading,
    );
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrent(heading);
  };
  return (
    <div className={styles.docTab}>
      <ViewBar path={path}>
        <DocActions
          editing={editing}
          infoOpen={info !== null}
          onEditing={onEditing}
          onInfo={onToggleInfo}
        />
      </ViewBar>
      <div className={styles.docPane}>
        <div ref={main} className={styles.docMain}>
          <article
            className={`${styles.reading} ${editing ? styles.editing : ""}`}
            contentEditable={editing}
            suppressContentEditableWarning
          >
            <h1>{page.title}</h1>
            {page.body}
          </article>
        </div>
        {info === null ? null : (
          <InfoColumn
            path={path}
            outline={page.outline}
            current={current}
            panel={info}
            onPanel={onInfo}
            open={open}
            jump={jump}
          />
        )}
      </div>
    </div>
  );
}

/** 문서 탭 안 view bar의 오른쪽 조작: Edit/Read 바꾸기, Info, …. */
export function DocActions(
  { editing, infoOpen, onEditing, onInfo }: {
    editing: boolean;
    infoOpen: boolean;
    onEditing: () => void;
    onInfo: () => void;
  },
) {
  return (
    <>
      <IconButton
        icon={editing ? editorIcons.read : editorIcons.edit}
        label={editing ? "Read" : "Edit"}
        size="sm"
        onClick={onEditing}
      />
      <IconButton
        icon={workspaceIcons.infoPanel}
        label="Info"
        size="sm"
        aria-pressed={infoOpen}
        variant={infoOpen ? "secondary" : "ghost"}
        onClick={onInfo}
      />
      <Menu
        trigger={<IconButton icon={editorIcons.menu} label="More" size="sm" />}
        items={[
          { id: "rename", label: "Rename" },
          { id: "move", label: "Move…" },
          { id: "archive", label: "Archive" },
        ]}
        onSelect={() => {}}
      />
    </>
  );
}
