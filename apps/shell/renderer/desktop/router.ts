import type { LophnScreen } from "./lophn-space/model.ts";

// 창 안의 자리. 새 기본 창은 언제나 런처에서 시작한다(desktop#R24).
export type Space = "launcher" | "lophn" | "project";

export interface Route {
  readonly space: Space;
  /** project 공간의 프로젝트 id. 다른 공간은 없다. */
  readonly project?: string;
  /** lophn 공간의 형제. 없으면 documents다(desktop#R1). */
  readonly screen?: LophnScreen;
}

export const LAUNCHER: Route = { space: "launcher" };

/** 창 제목. 런처는 공간이 아니라서 이름 없이 제품 이름만 쓴다. */
export function routeTitle(route: Route): string {
  if (route.space === "launcher") return "lophn";
  if (route.space === "project") return "project — lophn";
  return "lophn — lophn";
}

export function openLophn(screen?: LophnScreen): Route {
  return screen === undefined ? { space: "lophn" } : { space: "lophn", screen };
}

/** 프로젝트 작업대로 이동한다. */
export function openProject(project: string): Route {
  return { space: "project", project };
}
