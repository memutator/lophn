// 이 package를 쓰는 앱 선언이 요구 permission을 빠뜨리면 거절한다.
// 앱 process는 권한을 막지 않으므로 이 검사는 선언이 무엇에 닿는지 보이는 값이지 보안 경계가 아니다.

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
        // 이 중 하나 이상을 선언의 permissions에 선언해야 한다.
        permissions: readonly string[];
      };
    };

export function checkDeclaration(
  declaration: DeclarationLike,
): DeclarationCheck {
  const uses = (declaration.sdk_dependencies ?? []).some(
    (dependency) => dependency.name === PACKAGE,
  );
  if (!uses) return { ok: true };
  const declared = new Set(
    (declaration.permissions ?? []).map((permission) => permission.kind),
  );
  for (const group of REQUIRED_PERMISSIONS) {
    if (group.some((kind) => declared.has(kind))) continue;
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: `${PACKAGE} needs ${group.join(
          " or ",
        )} in the declaration permissions`,
        package: PACKAGE,
        permissions: group,
      },
    };
  }
  return { ok: true };
}
