// domain-model apps/sdk의 값과 판정. IO는 없다.
import { packageVersionNameSchema } from "../../../protocol/apps/mod.ts";

// 첫 공개 묶음에서 제공하지 않는 이름. cap-read-model은 앱 사이
// command 호출이 cap-app-api와 apps/connections를 따르므로 만들지 않았고,
// cap-notify는 platform notification이 맡는다.
export const SDK_WITHHELD_NAMES = [
  "@lophn/cap-read-model",
  "@lophn/cap-notify",
] as const;

// 제공하지 않는 이름을 목록·안내가 제공한다고 쓰면 실패다.
export function isWithheldPackageName(name: string): boolean {
  return (SDK_WITHHELD_NAMES as readonly string[]).includes(name);
}

// @me 이름이 있으면 @lophn보다 먼저 보여 준다.
export function byCatalogOrder(
  a: { name: string },
  b: { name: string },
): number {
  const aMe = a.name.startsWith("@me/");
  const bMe = b.name.startsWith("@me/");
  if (aMe !== bMe) return aMe ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
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
