// 상단 바가 비울 OS 창 조작 자리. preload를 늘리지 않고 renderer의 user agent로 고른다.
export type WindowPlatform = "mac" | "windows" | "linux";

export function windowPlatform(userAgent: string): WindowPlatform {
  if (/Mac OS X|Macintosh/.test(userAgent)) return "mac";
  if (/Windows/.test(userAgent)) return "windows";
  return "linux";
}

export function currentPlatform(): WindowPlatform {
  return windowPlatform(globalThis.navigator?.userAgent ?? "");
}
