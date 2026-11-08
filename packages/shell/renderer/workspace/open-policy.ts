// 탭 안에서 연 것(터미널·coding agent의 문서 경로와 URL, lophn agent의 파일 link와 실행 단추)이 열릴 자리.
// 여는 쪽은 자리를 스스로 정하지 않고 여기 묻는다. 이미 열린 탭을 보이는 일(다른 desk, floated, detached)은
// `openTab`이 한다. 여기는 새 탭의 자리만 정한다.
import { type Desk, whereInDesk } from "../shell/desk-model.ts";

/** show: 문서·browser 탭처럼 보는 것. run: 실행을 지켜보는 터미널(코드 블록의 실행 단추). */
export type OpenIntent = "show" | "run";

/**
 * agent가 연 탭의 자리 힌트(`lophn tab open --place`). null은 힌트가 없다는 뜻이다. `openAt`에 주지 않으면(undefined)
 * 사람이 연 탭의 규칙이다.
 */
export type PlaceHint = "beside" | "group" | "float" | null;

/**
 * tab: `after`가 있으면 그 탭 바로 뒤, 없으면 desk 끝. `beside`면 `after`(터미널)의 옆 칸에 열어 터미널이
 * 계속 보이게 한다(`openTab`의 beside). `grow`면 source의 group에 칸을 더한다(`openTab`의 grow).
 */
export type OpenAt =
  | { readonly kind: "float" }
  | {
      readonly kind: "tab";
      readonly after?: string;
      readonly beside?: boolean;
      readonly grow?: boolean;
    };

/**
 * 연 탭(source)이 있는 자리로 새 탭의 자리를 정한다.
 * - run은 floated다. 실행을 보고 닫는 잠깐의 터미널이라 tab 배치를 바꾸지 않는다.
 * - source가 이 desk의 tab 줄에 있는 터미널(shell, coding agent)이면 그 옆 칸이다. 터미널을 가리지 않으려고
 *   오른쪽 split으로 열고, 터미널이 이미 group에 있으면 다음 칸에 쌓는다(칸의 stack). 이미 열린 탭은 고르기만 한다.
 * - source가 다른 종류의 tab이거나 다른 desk에 있으면 source 바로 뒤다. `openTab`이 그 desk로 건너간다.
 * - source가 floated·detached이거나 없으면 끝이다. 패널과 창은 그대로 둔다.
 * - hint(agent가 연 탭)가 있으면 그 힌트가 먼저다: float은 floated, beside는 source의 옆 칸, group은 source의 group에
 *   칸을 더하고(group이 아니면 beside와 같다), null은 source 바로 뒤다. source가 tab 줄에 없으면 끝이다.
 */
export function openAt(
  desk: Desk,
  source: string | undefined,
  intent: OpenIntent,
  hint?: PlaceHint,
): OpenAt {
  if (intent === "run") return { kind: "float" };
  if (hint === "float") return { kind: "float" };
  if (source === undefined) return { kind: "tab" };
  const where = whereInDesk(desk, source);
  if (where === "float" || where === "detached") return { kind: "tab" };
  if (hint === "beside") return { kind: "tab", after: source, beside: true };
  if (hint === "group") {
    return { kind: "tab", after: source, beside: true, grow: true };
  }
  if (hint === null) return { kind: "tab", after: source };
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
