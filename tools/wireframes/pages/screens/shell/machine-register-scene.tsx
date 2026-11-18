// 다른 기계(Home server) 창의 project 등록. 화면은 renderer의 RegisterDialog와 그 기계의 폴더 목록 dialog가 그린다. 폴더 더하기는
// OS 선택기 대신 그 기계의 폴더 목록을 연다. mount 뒤 이름을 넣고 [Add folder]로 목록을 열어 projects 폴더에 들어간 상태로 고정한다.
import { type CSSProperties, useState } from "react";

import { MachinesProvider } from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import { fakeMachines } from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { createFolderBrowser } from "../../../../../packages/shell/renderer/desktop/workspaces/folder-browser.tsx";
import { fakeProjects } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { RegisterDialog } from "../../../../../packages/shell/renderer/desktop/workspaces/register-dialog.tsx";
import { fakeBrowseFolders } from "../../../../../packages/shell/renderer/desktop/workspaces/testdata/fake-folders.ts";
import { click, runSteps, type, useDrive } from "../../../mock/drive.ts";

const STAGE: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "var(--color-surface-floor)",
};

const noop = () => {};

export function MachineRegisterScene() {
  const [wiring] = useState(() => {
    const folders = createFolderBrowser(fakeBrowseFolders());
    const projects = fakeProjects().source;
    return {
      folders,
      machines: fakeMachines({
        window: { id: "mch_homeserver", name: "Home server" },
      }).source,
      // entry가 다른 기계의 창에 짓는 것처럼 폴더 고르기만 그 기계의 목록으로 바꾼다.
      source: {
        ...projects,
        pickFolder: async () => {
          const picked = await folders.picker.pick();
          return picked.ok ? picked : { ok: false as const };
        },
      },
    };
  });
  useDrive(() =>
    runSteps([
      () => type('[data-field="name"]', "trip-planner"),
      () => click("[data-add-folder]"),
      () => click('[data-folder-entry="projects"]'),
    ]),
  );
  const { Host } = wiring.folders;
  return (
    <MachinesProvider source={wiring.machines}>
      <div style={STAGE} />
      <RegisterDialog
        open
        source={wiring.source}
        onClose={noop}
        onRegistered={noop}
      />
      <Host />
    </MachinesProvider>
  );
}
