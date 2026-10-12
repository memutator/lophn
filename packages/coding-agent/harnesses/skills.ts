// skill 발견 root의 가림·가려짐 판정이다. 순수
// 값이다. 제품이 읽는 root는 설치 root 하나가 아니라 `.agents/skills`·
// `.claude/skills` 같은 다른 root도 있어서(조사 skills-and-guides) 설치 root에
// 동명 skill이 없어도 다른 root의 동명 skill이 lophn skill을 가리거나 사람의
// skill을 가릴 수 있다. 어느 쪽이든 자동 교체 없이 conflict로 낸다.
import type { HarnessDefinition, SkillDiscoverySpec } from "./model.ts";

// 한 발견 root에서 본 skill 이름이다. 호출자가 root를 resolve해 읽은 결과다.
export type SkillRootView = {
  scope_kind: "user" | "app";
  root_resolver: string;
  path: string;
  names: readonly string[];
};

export type SkillShadow = {
  name: string;
  // 설치하려는 skill이 가려지는지(shadowed_by), 사람의 skill을 가리는지
  // (shadows)다.
  relation: "shadowed_by" | "shadows";
  scope_kind: "user" | "app";
  root_resolver: string;
  path: string;
};

function discoveryOf(
  definition: HarnessDefinition,
): readonly SkillDiscoverySpec[] {
  return definition.skill_discovery ?? definition.skill_targets;
}

function same(left: SkillDiscoverySpec, right: SkillDiscoverySpec): boolean {
  return left.scope_kind === right.scope_kind &&
    left.root_resolver === right.root_resolver && left.path === right.path;
}

// 사람이 고른 scope의 설치 root에 name을 설치할 때 다른 발견 root의 동명 skill
// 을 찾는다. app 설치는 user root도 읽히는 root라 함께 본다. 설치 root 자체의
// 동명은 engine이 receipt 없는 동명으로 conflict를 낸다.
export function skillShadowsOf(
  definition: HarnessDefinition,
  scope: "user" | "app",
  name: string,
  views: readonly SkillRootView[],
): SkillShadow[] {
  const installRoot = definition.skill_targets.find((entry) =>
    entry.scope_kind === scope
  );
  if (installRoot === undefined) return [];
  const discovery = discoveryOf(definition);
  const installRank = discovery.findIndex((entry) => same(entry, installRoot));
  const found: SkillShadow[] = [];
  for (const view of views) {
    if (!view.names.includes(name)) continue;
    if (same(view, installRoot)) continue;
    // user 설치에서 app root는 이 session 밖이다.
    if (scope === "user" && view.scope_kind === "app") continue;
    const rank = discovery.findIndex((entry) => same(entry, view));
    if (rank < 0) continue;
    found.push({
      name,
      relation: rank < installRank ? "shadowed_by" : "shadows",
      scope_kind: view.scope_kind,
      root_resolver: view.root_resolver,
      path: view.path,
    });
  }
  return found;
}

// 사람이 볼 제품별 skill 발견 위치 안내다. trust·consent는 사람
// 결정이고 lophn이 자동으로 넓히지 않는다.
export function skillGuidanceOf(definition: HarnessDefinition): string[] {
  const roots = discoveryOf(definition).map((entry) =>
    `${entry.scope_kind}:${entry.root_resolver}/${entry.path}`
  );
  return [
    `${definition.label}은 ${roots.join(", ")}를 읽는다(앞이 우선)`,
    ...(definition.skill_trust_note === undefined
      ? []
      : [definition.skill_trust_note]),
  ];
}
