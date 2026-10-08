import type { InstructionsPlace } from "../../ipc/instructions.ts";
import type { LophnScreen } from "./lophn-space/model.ts";

// 창 안의 자리. 새 기본 창은 언제나 런처에서 시작한다(desktop#R24).
export type Space = "launcher" | "lophn" | "project" | "app" | "instructions";

export interface Route {
  readonly space: Space;
  /** project 공간의 프로젝트 id. 다른 공간은 없다. */
  readonly project?: string;
  /** app 공간의 앱 id. 다른 공간은 없다. */
  readonly app?: string;
  /** lophn 공간의 형제. 없으면 documents다(desktop#R1). */
  readonly screen?: LophnScreen;
  /** instructions 공간이 여는 지침 층. settings·project-workspace·app-detail의 [Instructions]가 쓴다. */
  readonly instructions?: InstructionsPlace;
  /** documents 화면에서 바로 읽을 문서. 전역 팔레트의 문서 행이 쓴다. */
  readonly read?: { readonly document: string; readonly version: string };
  /** things-to-confirm에서 처음 고를 요청. `lophn://things-to-confirm/<id>` 링크가 쓴다. */
  readonly request?: string;
  /** contexts에서 처음 열 Focus. 팔레트·정보 패널의 컨텍스트 탭이 쓴다. */
  readonly focus?: string;
  /** roles에서 처음 열 역할(작업대의 붙은 Operator). */
  readonly role?: string;
  /** roles에서 Operator를 붙이는 화면으로 연다(작업대의 [Attach an Operator]). */
  readonly attach?: { readonly kind: "project" | "app"; readonly id: string };
  /** settings에서 먼저 보일 coding agent 연결. `lophn://things-to-confirm/<cac id>` 링크가 쓴다. */
  readonly connection?: string;
  /** app 공간에서 Tasks 탭으로 열 대상. 취소·생성 링크가 쓴다. */
  readonly taskTarget?: {
    readonly ticket: string | null;
    readonly create: boolean;
  };
}

export const LAUNCHER: Route = { space: "launcher" };

/** 창 제목. 런처는 공간이 아니라서 이름 없이 제품 이름만 쓴다. */
export function routeTitle(route: Route): string {
  if (route.space === "launcher") return "lophn";
  if (route.space === "project") return "project — lophn";
  if (route.space === "app") return "app — lophn";
  return "lophn — lophn";
}

export function openLophn(
  screen?: LophnScreen,
  read?: Route["read"],
): Route {
  if (screen === undefined) return { space: "lophn" };
  return read === undefined
    ? { space: "lophn", screen }
    : { space: "lophn", screen, read };
}

/** 프로젝트 작업대로 이동한다. */
export function openProject(project: string): Route {
  return { space: "project", project };
}

/** [Instructions] 편집기로 이동한다. */
export function openInstructions(place: InstructionsPlace): Route {
  return { space: "instructions", instructions: place };
}

/** 앱 공간으로 이동한다. */
export function openApp(app: string): Route {
  return { space: "app", app };
}
