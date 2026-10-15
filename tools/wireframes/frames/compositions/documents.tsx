// 문서 탭. 탭 key는 파일 경로이고 확장자로 viewer를 고른다(md, text, 이미지, pdf). 본문이 탭 바로 아래부터 시작하고
// 조작은 탭 안 맨 위의 view bar에 있다. Info는 그 칸 오른쪽에 붙어 본문을 좁힌다(Info · Contexts, Outline은 Info 안).
// 본문은 고정 data의 stand-in이다.
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  IconButton,
  Menu,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/design/components";
import {
  editorIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import { Button } from "@lophn/ui-control";

import { Link } from "./link.tsx";
import {
  factsOf,
  type FileInit,
  fileKindOf,
  isOutside,
  metaOf,
  type SaveState,
} from "./project-files/file-data.ts";
import {
  ConflictCompare,
  ConflictToast,
  ReloadedToast,
  SaveMark,
} from "./project-files/notices.tsx";
import {
  ImageViewer,
  PdfViewer,
  TextEditor,
} from "./project-files/viewers.tsx";
import fileStyles from "./project-files/files.module.css";
import { menuIcon } from "./project-files/menu-icons.tsx";
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

/** Info 칸의 탭. Info와 Contexts 둘이다. */
export type InfoPanel = "info" | "contexts";

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

/** 검색 결과로 열린 줄이면 칠하고, 줄 번호를 data로 달아 scroll할 곳을 알린다. */
function Block(
  { at, line, children }: {
    at: number;
    line?: number;
    children: ReactNode;
  },
) {
  return (
    <div
      data-line={at}
      className={at === line ? fileStyles.hitBlock : undefined}
    >
      {children}
    </div>
  );
}

function findingPage(id: string, open: Open, line?: number): Page {
  const finding = FINDINGS.find((item) => item.id === id) ?? FINDINGS[0];
  const title = `${finding.id} · ${finding.title}`;
  return {
    title,
    outline: head(title, "무엇을 봤나", "근거"),
    body: (
      <>
        <h2>## 무엇을 봤나</h2>
        <Block at={12} line={line}>
          <p>
            On{" "}
            <Link onClick={() => open(scenarioTab(finding.scenario))}>
              {finding.scenario}
            </Link>{" "}
            the change moved <code>{finding.effect}</code>. This is a{" "}
            {finding.kind}.
          </p>
        </Block>
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

function experimentPage(id: string, open: Open, line?: number): Page {
  const findings = FINDINGS.filter((item) => item.experiment === id);
  const title = `${id} · ${EXPERIMENT_NAMES[id] ?? id}`;
  return {
    title,
    outline: head(title, "질문", "기준선", "성공 기준", "찾은 것"),
    body: (
      <>
        <h2>## 질문</h2>
        <Block at={7} line={line}>
          <p>
            Do the query tools stop the agent from trying world actions on
            read-only tasks, without hurting the answers?
          </p>
        </Block>
        <h2>## 기준선</h2>
        <Block at={11} line={line}>
          <p>
            The C-049 baseline run, scored with the query-hygiene rubric r2.
          </p>
        </Block>
        <h2>## 성공 기준</h2>
        <Block at={16} line={line}>
          <p>
            Success: world_actions stays at 0 on every read-only scenario.
          </p>
        </Block>
        <h2>## 찾은 것</h2>
        <Block at={24} line={line}>
          <p>F-009 moved world_actions from 3 to 0 on query-leave-still.</p>
        </Block>
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

/** project의 지침은 일반 파일이라 다른 문서와 같은 탭으로 열린다. */
function instructionsPage(): Page {
  return {
    title: "LOPHN",
    outline: head("LOPHN", "Conventions", "Do not touch"),
    body: (
      <>
        <h2>## Conventions</h2>
        <p>
          Scenarios live in eval/scenarios. Every experiment links its findings.
          Keep reports in reports/.
        </p>
        <h2>## Do not touch</h2>
        <p>Never edit a rubric while an experiment that uses it is running.</p>
      </>
    ),
  };
}

function pageFor(path: string, open: Open, line?: number): Page {
  const finding = /^loop\/findings\/(F-\d+)\.md$/.exec(path);
  if (finding) return findingPage(finding[1], open, line);
  const experiment = /^eval\/experiments\/(exp-\d+)/.exec(path);
  if (experiment) return experimentPage(experiment[1], open, line);
  if (path === "LOPHN.md") return instructionsPage();
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
    outline: readonly Heading[] | null;
    /** 지금 읽는 section 제목. */
    current: string;
    panel: InfoPanel;
    onPanel: (panel: InfoPanel) => void;
    open: Open;
    jump: (heading: string) => void;
  },
) {
  const context = contextOf(path);
  const facts = factsOf(path);
  const outside = isOutside(path);
  return (
    <aside className={styles.docInfo} aria-label="File info">
      <Tabs
        value={panel}
        onValueChange={(value) => onPanel(value as InfoPanel)}
      >
        <TabList>
          <Tab value="info">Info</Tab>
          <Tab value="contexts">Contexts</Tab>
        </TabList>
        <TabPanel value="info">
          <dl className={styles.facts}>
            <dt>Path</dt>
            <dd className={styles.mono}>{path}</dd>
            <dt>Size</dt>
            <dd>{facts.size}</dd>
            <dt>Modified</dt>
            <dd>{facts.modified}</dd>
          </dl>
          {outside
            ? (
              <p className={fileStyles.infoNote}>
                This file is outside the project folder.
              </p>
            )
            : null}
          {outline === null ? null : (
            <>
              <h3 className={fileStyles.infoCaption}>Outline</h3>
              <ul className={styles.outlineList} aria-label="Outline">
                {outline.map((heading) => (
                  <li
                    key={heading.text}
                    style={{
                      paddingLeft: `calc(var(--space-5) * ${
                        heading.level - 1
                      })`,
                    }}
                    aria-current={heading.text === current
                      ? "location"
                      : undefined}
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
            </>
          )}
        </TabPanel>
        <TabPanel value="contexts">
          {context === null
            ? <p className={styles.note}>No context includes this file.</p>
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

/** 탭 안 맨 위의 얇은 한 줄 view bar. 오른쪽에 그 탭의 조작, 왼쪽에는 짧은 정보만 둔다(`path`가 비면 아무것도 없다). 탭 줄에는 조작을 두지 않는다. */
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
      {lead ?? (path === "" ? null : (
        <span className={styles.viewPath}>
          {path.split("/").join(" / ")}
        </span>
      ))}
      <div className={styles.viewActions}>{children}</div>
    </div>
  );
}

/** view bar 왼쪽 한 줄. 경로는 위쪽 breadcrumb에 있으니 여기서는 뺀다. 파일 정보와, project 밖이면 짧은 표시, 검색 결과의 줄만 보인다. */
function FileMeta({ path, line }: { path: string; line?: number }) {
  const meta = metaOf(path);
  return (
    <span className={fileStyles.pathRow}>
      {isOutside(path)
        ? <span className={fileStyles.outside}>Outside project</span>
        : null}
      {meta === null ? null : <span className={styles.viewPath}>{meta}</span>}
      {line === undefined
        ? null
        : <span className={fileStyles.lineMark}>Line {line}</span>}
    </span>
  );
}

/**
 * 문서 칸 본문. 확장자로 viewer를 고른다. `info`가 있으면 오른쪽에 info panel이 본문 위로 떠서 열린다(본문 폭은 그대로).
 * 다른 칸은 덮지 않는다. `file`은 이 탭의 시작 상태(저장 상태, 밖에서 바뀐 알림, 열린 줄)다.
 */
export function DocumentPane(
  { path, open, info, onInfo, onToggleInfo, editing, onEditing, file }: {
    path: string;
    open: Open;
    info: InfoPanel | null;
    onInfo: (panel: InfoPanel) => void;
    onToggleInfo: () => void;
    editing: boolean;
    onEditing: () => void;
    file?: FileInit;
  },
) {
  const kind = fileKindOf(path);
  const page = pageFor(path, open, file?.line);
  const main = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(page.outline[0].text);
  const [status, setStatus] = useState<SaveState>(file?.status ?? "saved");
  const [reloaded, setReloaded] = useState(file?.reloaded ?? false);
  const [comparing, setComparing] = useState(file?.compare ?? false);
  // 검색 결과로 열린 줄이 있으면 그 줄로 간다.
  useEffect(() => {
    main.current?.querySelector(`.${fileStyles.hitBlock}`)?.scrollIntoView({
      block: "center",
    });
  }, [file?.line]);
  // Outline의 제목을 누르면 본문에서 그 제목으로 간다.
  const jump = (heading: string) => {
    const target = [...main.current?.querySelectorAll("h1, h2") ?? []].find(
      (element) =>
        element.textContent?.replace(/^#+\s*/, "").trim() === heading,
    );
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrent(heading);
  };
  const conflict = status === "conflict";
  const resolve = () => {
    setStatus("saved");
    setComparing(false);
  };
  return (
    <div className={`${styles.docTab} ${fileStyles.hasToast}`}>
      <ViewBar path={path} lead={<FileMeta path={path} line={file?.line} />}>
        <DocActions
          kind={kind}
          status={status}
          editing={editing}
          infoOpen={info !== null}
          onEditing={onEditing}
          onInfo={onToggleInfo}
        />
      </ViewBar>
      {reloaded && !conflict
        ? <ReloadedToast onDismiss={() => setReloaded(false)} />
        : null}
      {conflict
        ? (
          <ConflictToast
            comparing={comparing}
            onCompare={() => setComparing(!comparing)}
            onKeepMine={resolve}
            onUseDisk={resolve}
          />
        )
        : null}
      <div className={styles.docPane}>
        {conflict && comparing
          ? <ConflictCompare />
          : kind === "markdown"
          ? (
            <div ref={main} className={styles.docMain}>
              <article
                className={`${styles.reading} ${fileStyles.column} ${
                  editing ? styles.editing : ""
                }`}
                contentEditable={editing}
                suppressContentEditableWarning
              >
                <h1>{page.title}</h1>
                {page.body}
              </article>
            </div>
          )
          : kind === "text"
          ? <TextEditor path={path} line={file?.line} />
          : kind === "image"
          ? <ImageViewer path={path} />
          : <PdfViewer path={path} />}
        {info === null ? null : (
          <InfoColumn
            path={path}
            outline={kind === "markdown" ? page.outline : null}
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

/** 문서 탭 안 view bar의 오른쪽 조작: 저장 상태, Edit/Read 바꾸기(md만), Info, …. 이미지와 pdf는 보기만 한다. */
export function DocActions(
  { editing, infoOpen, onEditing, onInfo, kind = "markdown", status = "saved" }:
    {
      editing: boolean;
      infoOpen: boolean;
      onEditing: () => void;
      onInfo: () => void;
      kind?: "markdown" | "text" | "image" | "pdf";
      status?: SaveState;
    },
) {
  const viewOnly = kind === "image" || kind === "pdf";
  return (
    <>
      {viewOnly
        ? <span className={fileStyles.readOnly}>View only</span>
        : <SaveMark status={status} />}
      {kind === "markdown"
        ? (
          <IconButton
            icon={editing ? editorIcons.read : editorIcons.edit}
            label={editing ? "Read" : "Edit"}
            size="sm"
            onClick={onEditing}
          />
        )
        : null}
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
          {
            id: "rename",
            label: "Rename",
            leading: menuIcon(editorIcons.edit),
          },
          {
            id: "delete",
            label: "Delete",
            leading: menuIcon(workspaceIcons.trash),
          },
        ]}
        onSelect={() => {}}
      />
    </>
  );
}
