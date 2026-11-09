// 탭 안에서 연 것(터미널·coding agent의 문서 경로와 URL, lophn agent의 파일 link와 실행 단추)이 열릴 자리.
// 여는 쪽은 자리를 스스로 정하지 않고 여기 묻는다. 이미 열린 탭을 보이는 일(다른 desk, floated, detached)은
// `openTab`이 한다. 여기는 새 탭의 자리만 정한다.
import type { TabRelation } from "../../../protocol/lophn-agent/host-queue.ts";
import {
  type Desk,
  type OpenRelation,
  whereInDesk,
} from "../shell/desk-model.ts";

/** show: 문서·browser 탭처럼 보는 것. run: 실행을 지켜보는 터미널(코드 블록의 실행 단추). */
export type OpenIntent = "show" | "run";

/** agent가 연 탭. relation은 agent가 말한 뜻이고 null이면 말하지 않은 것이다. target은 무엇을 여는가이다. */
export interface AgentOpen {
  readonly relation: TabRelation | null;
  readonly target: "browser" | "session" | "tui" | "preview" | "artifact";
}

/**
 * tab: `after`가 있으면 그 탭 바로 뒤, 없으면 desk 끝. `beside`면 `after`(터미널)의 옆 칸에 열어 터미널이
 * 계속 보이게 한다(`openTab`의 beside). `relation`은 agent가 연 탭이 `after`에게 무엇인가이고 칸 규칙은 `openTab`이 푼다.
 * float의 minimized는 접힌 chip으로 연다.
 */
export type OpenAt =
  | { readonly kind: "float"; readonly minimized?: boolean }
  | {
      readonly kind: "tab";
      readonly after?: string;
      readonly beside?: boolean;
      readonly relation?: OpenRelation;
    };

/**
 * 연 탭(source)이 있는 자리로 새 탭의 자리를 정한다. agent는 자리가 아니라 뜻(relation)만 말하고 자리는 여기서만 정한다.
 * - run은 floated다. 실행을 보고 닫는 잠깐의 터미널이라 tab 배치를 바꾸지 않는다.
 * - agent가 연 탭(`agent`)은 relation이 먼저다. 말하지 않았으면 browser는 work, 나머지는 aside다.
 *   work는 접힌 float, glance는 펴진 float이다. peer·stage·aside는 source가 이 desk의 tab 줄에 있거나 다른 desk에 있으면
 *   `after: source`와 relation을 주고(칸 규칙은 `openTab`, 다른 desk면 그 desk에서 풀린다), source가 floated·detached이거나
 *   없으면 끝이다.
 * - 사람 쪽(agent 없음): source가 이 desk의 tab 줄에 있는 터미널(shell, coding agent)이면 그 옆 칸이다. 터미널을 가리지
 *   않으려고 오른쪽 split으로 열고, 터미널이 이미 group에 있으면 다음 칸에 쌓는다(칸의 stack). 다른 종류의 tab이거나 다른
 *   desk에 있으면 source 바로 뒤이고, floated·detached이거나 없으면 끝이다. 패널과 창은 그대로 둔다.
 * 이미 열린 탭을 보이는 일(다른 desk, floated, detached)은 `openTab`이 한다. 여기는 새 탭의 자리만 정한다.
 */
export function openAt(
  desk: Desk,
  source: string | undefined,
  intent: OpenIntent,
  agent?: AgentOpen,
): OpenAt {
  if (intent === "run") return { kind: "float" };
  const relation =
    agent === undefined
      ? undefined
      : (agent.relation ?? (agent.target === "browser" ? "work" : "aside"));
  if (relation === "work") return { kind: "float", minimized: true };
  if (relation === "glance") return { kind: "float" };
  if (source === undefined) return { kind: "tab" };
  const where = whereInDesk(desk, source);
  if (where === "float" || where === "detached") return { kind: "tab" };
  if (relation !== undefined) return { kind: "tab", after: source, relation };
  const terminal =
    where === "tab" &&
    desk.tabs.some((tab) => tab.key === source && tab.kind === "terminal");
  return terminal
    ? { kind: "tab", after: source, beside: true }
    : { kind: "tab", after: source };
}

/** show 자리의 `openTab` option. */
export function showAfter(
  desk: Desk,
  source: string | undefined,
): { readonly after?: string; readonly beside?: boolean } {
  const at = openAt(desk, source, "show");
  if (at.kind !== "tab" || at.after === undefined) return {};
  return at.beside === true
    ? { after: at.after, beside: true }
    : { after: at.after };
}
