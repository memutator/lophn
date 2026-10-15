// Part 2: 파일 탭(viewer, 저장, 밖에서 바뀐 파일), project 키워드 검색, 경로로 열기, sidebar의 Agents 묶음.
// 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import type { ReactNode } from "react";
import { Dialog, FileIcon } from "@lophn/design/components";
import { Button } from "@lophn/ui-control";

import {
  editorIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";
import { AGENT_ROWS } from "../agents-data.ts";
import { documentTab } from "../phroner-data.ts";
import { ProjectApp, type ProjectAppProps } from "../project-app.tsx";
import { StaticMenu, type TabSpec } from "../project-window.tsx";
import styles from "../compose.module.css";
import fileStyles from "./files.module.css";
import { menuIcon, menuLead } from "./menu-icons.tsx";

const EXP = "eval/experiments/exp-008-query-tools.md";
const EXP_OTHER = "eval/experiments/exp-012-ftb-quests-021-q8.md";
const RUBRIC = "eval/rubrics/query-hygiene.json";
const SCENARIO = "eval/scenarios/query-leave-still/r1.yaml";
const IMAGE = "assets/chest-layout.png";
const PDF = "reports/weekly-12.pdf";
const OUTSIDE = "/home/mina/Downloads/api-spec.yaml";

const FILES_TAB: TabSpec = {
  key: "search:files",
  kind: "search",
  title: "phroner",
  sub: "files",
};

// 한 칸에 탭을 열어 고른다.
function solo(tab: TabSpec, extra: Partial<ProjectAppProps> = {}) {
  return (
    <ProjectApp
      sidebar={{ current: tab.sub }}
      panes={[{ tabs: [tab], selected: tab.key }]}
      {...extra}
    />
  );
}

/** sidebar · Agent. agent마다 그 agent의 열린 session이 아래에 들여 쓰여 있고 맨 아래에 Recent가 있다. 묶음 머리의 Manage는 Agents 탭을 연다. */
export function AgentsGroup() {
  const manager = AGENT_ROWS.find((row) => !row.operator && row.id !== "lophn");
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ mode: "agent", hoverAgent: manager?.id }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

/** sidebar · Explorer. 루트를 고르는 menu를 연 상태다. 연결한 폴더 둘과 그 하위 폴더가 있고 tree에는 확장자·폴더별 아이콘이 붙는다. */
export function ExplorerRootMenu() {
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ current: EXP, rootMenu: true }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

/** sidebar · Context. contexts 목록과 saved views만 보인다. */
export function ContextSidebar() {
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ mode: "context", savedActive: "running" }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

/** 문서 탭 · 편집. 디스크에 저장되는 중이다. 판 번호도 형식 문제 표시도 없다. */
export function MarkdownEditing() {
  return solo(documentTab(EXP, { editing: true, status: "saving" }));
}

/** text 파일 편집기. 확장자가 json·yaml이면 줄 번호가 있는 편집기로 열고 고친다. */
export function TextFiles() {
  const rubric = documentTab(RUBRIC);
  const scenario = documentTab(SCENARIO, { status: "saving" });
  return (
    <ProjectApp
      sidebar={{ current: RUBRIC }}
      panes={[
        { tabs: [rubric], selected: rubric.key },
        { tabs: [scenario], selected: scenario.key },
      ]}
    />
  );
}

/** 이미지와 pdf는 보기만 한다. 편집 단추와 저장 상태 대신 View only가 보인다. */
export function MediaFiles() {
  const image = documentTab(IMAGE);
  const pdf = documentTab(PDF);
  return (
    <ProjectApp
      sidebar={{ current: IMAGE }}
      panes={[
        { tabs: [image], selected: image.key },
        { tabs: [pdf], selected: pdf.key },
      ]}
    />
  );
}

/** project 밖 파일. 탭 key가 경로라서 어느 경로든 열고 view bar에 절대 경로와 Outside project가 보인다. */
export function OutsideFile() {
  const tab = documentTab(OUTSIDE);
  return solo(tab, {
    sidebar: { foldersClosed: true },
    info: { tab: tab.key, panel: "info" },
  });
}

function PathPalette({ typed }: { typed: string }) {
  return (
    <div className={fileStyles.paletteBackdrop}>
      <div className={fileStyles.palettePanel} role="dialog" aria-label="Open">
        <div className={fileStyles.paletteSearch}>{typed}</div>
        <div className={fileStyles.paletteList}>
          <div className={fileStyles.paletteGroup}>Open</div>
          <div
            className={`${fileStyles.paletteItem} ${fileStyles.paletteActive}`}
          >
            <span>{typed}</span>
            <span className={fileStyles.paletteDetail}>Outside project</span>
          </div>
        </div>
        <div className={fileStyles.paletteFooter}>
          Enter opens this path in a tab. Open file… chooses it with the system
          dialog.
        </div>
      </div>
    </div>
  );
}

/** 경로 입력으로 열기. 팔레트에 경로를 치면 그 파일을 여는 행이 나오고 project 밖이면 그렇게 적힌다. */
export function OpenPathPalette() {
  const tab = documentTab(EXP);
  return solo(tab, {
    sidebar: { current: EXP },
    children: <PathPalette typed={OUTSIDE} />,
  });
}

/** 고치지 않은 파일이 밖에서 바뀜. 새 내용을 다시 읽어 보이고 짧은 안내만 둔다. */
export function FileReloaded() {
  return solo(documentTab(EXP, { reloaded: true }));
}

/** 고치는 중에 디스크가 바뀜. 충돌을 알리고 어느 쪽을 남길지 고른다. */
export function FileConflict() {
  return solo(documentTab(EXP, { editing: true, status: "conflict" }));
}

/** 충돌 · 디스크 쪽과 비교. 두 쪽을 나란히 보고 어느 쪽을 남길지 고른다. */
export function FileConflictCompare() {
  return solo(
    documentTab(EXP, { editing: true, status: "conflict", compare: true }),
  );
}

/** 문서 탭의 정보 패널 · Contexts. 내용은 그대로이고 탭은 Info와 Contexts 둘이다. */
export function DocumentInfoContexts() {
  const tab = documentTab(EXP);
  return solo(tab, { info: { tab: tab.key, panel: "contexts" } });
}

/** project의 LOPHN.md는 일반 파일이라 따로 둔 진입 없이 일반 문서 탭으로 열린다. */
export function InstructionsFile() {
  return solo(documentTab("LOPHN.md"), {
    sidebar: { current: "LOPHN.md" },
  });
}

function findTab(
  find: NonNullable<TabSpec["find"]>,
): TabSpec {
  return { ...FILES_TAB, find };
}

/** project 키워드 검색 탭. 검색어와 폴더 하나로 좁히기, 경로 순·줄 순 결과, 일치한 부분이 든 snippet. */
export function FileSearchResults() {
  const search = findTab({ query: "world_actions" });
  return solo(search, { sidebar: { foldersClosed: true } });
}

/** 폴더 하나로 좁힌 검색. */
export function FileSearchFolder() {
  const search = findTab({ query: "world_actions", folder: "eval" });
  return solo(search, { sidebar: { foldersClosed: true } });
}

/** 결과를 누르면 그 줄에서 파일이 열린다. 오른쪽 문서가 일치한 줄로 scroll해 칠해져 있고 검색 탭은 그대로 남는다. */
export function FileSearchOpened() {
  const search = findTab({
    query: "world_actions",
    opened: `${EXP}:16`,
  });
  const doc = documentTab(EXP, { line: 16 });
  return (
    <ProjectApp
      sidebar={{ foldersClosed: true }}
      panes={[
        { tabs: [search], selected: search.key },
        { tabs: [doc], selected: doc.key },
      ]}
    />
  );
}

// tree의 exp-012 행 아래에 붙는 것. 행 높이 단위로 위치를 정한다.
const BELOW_ROW = "calc(var(--tree-row) * 6)";

function organize(overlay?: ReactNode, children?: ReactNode) {
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ current: EXP, menuFor: EXP_OTHER, menu: overlay }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    >
      {children}
    </ProjectApp>
  );
}

/** 파일 tree의 평범한 파일 동작. 행을 오른쪽 클릭하면 Open·Rename·Delete가 나온다(보관·이동·폴더 연결 해제는 없다). */
export function FileActionsMenu() {
  return organize(
    <div
      className={styles.contextMenu}
      style={{ top: BELOW_ROW, left: "var(--space-11)" }}
    >
      <StaticMenu
        width={160}
        highlighted="Delete"
        items={[
          {
            label: "Open",
            icon: menuLead(<FileIcon name="exp-012.md" size={16} />),
          },
          { label: "Rename", icon: menuIcon(editorIcons.edit) },
          { label: "Delete", icon: menuIcon(workspaceIcons.trash) },
        ]}
      />
    </div>,
  );
}

/** Delete를 누르면 화면 가운데 modal이 한 번 묻는다. 파일은 디스크에서 지워진다. */
export function FileDeleteConfirm() {
  return organize(
    undefined,
    <Dialog
      open
      onOpenChange={() => {}}
      title="Delete exp-012-ftb-quests-021-q8.md?"
      actions={
        <>
          <Button>Cancel</Button>
          <Button variant="primary">Delete</Button>
        </>
      }
    >
      This removes the file from disk.
    </Dialog>,
  );
}
