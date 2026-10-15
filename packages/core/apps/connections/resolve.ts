// 앱 쌍의 호출 범위 계산. 순수 함수이고 IO가 없다.
// 범위 = source release.app_connections의 대상 command ∩ source→target active app.call grant의
// command ∩ target의 현재 command. 방향은 source → target 하나뿐이다.
import type { Grant } from "../../../protocol/apps/mod.ts";

export type PairDeclaration = {
  app: string;
  commands: readonly string[];
};

export type PairInput = {
  source: string;
  target: string;
  // source의 현재 release가 선언한 앱 연결(release.app_connections).
  declared: readonly PairDeclaration[];
  // grant가 섞여 있어도 된다. active이고 source→target 방향의 app.call만 쓴다.
  grants: readonly Grant[];
};

type PairGrant = { id: string; commands: readonly string[] };

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function pairGrants(input: PairInput): PairGrant[] {
  const found: PairGrant[] = [];
  for (const grant of input.grants) {
    if (grant.status !== "active" || grant.app !== input.source) continue;
    if (grant.scope.kind !== "app.call" || grant.scope.app !== input.target) {
      continue;
    }
    found.push({ id: grant.id, commands: grant.scope.app_apis });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

// 선언과 grant가 함께 허락한 command다. target이 지금 무엇을 갖는지는 보지 않는다.
export function pairScope(input: PairInput): string[] {
  if (input.source === input.target) return [];
  const declared = new Set(
    input.declared.filter((item) => item.app === input.target)
      .flatMap((item) => item.commands),
  );
  const granted = pairGrants(input).flatMap((grant) => grant.commands);
  return sorted(granted.filter((command) => declared.has(command)));
}

export type Resolution =
  // 이 앱 쌍에는 선언∩grant가 없다. 없는 대상 앱과 같은 응답으로 다룬다.
  | { kind: "absent" }
  // 앱 쌍은 열려 있지만 요청한 command 중 일부가 지금 범위 밖이다. commands는 지금 부를 수 있는 것.
  | { kind: "denied"; commands: string[] }
  | { kind: "scoped"; commands: string[]; grant: string };

// requested가 모두 범위 안이어야 한다. 새 command·선언에서 빠진 command·대상에서 사라진
// command는 옛 grant로 부를 수 없다.
export function resolveCall(
  input: PairInput & {
    targetCommands: readonly string[];
    requested: readonly string[];
  },
): Resolution {
  const scope = pairScope(input);
  if (scope.length === 0) return { kind: "absent" };
  const live = new Set(input.targetCommands);
  const callable = sorted(scope.filter((command) => live.has(command)));
  const requested = sorted(input.requested);
  if (
    requested.length === 0 ||
    !requested.every((command) => callable.includes(command))
  ) {
    return { kind: "denied", commands: callable };
  }
  // origin.grant는 앱 쌍 grant 하나다. 요청 command를 가장 많이 덮는 grant를 고른다.
  let best: { id: string; covered: number } | undefined;
  for (const grant of pairGrants(input)) {
    const covered = requested.filter((command) =>
      grant.commands.includes(command)
    ).length;
    if (covered > 0 && (best === undefined || covered > best.covered)) {
      best = { id: grant.id, covered };
    }
  }
  return { kind: "scoped", commands: requested, grant: best!.id };
}
