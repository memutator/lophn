// project id를 보이는 화면 아홉: 등록 dialog의 "Same project on my other computers" 줄 셋과 project 상세의 "Other computers" 줄 여섯.
// 화면은 renderer의 WorkspacesPanel이 여는 RegisterDialog와 ProjectDetailDialog 그대로이고 여기서는 fake source의 상태와 drive만 건다.
// dialog는 modal이라 한 문서에 하나만 열 수 있다. 그래서 `?state=`가 없으면 아홉 상태를 iframe으로 나란히 보이는 board이고,
// `?state=<상태>`는 그 상태 하나를 창 크기로 그린다.
import { useMemo, useState } from "react";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import type {
  FolderMatch,
  ProjectItem,
} from "../../../../../packages/shell/renderer/desktop/workspaces/projects/source.ts";
import {
  fakeProjects,
  type FakeProjectsOptions,
} from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { galleryApps } from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { WorkspacesPanel } from "../../../../../packages/shell/renderer/shell/workspaces-panel.tsx";
import { withSyncLists } from "../../../mock/core-answers/sync-lists.ts";
import {
  click,
  find,
  press,
  runSteps,
  type Step,
  type,
  useDrive,
} from "../../../mock/drive.ts";

const noop = () => {};

// 등록 dialog가 읽는 폴더 상태 셋.
const LOST_FOLDER_PROJECT: ProjectItem = {
  id: "prj_01h455vb4pex5v6nkc6gd5fd09",
  title: "Autumn trips",
  purpose: "Plan the autumn trip.",
  revision: "3",
  archived: false,
  identity: null,
  repo: "git",
  folders: [
    {
      path: "/media/old-drive/trips/planner",
      description: "",
      found: false,
    },
  ],
};
const GIT_FOLDER: FolderMatch = {
  repo: "git",
  file: "none",
  same: null,
  suggestions: [],
};

interface Scene {
  readonly title: string;
  readonly options: FakeProjectsOptions;
  readonly steps: readonly Step[];
}

const REGISTER: readonly Step[] = [
  () => click("[data-register-project]"),
  () => type('[data-field="name"]', "trip-planner"),
  () => click("[data-add-folder]"),
  // 폴더 줄 아래의 저장소 줄이 보이게 dialog를 끝까지 내린다.
  async () => {
    (await find("[data-identity]")).scrollIntoView({ block: "end" });
  },
];
const DETAILS: readonly Step[] = [
  () => press("[data-project] [data-card-menu]"),
  () => click('[data-menu-item="details"]'),
];

const SCENES = {
  "register-git": {
    title: "Register · Git folder",
    options: { match: GIT_FOLDER },
    steps: REGISTER,
  },
  "register-relink": {
    title: "Register · Relink suggestion",
    options: {
      match: { ...GIT_FOLDER, suggestions: [LOST_FOLDER_PROJECT] },
    },
    steps: REGISTER,
  },
  "register-not-git": {
    title: "Register · Not in git",
    options: { match: { ...GIT_FOLDER, repo: "none" } },
    steps: REGISTER,
  },
  "row-none": {
    title: "Detail · Not set up",
    options: { identity: { file: "none" } },
    steps: DETAILS,
  },
  "row-uncommitted": {
    title: "Detail · Not committed",
    options: { identity: { file: "uncommitted" } },
    steps: DETAILS,
  },
  "row-committed": {
    title: "Detail · Committed",
    options: { identity: { file: "committed" } },
    steps: DETAILS,
  },
  "row-conflict": {
    title: "Detail · Conflict",
    options: { identity: { file: "conflict" } },
    steps: DETAILS,
  },
  "row-missing": {
    title: "Detail · File missing",
    options: { identity: { file: "missing" } },
    steps: DETAILS,
  },
  "row-duplicate": {
    title: "Detail · Another copy",
    options: {
      identity: {
        file: "committed",
        duplicateOf: {
          id: "prj_01h455vb4pex5v6nkc6gd5fd02",
          title: "grocery-budget",
        },
      },
    },
    steps: DETAILS,
  },
} as const satisfies Record<string, Scene>;

type SceneId = keyof typeof SCENES;
const IDS = Object.keys(SCENES) as SceneId[];

function Stage({ scene }: { scene: Scene }) {
  const [right, setRight] = useState(true);
  const projects = useMemo(() => fakeProjects(scene.options).source, [scene]);
  const apps = useMemo(() => galleryApps().source, []);
  const client = useMemo(
    () => createEventClient(withSyncLists(createFakeSource(), projects, apps)),
    [projects, apps],
  );
  useDrive(() => runSteps(scene.steps));
  return (
    <ShellFrame
      left={false}
      onToggleLeft={noop}
      right={right}
      onToggleRight={() => setRight(!right)}
      tabs={null}
      panelTabs={
        <PanelTabs
          tabs={[
            { key: "workspaces", label: "Workspaces", icon: shellIcons.app },
          ]}
          selected="workspaces"
          onSelect={noop}
        />
      }
      leftSidebar={null}
      rightSidebar={
        <EventsProvider client={client}>
          <WorkspacesPanel
            projects={projects}
            apps={apps}
            onProject={noop}
            onApp={noop}
            onNewApp={noop}
          />
        </EventsProvider>
      }
    >
      <div
        style={{
          flex: 1,
          borderRadius: "var(--radius-lg)",
          background: "var(--color-surface-base)",
        }}
      />
    </ShellFrame>
  );
}

const CELL = { width: 1280, height: 800, scale: 0.5 };

// 아홉 상태를 iframe으로 나란히 보이는 board. 각 iframe은 같은 page의 `?state=`다.
function Board() {
  const theme = new URLSearchParams(location.search).get("theme");
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        padding: "var(--space-6)",
        background: "var(--color-surface-base)",
        display: "grid",
        gridTemplateColumns: `repeat(2, ${CELL.width * CELL.scale}px)`,
        gap: "var(--space-6)",
        justifyContent: "center",
        alignContent: "start",
      }}
    >
      {IDS.map((id) => (
        <figure key={id} style={{ margin: 0 }}>
          <figcaption
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "var(--type-small-size)",
              paddingBottom: "var(--space-3)",
            }}
          >
            {SCENES[id].title}
          </figcaption>
          <div
            style={{
              width: CELL.width * CELL.scale,
              height: CELL.height * CELL.scale,
              overflow: "hidden",
              border: "var(--border-width) solid var(--color-border-subtle)",
            }}
          >
            <iframe
              aria-label={SCENES[id].title}
              src={`?frame=shell-project-identity&state=${id}${
                theme === null ? "" : `&theme=${theme}`
              }`}
              style={{
                width: CELL.width,
                height: CELL.height,
                border: 0,
                transform: `scale(${CELL.scale})`,
                transformOrigin: "0 0",
              }}
            />
          </div>
        </figure>
      ))}
    </div>
  );
}

export function ProjectIdentityScene() {
  const state = new URLSearchParams(location.search).get("state");
  const scene = IDS.find((id) => id === state);
  return scene === undefined ? <Board /> : <Stage scene={SCENES[scene]} />;
}

/** board가 아홉 상태를 5줄로 그리는 높이. */
export const PROJECT_IDENTITY_BOARD_HEIGHT =
  5 * (CELL.height * CELL.scale + 56);
