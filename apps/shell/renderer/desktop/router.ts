// 창 안의 자리. 새 기본 창은 언제나 런처에서 시작한다(desktop#R24).
export type Space = "launcher" | "lophn";

export interface Route {
  readonly space: Space;
}

export const LAUNCHER: Route = { space: "launcher" };

/** 창 제목. 런처는 공간이 아니라서 이름 없이 제품 이름만 쓴다. */
export function routeTitle(route: Route): string {
  return route.space === "launcher" ? "lophn" : "lophn — lophn";
}

export function openLophn(): Route {
  return { space: "lophn" };
}
