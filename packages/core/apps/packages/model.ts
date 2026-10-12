// domain-model apps/sdk의 값과 판정. IO는 없다.
import { packageVersionNameSchema } from "../../../protocol/apps/mod.ts";

// 첫 공개 묶음에서 제공하지 않는 이름. cap-read-model은 앱 사이
// command 호출이 cap-schedule과 apps/connections를 따르므로 만들지 않았고,
// cap-notify는 platform#T17 notification이 맡는다.
export const SDK_WITHHELD_NAMES = [
  "@lophn/cap-read-model",
  "@lophn/cap-notify",
] as const;

// 제공하지 않는 이름을 목록·안내가 제공한다고 쓰면 실패다.
export function isWithheldPackageName(name: string): boolean {
  return (SDK_WITHHELD_NAMES as readonly string[]).includes(name);
}

// @me 이름이 있으면 @lophn보다 먼저 보여 준다. 개인 등록은 여전히 forbidden이다.
export function byCatalogOrder(
  a: { name: string },
  b: { name: string },
): number {
  const aMe = a.name.startsWith("@me/");
  const bMe = b.name.startsWith("@me/");
  if (aMe !== bMe) return aMe ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// 현재 개인 Package 등록은 받지 않는다.
export function personalRegistrationRejected(name: string): boolean {
  return name.startsWith("@me/");
}

// SemVer를 세 수로 나눈다. 완전한 SemVer 2.0.0만 받는다(contracts가 이미 판정).
export function majorMinorPatch(
  version: string,
): { major: number; minor: number; patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|-|[+])/.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

// 같은 major.minor에서 patch와 minor 증가, major 증가를 나눈다.
export function compareVersionBump(
  from: string,
  to: string,
): "patch" | "minor" | "major" | undefined {
  const a = majorMinorPatch(from);
  const b = majorMinorPatch(to);
  if (!a || !b) return undefined;
  if (b.major > a.major) return "major";
  if (b.major < a.major || b.minor < a.minor) return undefined;
  if (b.minor > a.minor) return "minor";
  return "patch";
}

// 안내 원문은 patch·minor·major를 구별해야 하고 permission 증가는 major 절에만
// 쓴다. 요구 확인: 세 변경을 구별하고 permission 증가를 patch나 minor로 표시하지 않는다.
export type GuideSections = {
  patch: string;
  minor: string;
  major: string;
};

// 안내 원문에서 세 변경 절을 찾는다. 헤더(`##` 이하) 안에 patch·minor·major가
// 있어야 하고, 각 절은 다음 헤더 전까지다.
export function guideBumpSections(guide: string): GuideSections | undefined {
  const lines = guide.split("\n");
  const sections = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    if (/^#{1,6} /.test(line)) {
      current = undefined;
      for (const bump of ["patch", "minor", "major"] as const) {
        if (line.toLowerCase().includes(bump)) current = bump;
      }
      continue;
    }
    if (current !== undefined) {
      const bucket = sections.get(current) ?? [];
      bucket.push(line);
      sections.set(current, bucket);
    }
  }
  const text = (bump: "patch" | "minor" | "major") =>
    (sections.get(bump) ?? []).join("\n").trim();
  const result = {
    patch: text("patch"),
    minor: text("minor"),
    major: text("major"),
  };
  return result.patch.length > 0 && result.minor.length > 0 &&
      result.major.length > 0
    ? result
    : undefined;
}

// permission 증가가 patch·minor 절에 있으면 거절의 근거다.
export function permissionIncreaseIn(
  patch: string,
  minor: string,
): boolean {
  const permission = /(permission|권한)/i;
  const increase = /(증가|increase|upgrad|요구 permission)/i;
  for (const section of [patch, minor]) {
    if (permission.test(section) && increase.test(section)) return true;
  }
  return false;
}

// release 준비가 쓸 해석 함수. lophn-sdk:<name>@<version>의 정확한
// version만 받고 ^·~·latest와 암묵적 최신 선택은 거절이다.
export function parseLophnSdkSpecifier(
  specifier: string,
): { name: string; version: string } | undefined {
  const match = /^lophn-sdk:(@[^/]+\/[^@]+)@([^@]+)$/.exec(specifier);
  if (!match) return undefined;
  const name = match[1];
  const version = match[2];
  if (!packageVersionNameSchema.safeParse(version).success) return undefined;
  return { name, version };
}
