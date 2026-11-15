// 앱 view preload bridge `lophnApp`의 place 부분의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).

export type Place = "tab" | "panel" | "card" | "sidebar" | "tray" | "phone";

export type PlaceJson =
  | null
  | boolean
  | number
  | string
  | PlaceJson[]
  | { [key: string]: PlaceJson };

/** 화면이 열린 workspace. project의 folders는 등록한 폴더 path 목록이다. */
export interface PlaceWorkspace {
  kind: "project" | "home" | "app";
  id: string;
  folders: string[];
}

export interface PlaceValue {
  /** 화면이 열린 자리. 앱 view 밖이거나 lophn이 준 값이 틀리면 null이다. */
  place: Place | null;
  /** 화면 선언의 `params` schema를 통과한 인자. 없으면 `{}`다. */
  params: { [key: string]: PlaceJson };
  workspace: PlaceWorkspace | null;
}

const OUTSIDE: PlaceValue = { place: null, params: {}, workspace: null };

/**
 * 이 화면이 열린 자리·인자·workspace. 열릴 때 정해지고 화면이 열려 있는 동안 바뀌지 않는다.
 * 자리가 바뀌는 경우는 없다(dock·float는 모두 panel이다).
 */
export function usePlace(): PlaceValue {
  const app = (globalThis as { lophnApp?: { place?: PlaceValue } }).lophnApp;
  return app?.place ?? OUTSIDE;
}
