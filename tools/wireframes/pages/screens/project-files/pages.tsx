// Part 2: 파일 탭(viewer, 저장, 밖에서 바뀐 파일), project 키워드 검색, 경로로 열기, sidebar의 Agents 묶음.
// 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import { Palette } from "@lophn/ui/overlay";

import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { type, useDrive } from "../../../mock/drive.ts";
import { documentTab } from "../../../mock/phroner-data.ts";
import { ProjectApp, type ProjectAppProps } from "../project-app.tsx";
import type { ExplorerAct } from "../project-window.tsx";
import type { TabSpec } from "../project-window.tsx";

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
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ mode: "agent", hoverAgent: "eval-analyst" }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

/** sidebar · Agent의 Background 묶음. run 줄 아래에 그 run이 연 session이 들여 쓰여 있다. `--session`으로 이어 쓴 run은 아래가 비어 있다. job이 연 run 둘은 이름 자리에 job 제목이 오고 둘째 줄에 agent 이름이 온다. */
export function AgentsRuns() {
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{ mode: "agent", runs: true, scrollToAgents: true }}
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

// 실제 Palette는 입력칸 값을 밖에서 못 정해서, 뜬 뒤에 사람이 친 것처럼 경로를 넣는다.
// modal이라 page가 잠기지만 이 page는 이 palette를 보이는 screen이다.
function PathPalette({ typed }: { typed: string }) {
  useDrive(() => type('[role="dialog"] input', typed), [typed]);
  return (
    <Palette
      open
      onOpenChange={() => {}}
      title="Open"
      items={[
        {
          id: `path:${typed}`,
          group: "Open",
          label: typed,
          detail: "Outside project",
          icon: workspaceIcons.document,
        },
      ]}
      onSelect={() => {}}
    />
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

/** project의 LOPHN.md는 일반 파일이라 따로 둔 진입 없이 일반 문서 탭으로 열린다. */
export function InstructionsFile() {
  return solo(documentTab("LOPHN.md"), {
    sidebar: { current: "LOPHN.md" },
  });
}

function findTab(find: NonNullable<TabSpec["find"]>): TabSpec {
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

function explorer(act?: ExplorerAct, menuFor?: string) {
  const tab = documentTab(EXP);
  return (
    <ProjectApp
      sidebar={{
        current: EXP,
        ...(act === undefined ? {} : { act }),
        ...(menuFor === undefined ? {} : { menuFor }),
      }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

/** 파일 tree의 오른쪽 클릭 menu. 위에서부터 New File, New Folder, Reveal in File Manager, Copy Path, Copy Relative Path, Rename, Delete이고 묶음 사이에 구분선이 있다. */
export function FileActionsMenu() {
  return explorer(undefined, EXP_OTHER);
}

/** Explorer 머리에 마우스를 올리거나 focus하면 New File, New Folder, Refresh, Collapse All 단추가 나타난다. */
export function ExplorerHead() {
  return explorer("head");
}

/** New File을 누르면 고른 폴더 안에 이름 입력 줄이 생긴다. Enter로 만들고 Esc나 focus를 잃으면 취소한다. */
export function ExplorerNewFile() {
  return explorer("new-file");
}

/** 이미 있는 이름을 쓰면 입력 아래에 오류가 보인다. */
export function ExplorerNewExists() {
  return explorer("new-exists");
}

/** F2나 menu의 Rename은 이름을 tree 안 입력으로 바꾼다. 파일은 확장자 앞까지만 골라진다. */
export function ExplorerRename() {
  return explorer("rename");
}

/** 파일을 다른 폴더로 끌어 놓으면 옮기기 전에 한 번 묻는다. */
export function ExplorerMove() {
  return explorer("move");
}

/** Delete를 누르면 화면 가운데 modal이 한 번 묻는다. 파일은 OS 휴지통으로 가서 되살릴 수 있다. */
export function FileDeleteConfirm() {
  return explorer("delete");
}
