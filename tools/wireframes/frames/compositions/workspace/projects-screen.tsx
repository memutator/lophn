// Lophn Workspace › Projects. 화면은 renderer의 ProjectsScreen이 그리고 여기서는 fake source에 이어 준다.
// 사라진 폴더는 fake의 설정이고, 고친 하위 폴더는 mount 뒤에 사람이 하듯이 눌러 만든다.
import { useMemo, useRef } from "react";

import { ProjectsScreen as Screen } from "../../../../../packages/shell/renderer/desktop/lophn-space/projects/projects-screen.tsx";
import { fakeProjects } from "../../../../../packages/shell/renderer/desktop/lophn-space/projects/testdata/fake-projects.ts";
import {
  type Action,
  click,
  fill,
  first,
  last,
  useWorkspaceDrive,
  withText,
} from "./drive.ts";

export interface ProjectsScreenProps {
  /** 처음에 고른 project. 기본은 첫 project. */
  readonly selected?: string;
  /** 이 경로의 등록 폴더가 사라진 상태로 그린다. */
  readonly missingFolder?: string;
  /** 하위 폴더 고치기: 첫 하위 폴더의 설명을 고쳤고 마지막 하위 폴더를 뺀 상태. */
  readonly editSubfolders?: boolean;
}

export function ProjectsScreen(
  { selected, missingFolder, editSubfolders = false }: ProjectsScreenProps = {},
) {
  const source = useMemo(
    () => fakeProjects({ missingFolder }).source,
    [missingFolder],
  );
  const root = useRef<HTMLDivElement>(null);
  const actions: Action[] = [];
  if (selected !== undefined && selected !== "phroner") {
    actions.push(click(withText("button[data-project]", selected)));
  }
  if (editSubfolders) {
    actions.push(
      fill(
        first("[data-subfolder-description]"),
        "Experiment runs, results and score tables",
      ),
      click(last("[data-remove-subfolder]")),
    );
  }
  useWorkspaceDrive(root, actions);
  return (
    <div ref={root} style={{ display: "contents" }}>
      <Screen source={source} />
    </div>
  );
}
