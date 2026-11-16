import { canonicalize } from "../../../base/mod.ts";
import type { AppGrant } from "../../../protocol/apps/mod.ts";
import type { AppFacts } from "./facts.ts";

// 실행 범위 = 현재 release 요구 ∩ 현재 active 앱 grant.
// 읽는 쪽(supervisor·broker)이 app_grants.list의 결과와 현재 선언으로 계산한다. 이 함수는 IO가 없다.

type AccessKind = Exclude<AppGrant["scope"]["kind"], "app.call">;

const ACCESS_KINDS: ReadonlySet<string> = new Set<AccessKind>([
  "fs.read",
  "fs.write",
  "net.fetch",
  "net.listen",
  "secret.use",
  "notify.send",
  "phone.use",
]);

type AccessEntry = {
  kind: AccessKind;
  // 선언한 범위(= 같은 범위의 grant가 허락한 것). kind 구분자는 뺀다.
  scope: Record<string, unknown>;
};

export type EffectiveScope = {
  access: AccessEntry[];
  // 부르는 앱이 target마다 실제 부를 수 있는 tool. 방향은 caller → target 하나다.
  app_calls: { app: string; tools: string[] }[];
};

type EffectiveInput = {
  app: string;
  // 현재 release의 선언. release가 없으면 null이고 실행 범위는 0이다.
  facts: AppFacts | null;
  // 이 앱과 다른 앱의 grant가 섞여 있어도 된다. active이고 이 앱의 것만 쓴다.
  grants: readonly AppGrant[];
  // target 앱의 현재 tool key. 모르는 앱은 undefined이고 호출 범위가 없다.
  targetCommands(app: string): readonly string[] | undefined;
};

function bare(scope: AppGrant["scope"]): Record<string, unknown> {
  const { kind: _kind, ...rest } = scope;
  return rest;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function effectiveScope(input: EffectiveInput): EffectiveScope {
  const empty: EffectiveScope = { access: [], app_calls: [] };
  const facts = input.facts;
  if (facts === null) return empty;
  const grants = input.grants.filter(
    (grant) => grant.status === "active" && grant.app === input.app,
  );

  const access: AccessEntry[] = [];
  for (const requirement of facts.permissions) {
    if (!ACCESS_KINDS.has(requirement.kind)) continue;
    const wanted = canonicalize(requirement.scope);
    const granted = grants.some(
      (grant) =>
        grant.scope.kind === requirement.kind &&
        canonicalize(bare(grant.scope)) === wanted,
    );
    if (granted) {
      access.push({
        kind: requirement.kind as AccessKind,
        scope: requirement.scope as Record<string, unknown>,
      });
    }
  }
  access.sort((a, b) =>
    `${a.kind}:${canonicalize(a.scope)}`.localeCompare(
      `${b.kind}:${canonicalize(b.scope)}`,
    ),
  );

  const appCalls: { app: string; tools: string[] }[] = [];
  for (const target of sorted(facts.app_connections.map((c) => c.app))) {
    const declared = new Set(
      facts.app_connections
        .filter((c) => c.app === target)
        .flatMap((c) => c.tools),
    );
    const live = new Set(input.targetCommands(target) ?? []);
    const allowed = new Set<string>();
    for (const grant of grants) {
      if (grant.scope.kind !== "app.call" || grant.scope.app !== target) {
        continue;
      }
      for (const command of grant.scope.app_tools) allowed.add(command);
    }
    const tools = sorted(
      [...allowed].filter((c) => declared.has(c) && live.has(c)),
    );
    if (tools.length > 0) appCalls.push({ app: target, tools });
  }

  return { access, app_calls: appCalls };
}
