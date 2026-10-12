import { canonicalize } from "../../base/mod.ts";
import type {
  Grant,
  GrantPermissionKind,
  GrantPermissionScope,
} from "../../protocol/apps/mod.ts";
import type { AppDeclarations } from "./declarations.ts";

// 실행 범위 = 현재 release 요구 ∩ 현재 active grant(apps/permissions#R2).
// 읽는 쪽(supervisor·broker)이 grants.list의 결과와 현재 선언으로 계산한다. 이 함수는 IO가 없다.

type AccessKind = Exclude<
  GrantPermissionKind,
  "app.call" | "agent.commands" | "automation.run"
>;

const ACCESS_KINDS: ReadonlySet<GrantPermissionKind> = new Set<
  GrantPermissionKind
>([
  "fs.read",
  "fs.write",
  "net.fetch",
  "net.listen",
  "secret.use",
  "document.save",
]);

export type AccessEntry = {
  kind: AccessKind;
  // 선언한 범위(= 같은 범위의 grant가 허락한 것). kind 구분자는 뺀다.
  scope: Record<string, unknown>;
};

export type AutomationEntry = {
  automation: string;
  command: string;
  input_hash: string;
  when: Extract<GrantPermissionScope, { kind: "automation.run" }>["when"];
};

export type EffectiveScope = {
  access: AccessEntry[];
  // 부르는 앱이 target마다 실제 부를 수 있는 command. 방향은 caller → target 하나다.
  app_calls: { app: string; commands: string[] }[];
  // lophn agent가 이 앱에서 열 수 있는 command의 상한. 기본은 닫힘(빈 목록)이다.
  agent_commands: string[];
  automations: AutomationEntry[];
};

export type EffectiveInput = {
  app: string;
  // 현재 release의 선언. release가 없으면 null이고 실행 범위는 0이다.
  declarations: AppDeclarations | null;
  // 이 앱과 다른 앱의 grant가 섞여 있어도 된다. active이고 방향이 맞는 것만 쓴다.
  grants: readonly Grant[];
  // target 앱의 현재 command key. 모르는 앱은 undefined이고 호출 범위가 없다.
  targetCommands(app: string): readonly string[] | undefined;
};

function bare(scope: GrantPermissionScope): Record<string, unknown> {
  const { kind: _kind, ...rest } = scope;
  return rest;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function effectiveScope(input: EffectiveInput): EffectiveScope {
  const empty: EffectiveScope = {
    access: [],
    app_calls: [],
    agent_commands: [],
    automations: [],
  };
  const declarations = input.declarations;
  if (declarations === null) return empty;
  const grants = input.grants.filter((grant) =>
    grant.status === "active" && grant.app === input.app
  );

  const access: AccessEntry[] = [];
  for (const requirement of declarations.permissions) {
    if (!ACCESS_KINDS.has(requirement.kind)) continue;
    const wanted = canonicalize(requirement.scope);
    const granted = grants.some((grant) =>
      grant.kind === requirement.kind &&
      canonicalize(bare(grant.scope)) === wanted
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
    )
  );

  const appCalls: { app: string; commands: string[] }[] = [];
  for (const target of sorted(declarations.app_connections.map((c) => c.app))) {
    const declared = new Set(
      declarations.app_connections.filter((c) => c.app === target)
        .flatMap((c) => c.commands),
    );
    const live = new Set(input.targetCommands(target) ?? []);
    const allowed = new Set<string>();
    for (const grant of grants) {
      if (grant.scope.kind !== "app.call" || grant.scope.app !== target) {
        continue;
      }
      for (const command of grant.scope.commands) allowed.add(command);
    }
    const commands = sorted(
      [...allowed].filter((c) => declared.has(c) && live.has(c)),
    );
    if (commands.length > 0) appCalls.push({ app: target, commands });
  }

  const known = new Set(declarations.commands);
  const agent = new Set<string>();
  for (const grant of grants) {
    if (grant.scope.kind !== "agent.commands") continue;
    for (const command of grant.scope.commands) {
      if (known.has(command)) agent.add(command);
    }
  }

  const automations: AutomationEntry[] = [];
  for (const declared of declarations.automations) {
    if (!declared.external) continue;
    const wanted = canonicalize({
      automation: declared.key,
      command: declared.command,
      input_hash: declared.input_hash,
      when: declared.when,
    });
    const granted = grants.some((grant) =>
      grant.scope.kind === "automation.run" &&
      canonicalize(bare(grant.scope)) === wanted
    );
    if (granted) {
      automations.push({
        automation: declared.key,
        command: declared.command,
        input_hash: declared.input_hash,
        when: declared.when,
      });
    }
  }
  automations.sort((a, b) => a.automation.localeCompare(b.automation));

  return {
    access,
    app_calls: appCalls,
    agent_commands: sorted(agent),
    automations,
  };
}
