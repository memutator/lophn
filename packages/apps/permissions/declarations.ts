import { err, ok, type Result } from "../../base/mod.ts";
import {
  definePort,
  type ReadSnapshot,
  type Tx,
} from "../../contracts/platform/mod.ts";
import type {
  GrantPermissionRequirement,
  GrantPermissionScope,
} from "../../contracts/apps/mod.ts";

// grant가 기대는 현재 release의 선언이다. releases(apps/releases)가 고정 blueprint에서
// 만들어 port로 내놓는다. permissions는 blueprint 내용을 읽거나 해석하지 않는다.
// 자동 회차의 input_hash는 default를 채운 정규 입력의 sha256이며 계산은 선언 쪽이 한다.
export type AutomationDeclarationFact = {
  key: string;
  command: string;
  external: boolean;
  input_hash: string;
  when: Extract<GrantPermissionScope, { kind: "automation.run" }>["when"];
};

export type AppDeclarations = {
  release: string;
  permissions: readonly GrantPermissionRequirement[];
  // 이 앱이 부르겠다고 선언한 다른 앱 command(app_connections).
  app_connections: readonly { app: string; commands: readonly string[] }[];
  // 현재 blueprint의 command key 전체.
  commands: readonly string[];
  automations: readonly AutomationDeclarationFact[];
  // 현재 blueprint가 선언한 problem code. broker의 보고 검사가 쓴다.
  problem_codes?: readonly string[];
  // 현재 blueprint의 문서 선언. documents 저장 어댑터가 쓴다.
  documents?: readonly {
    key: string;
    name: string;
    description: string;
    format: { name: string; module_hash: string; explicit: boolean };
    document?: string;
  }[];
};

export interface CurrentDeclarations {
  // 현재 release가 없으면 null이다. sql은 부른 transaction·snapshot의 것이다.
  // reader Worker의 port는 고정 값이라 구현은 sql을 받아 읽는다.
  get(
    sql: Pick<Tx["sql"], "get" | "all">,
    app: string,
  ): Result<AppDeclarations | null>;
}

export const currentDeclarations = definePort<CurrentDeclarations>(
  "apps.permissions.CurrentDeclarations",
);

// 선언 port가 등록되지 않은 core에서는 선언 비교가 필요한 grant를 만들지 않는다.
// 선언을 알 수 없는데 허락 범위가 선언과 같다고 가정하지 않는다(fail-closed).
export function declarationsOf(
  tx: Pick<Tx, "port" | "sql">,
  app: string,
): Result<AppDeclarations | null> {
  const lookup = tx as Pick<Tx, "port" | "sql"> & {
    portLookup?: { present(key: object): boolean };
  };
  if (lookup.portLookup?.present(currentDeclarations) !== true) {
    return err({
      code: "unavailable",
      message: "current release declarations are unavailable",
    });
  }
  const declarations = tx.port(currentDeclarations);
  const found = declarations.get(tx.sql, app);
  return found.ok ? ok(found.value) : found;
}

// read 쪽. 선언을 낼 주체가 없으면(port 미등록) 선언을 모르는 것이고 null이다.
export function declarationsAt(
  snapshot: Pick<ReadSnapshot, "port" | "sql">,
  app: string,
): Result<AppDeclarations | null> {
  let declarations: CurrentDeclarations;
  try {
    declarations = snapshot.port(currentDeclarations);
  } catch {
    return ok(null);
  }
  return declarations.get(snapshot.sql, app);
}
