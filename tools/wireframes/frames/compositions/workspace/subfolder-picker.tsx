// 하위 폴더 고르기 dialog. 화면은 renderer의 SubfolderPicker가 그리고 여기서는 fake source에 이어 준다. 폴더 고르기는
// 그 등록 폴더 안으로만 열려서 등록 폴더가 트리의 맨 위다. src를 펼쳐 tools를 고르고 설명을 쓴 상태로 고정한다.
import { useMemo, useRef } from "react";

import { SubfolderPicker as Dialog } from "../../../../../packages/shell/renderer/desktop/lophn-space/projects/subfolder-picker.tsx";
import { fakeProjects } from "../../../../../packages/shell/renderer/desktop/lophn-space/projects/testdata/fake-projects.ts";
import { click, fill, first, useWorkspaceDrive } from "./drive.ts";

const ADDED = ["docs", "eval", "src/harness"];

export function SubfolderPicker() {
  const source = useMemo(() => fakeProjects().source, []);
  const root = useRef<HTMLDivElement>(null);
  useWorkspaceDrive(root, [
    click(first('[data-expand="src"]')),
    click(first('[data-pick="src/tools"]')),
    fill(
      first("[data-subfolder-new-description]"),
      "Small command-line helpers",
    ),
  ], true);
  return (
    <div ref={root} style={{ display: "contents" }}>
      <Dialog
        open
        root="/home/mina/work/phroner"
        added={ADDED}
        source={source}
        onClose={() => {}}
        onAdd={() => {}}
      />
    </div>
  );
}
