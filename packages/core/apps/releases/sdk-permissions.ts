// release 준비가 선언의 `sdk_dependencies`와 `permissions`를 맞춰 보는 검사다.
// core는 SDK 코드를 import하지 않아서 각 capability package의 `REQUIRED_PERMISSIONS`를 같은 값으로
// 옮겨 쓴다. SDK의 `checkDeclaration`과 같은 결과여야 한다. 검사도 import도 grant를 주지 않는다.
import type { AppDeclaration } from "../declaration/mod.ts";

// 각 group에서 하나 이상을 선언해야 한다.
const SDK_REQUIRED_PERMISSIONS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  "@lophn/cap-fs": [["fs.read", "fs.write"]],
  "@lophn/cap-net": [["net.fetch"]],
  "@lophn/cap-notify": [["notify.send"]],
  // secret은 목적지 host·port의 net.fetch grant 안에서만 쓴다.
  "@lophn/cap-secret": [["secret.use"], ["net.fetch"]],
};

type SdkPermissionFailure = {
  package: string;
  permissions: readonly string[];
  message: string;
};

// `@lophn/cap-*` 의존들이 요구하는 permission 중 declared에 없는 첫 group을 낸다.
// release 선언과 `@me` package publish가 같은 규칙을 쓰므로 where로 문구만 가른다.
export function missingCapPermission(
  dependencyNames: Iterable<string>,
  declared: ReadonlySet<string>,
  where: string,
): SdkPermissionFailure | undefined {
  for (const name of dependencyNames) {
    const groups = SDK_REQUIRED_PERMISSIONS[name];
    if (groups === undefined) continue;
    for (const group of groups) {
      if (group.some((kind) => declared.has(kind))) continue;
      return {
        package: name,
        permissions: group,
        message: `${name} needs ${group.join(" or ")} in the ${where}`,
      };
    }
  }
  return undefined;
}

// 요구 permission이 없는 첫 의존을 낸다. 모두 갖췄으면 undefined다.
// `@me` package의 요구는 catalog에 있어서 호출하는 쪽이 `userPackagePermissions`로 찾아 준다.
export function missingSdkPermission(
  declaration: Pick<AppDeclaration, "sdk_dependencies" | "permissions">,
  userPackagePermissions: ReadonlyMap<string, readonly string[]> = new Map(),
): SdkPermissionFailure | undefined {
  const declared = new Set<string>(
    declaration.permissions.map((permission) => permission.kind),
  );
  const cap = missingCapPermission(
    declaration.sdk_dependencies.map((dependency) => dependency.name),
    declared,
    "declaration permissions",
  );
  if (cap !== undefined) return cap;
  // `@me` package가 publish 때 적은 permission은 소비 앱 선언에도 모두 있어야 한다.
  for (const dependency of declaration.sdk_dependencies) {
    const key = `${dependency.name}@${dependency.version}`;
    const needed = userPackagePermissions.get(key);
    if (needed === undefined) continue;
    const missing = needed.find((kind) => !declared.has(kind));
    if (missing === undefined) continue;
    return {
      package: dependency.name,
      permissions: [missing],
      message: `${key} needs ${missing} in the declaration permissions`,
    };
  }
  return undefined;
}
