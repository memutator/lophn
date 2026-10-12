// 이 package를 쓰는 앱 선언이 요구 permission을 빠뜨리면 거절한다.
// import도 이 검사도 grant를 주지 않는다. grant는 apps/permissions의 사람 승인이다.

export const REQUIRED_PERMISSIONS: readonly (readonly string[])[] = [
  ["fs.read", "fs.write"],
];

const PACKAGE = "@lophn/cap-fs";

export type DeclarationLike = {
  sdk_dependencies?: readonly { name: string }[];
  permissions?: readonly { kind: string }[];
};

export type DeclarationCheck =
  | { ok: true }
  | {
    ok: false;
    error: {
      code: "invalid_input";
      message: string;
      package: string;
      // 이 중 하나 이상을 blueprint permissions에 선언해야 한다.
      permissions: readonly string[];
    };
  };

export function checkDeclaration(blueprint: DeclarationLike): DeclarationCheck {
  const uses = (blueprint.sdk_dependencies ?? []).some((dependency) =>
    dependency.name === PACKAGE
  );
  if (!uses) return { ok: true };
  const declared = new Set(
    (blueprint.permissions ?? []).map((permission) => permission.kind),
  );
  for (const group of REQUIRED_PERMISSIONS) {
    if (group.some((kind) => declared.has(kind))) continue;
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: `${PACKAGE} needs ${
          group.join(" or ")
        } in the blueprint permissions`,
        package: PACKAGE,
        permissions: group,
      },
    };
  }
  return { ok: true };
}
