// 고정 선언에서 현재 release의 선언 사실을 만든다. permissions의 `currentFacts` port가
// 읽는 값이고 준비 때 한 번 계산해 release 행에 둔다(permissions는 선언을 해석하지 않는다).
import type { AppDeclaration } from "../declaration/mod.ts";
import type { GrantPermissionRequirement } from "../../../protocol/apps/mod.ts";
import type { AppFacts } from "../permissions/mod.ts";

// 정규 입력(default를 채운)의 sha256이다. `canonicalInputHash`(async)와 같은 값이고 core의 동기
// command가 쓰므로 node:crypto로 계산한다. 입력이 없으면 정규 JSON null을 hash한다.

export function factsOfDeclaration(
  release: string,
  declaration: AppDeclaration,
): AppFacts | undefined {
  return {
    release,
    permissions:
      declaration.permissions as unknown as readonly GrantPermissionRequirement[],
    app_connections: declaration.app_connections.map((use) => ({
      app: use.app,
      tools: [...use.tools],
    })),
    tools: declaration.tools.map((tool) => tool.name),
  };
}
