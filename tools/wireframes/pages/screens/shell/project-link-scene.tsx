// 다른 기계(Home server)의 git이 아닌 project 하나를 이 컴퓨터(Studio)의 git이 아닌 project와 잇는 dialog. 화면은 renderer의
// LinkProjectDialog 그대로이고 후보와 잇기는 fake projects source가 준다. 목록 줄에서 dialog를 여는 길은 `screen-lists`가 단다.
import { useMemo } from "react";

import { LinkProjectDialog } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/link-dialog.tsx";
import type { ProjectItem } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/source.ts";
import {
  fakeProjects,
  folderItem,
} from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { click, useDrive } from "../../../mock/drive.ts";

const noop = () => {};

const REMOTE = {
  machineName: "Home server",
  title: "Recipes",
  identity: "pri_01jx00000000000000000recip",
};

// 이 컴퓨터의 git이 아닌 project. 부르는 쪽이 git project와 이미 그 id인 project를 뺀 목록이다.
const CANDIDATES: readonly ProjectItem[] = [
  {
    id: "prj_01h455vb4pex5v6nkc6gd5fd21",
    title: "Recipes",
    purpose: "Family recipes and the weekly menu.",
    revision: "4",
    archived: false,
    identity: "pri_01jx00000000000000000here1",
    repo: "none",
    folders: [folderItem("/home/mina/Documents/recipes", "")],
  },
  {
    id: "prj_01h455vb4pex5v6nkc6gd5fd22",
    title: "Kitchen notes",
    purpose: "",
    revision: "2",
    archived: false,
    identity: "pri_01jx00000000000000000here2",
    repo: "none",
    folders: [folderItem("/home/mina/notes/kitchen", "")],
  },
];

const NONE: readonly ProjectItem[] = [];

export function ProjectLinkScene({ empty = false }: { empty?: boolean }) {
  const candidates = empty ? NONE : CANDIDATES;
  const source = useMemo(
    () => fakeProjects({ projects: candidates }).source,
    [candidates],
  );
  useDrive(async () => {
    if (!empty) await click("[data-link-candidates] li button");
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--color-surface-base)",
      }}
    >
      <LinkProjectDialog
        remote={REMOTE}
        candidates={candidates}
        onLink={(project) => source.linkIdentity(project, REMOTE.identity)}
        onClose={noop}
      />
    </div>
  );
}
