// release 준비가 blueprint의 `sdk_dependencies`와 `permissions`를 맞춰 보는 검사다.
// core는 SDK 코드를 import하지 않아서 각 capability package의 `REQUIRED_PERMISSIONS`를 같은 값으로
// 옮겨 쓴다. SDK의 `checkDeclaration`과 같은 결과여야 한다. 검사도 import도 grant를 주지 않는다.
import type { Blueprint } from "../blueprint/mod.ts";

// 각 group에서 하나 이상을 선언해야 한다.
export const SDK_REQUIRED_PERMISSIONS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  "@lophn/cap-fs": [["fs.read", "fs.write"]],
  "@lophn/cap-net": [["net.fetch"]],
  // secret은 목적지 host·port의 net.fetch grant 안에서만 쓴다.
  "@lophn/cap-secret": [["secret.use"], ["net.fetch"]],
};

export type SdkPermissionFailure = {
  package: string;
  permissions: readonly string[];
  message: string;
};

// 요구 permission이 없는 첫 의존을 낸다. 모두 갖췄으면 undefined다.
export function missingSdkPermission(
  blueprint: Pick<Blueprint, "sdk_dependencies" | "permissions">,
): SdkPermissionFailure | undefined {
  const declared = new Set(
    blueprint.permissions.map((permission) => permission.kind),
  );
  for (const dependency of blueprint.sdk_dependencies) {
    const groups = SDK_REQUIRED_PERMISSIONS[dependency.name];
    if (groups === undefined) continue;
    for (const group of groups) {
      if (group.some((kind) => declared.has(kind as never))) continue;
      return {
        package: dependency.name,
        permissions: group,
        message: `${dependency.name} needs ${
          group.join(" or ")
        } in the blueprint permissions`,
      };
    }
  }
  return undefined;
}
