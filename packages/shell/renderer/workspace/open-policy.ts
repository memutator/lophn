// 탭 안에서 연 것(터미널·coding agent의 문서 경로와 URL, lophn agent의 파일 link와 실행 단추)이 열릴 자리.
// 여는 쪽은 자리를 스스로 정하지 않고 여기 묻는다. 이미 열린 탭을 보이는 일(다른 desk, floated, detached)은
// `openTab`이 한다. 여기는 새 탭의 자리만 정한다.
import { type Desk, whereInDesk } from "../shell/desk-model.ts";

/** show: 문서·browser 탭처럼 보는 것. run: 실행을 지켜보는 터미널(코드 블록의 실행 단추). */
export type OpenIntent = "show" | "run";

/** tab: `after`가 있으면 그 탭 바로 뒤, 없으면 desk 끝. */
export type OpenAt =
  | { readonly kind: "float" }
  | { readonly kind: "tab"; readonly after?: string };

/**
 * 연 탭(source)이 있는 자리로 새 탭의 자리를 정한다.
 * - run은 floated다. 실행을 보고 닫는 잠깐의 터미널이라 tab 배치를 바꾸지 않는다.
 * - source가 tab이거나 다른 desk에 있으면 source 바로 뒤다. `openTab`이 그 desk로 건너간다.
 * - source가 floated·detached이거나 없으면 끝이다. 패널과 창은 그대로 둔다.
 */
export function openAt(
  desk: Desk,
  source: string | undefined,
  intent: OpenIntent,
): OpenAt {
  if (intent === "run") return { kind: "float" };
  if (source === undefined) return { kind: "tab" };
  const where = whereInDesk(desk, source);
  return where === "float" || where === "detached"
    ? { kind: "tab" }
    : { kind: "tab", after: source };
}

/** show 자리의 `openTab` option. */
export function showAfter(
  desk: Desk,
  source: string | undefined,
): { readonly after?: string } {
  const at = openAt(desk, source, "show");
  return at.kind === "tab" && at.after !== undefined ? { after: at.after } : {};
}
