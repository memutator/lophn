// domain 화면 gallery. project 창은 진짜 Desktop(MockDesktop)의 sidebar Domains 탭이고, 앱 공간은 진짜 AppSpace의 App details다.
// 상태는 fake source의 바탕과 mount 뒤 사람이 하는 것 같은 단추 누르기(drive)로 만든다. 화면에 gallery 전용 prop은 없다.
import { useMemo } from "react";

import { ProjectSidebar } from "../../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.tsx";
import { fakeWorkspaceSource } from "../../../../../packages/shell/renderer/workspace/fake-source.ts";
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { MockDesktop, PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";
import { click, find, press, useDrive, wait } from "../../../mock/drive.ts";
import { AppSpace } from "../app-space/space.tsx";

const noop = () => {};

// sidebar의 네 번째 탭(Domains)을 연다. 탭은 아이콘뿐이라 자리로 찾는다.
const openDomainsTab = () => click('[data-sidebar] [role="tab"]', undefined, 3);

const openRowMenu = (title: string) =>
  press("button", new RegExp(`^Actions for ${title}$`));

export function ProjectDomains() {
  useDrive(async () => {
    await openDomainsTab();
    await openRowMenu("Finances");
  });
  return <MockDesktop route={openProject(PROJECT_GROCERY)} />;
}

/** domain이 0개인 project의 sidebar. */
export function ProjectDomainsEmpty() {
  const source = useMemo(() => fakeWorkspaceSource({ domains: [] }), []);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        background: "var(--color-surface-base)",
      }}
    >
      <ProjectSidebar
        mode="open"
        width={240}
        project={{ id: "prj_empty", title: "phroner", folders: [] }}
        source={source}
        agents={[]}
        sessions={[]}
        initialTab="domain"
        onOpenFile={noop}
        onMove={(from, to) => source.rename(from, to)}
        onTrash={(path) => source.trash(path)}
        onRail={noop}
        onAgent={noop}
        onSession={noop}
        onManage={noop}
        onToggle={noop}
        onLauncher={noop}
      />
    </div>
  );
}

// dialog 안 입력칸 하나를 React가 보는 input event로 채운다.
async function fill(at: number, text: string) {
  const element = await find<HTMLInputElement>(
    '[role="dialog"] input',
    undefined,
    at,
  );
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    .call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(30);
}

export function NewDomainDialogPage() {
  useDrive(async () => {
    await openDomainsTab();
    await click("button", "New domain");
    await fill(0, "docs");
    await fill(1, "Docs");
    await fill(2, "Notes and design write-ups for the project.");
  });
  return <MockDesktop route={openProject(PROJECT_GROCERY)} />;
}

async function archiveFromMenu(title: string) {
  await openRowMenu(title);
  await click('[role="menuitem"]', "Archive");
  await wait(100);
}

/** 앱 상세의 Domains 절. last면 둘을 보관해 마지막 하나만 남기고 그 줄의 Archive에 hover한다. */
export function AppDomains({ last = false }: { last?: boolean }) {
  useDrive(async () => {
    if (last) {
      await archiveFromMenu("Shipping");
      await archiveFromMenu("Customers");
    }
    await openRowMenu("Orders");
    if (!last) return;
    const reason = await find('[role="menuitem"] span', /^Archive$/);
    reason.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
  });
  return <AppSpace panel="version" />;
}
