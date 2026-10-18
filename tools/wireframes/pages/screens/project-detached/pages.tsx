// detached 창: 탭 하나(terminal)가 OS 창을 채우고 위 bar에 제목과 [Dock]이 있다.
import { MockDesktop } from "../../../mock/mock-desktop.tsx";

const TERM_1 = { key: "term_1", kind: "terminal", title: "grocery" } as const;

export function DetachedTerminal() {
  return <MockDesktop detachedTab={TERM_1} openTerminal="term_1" />;
}
