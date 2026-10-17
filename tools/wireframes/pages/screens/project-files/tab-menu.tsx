// 탭 오른쪽 클릭 menu. 실제 작업대(Workspace)에서 sidebar 파일을 한 번 눌러 preview 탭을 만들고 그 탭을 우클릭한다.
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { find, useDrive, wait } from "../../../mock/drive.ts";
import {
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../../mock/mock-desktop.tsx";

const NOTES = {
  key: "doc_notes",
  kind: "document_editor",
  title: "notes",
} as const;
const PLAN = {
  key: "doc_plan",
  kind: "document_editor",
  title: "plan",
} as const;
const PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
];

export function EditorTabMenu() {
  useDrive(async () => {
    // 폴더를 펼쳐 파일 하나를 고정 탭으로 열고(double-click), 맨 아래 파일을 한 번 눌러 preview 탭으로 연다.
    const folder = await find('[role="treeitem"][aria-expanded="false"]');
    folder.click();
    await wait(150);
    const files = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="treeitem"]:not([aria-expanded])',
      ),
    ];
    files[0]!.click();
    files[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await wait(100);
    files.at(-1)!.click();
    await wait(150);
    const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
    const preview = tabs.item(tabs.length - 1);
    const box = preview.getBoundingClientRect();
    preview.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 24,
        clientY: box.bottom - 4,
      }),
    );
  });
  return <MockDesktop route={openProject(PROJECT_GROCERY)} panes={PANES} />;
}
