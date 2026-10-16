// 런처. 화면은 renderer의 Launcher가 그리고 여기서는 fake source와 fake Gateway에 이어 준다. project 카드는 이름,
// 목적, 폴더 수나 "Folder not found"이고, 등록 dialog는 이름, 목적, 폴더와 폴더 설명이다.
// Workspace로 들어가는 단추의 이름은 "Lophn Workspace"다.
import { useMemo, useRef, useState } from "react";

import { Launcher } from "../../../../../packages/shell/renderer/desktop/launcher/launcher.tsx";
import { fakeLauncher } from "../../../../../packages/shell/renderer/desktop/launcher/testdata/fake-launcher.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { mockCore } from "../../../../../packages/shell/renderer/desktop/dev-mock/requests.ts";
import { galleryApps } from "../../../../../packages/shell/renderer/desktop/lophn-space/apps/testdata/fake-apps.ts";
import { MISSING_FOLDER } from "../../../../../packages/shell/renderer/desktop/lophn-space/projects/testdata/fake-projects.ts";
import { click, first, useWorkspaceDrive } from "./drive.ts";
import { registerSteps } from "./register-panel.tsx";

const noop = () => {};

function Page(
  { empty = false, steps = [] }: {
    empty?: boolean;
    steps?: Parameters<typeof useWorkspaceDrive>[1];
  },
) {
  const core = useMemo(() => mockCore(), []);
  const [client] = useState(() => createEventClient(createFakeWaiting([])));
  const projects = useMemo(
    () =>
      fakeLauncher(
        empty ? { projects: [] } : {
          missingFolder: MISSING_FOLDER,
          picked: "/home/mina/trips/autumn",
        },
      ).source,
    [empty],
  );
  const apps = useMemo(() => galleryApps().source, []);
  const root = useRef<HTMLDivElement>(null);
  useWorkspaceDrive(root, steps, true);
  return (
    <div ref={root} style={{ display: "contents" }}>
      <EventsProvider client={client}>
        <Launcher
          source={core}
          platform="linux"
          projects={projects}
          apps={empty ? undefined : apps}
          onLophn={noop}
        />
      </EventsProvider>
    </div>
  );
}

/** 카드가 있는 런처. phroner의 폴더 하나가 사라졌다. */
export const LauncherProjects = () => <Page />;

/** 프로젝트도 앱도 없는 런처. 다음 행동은 Lophn Workspace 하나다. */
export const LauncherEmpty = () => <Page empty />;

/** 등록 dialog를 연 런처. */
export const LauncherRegister = () => (
  <Page
    steps={[click(first("[data-register-project]")), ...registerSteps()]}
  />
);
