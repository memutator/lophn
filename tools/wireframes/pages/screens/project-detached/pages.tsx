// detached 창: 탭 하나(terminal)가 OS 창을 채우고 위 bar에 제목과 [Dock]이 있다. agent(Researcher)가 연 탭이라 제목 앞에 주인
// avatar와 이름이 선다.
import { OwnerProvider } from "../../../../../packages/shell/renderer/parts/agent-session/owner.tsx";
import { MockDesktop } from "../../../mock/mock-desktop.tsx";
import { mockOwners, RESEARCHER } from "../../../mock/tab-owners.ts";

const TERM_1 = {
  key: "term_1",
  kind: "terminal",
  title: "grocery",
  owner: RESEARCHER,
} as const;

export function DetachedTerminal() {
  return (
    <OwnerProvider lookup={mockOwners}>
      <MockDesktop detachedTab={TERM_1} openTerminal="term_1" />
    </OwnerProvider>
  );
}
