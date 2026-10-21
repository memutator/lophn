// 고정 blueprint에서 현재 release의 선언 사실을 만든다. permissions의 `currentDeclarations` port가
// 읽는 값이고 준비 때 한 번 계산해 release 행에 둔다(permissions는 blueprint를 해석하지 않는다).
import type { Blueprint } from "../blueprint/mod.ts";
import type { GrantPermissionRequirement } from "../../../protocol/apps/mod.ts";
import type { AppDeclarations } from "../permissions/mod.ts";

// 정규 입력(default를 채운)의 sha256이다. `canonicalInputHash`(async)와 같은 값이고 core의 동기
// command가 쓰므로 node:crypto로 계산한다. 입력이 없으면 정규 JSON null을 hash한다.

export function declarationsOfBlueprint(
  release: string,
  blueprint: Blueprint,
): AppDeclarations | undefined {
  return {
    release,
    permissions: blueprint
      .permissions as unknown as readonly GrantPermissionRequirement[],
    app_connections: blueprint.app_connections.map((use) => ({
      app: use.app,
      tools: [...use.tools],
    })),
    tools: blueprint.tools.map((tool) => tool.name),
  };
}
