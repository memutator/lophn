import { canonicalize } from "../../base/mod.ts";
import type { Grant } from "../../contracts/apps/mod.ts";
import { LIMIT_KEYS, type LimitKey } from "./flags.ts";
import type { ResolvedRequirement } from "./model.ts";

// confirmation window가 grant 결정 앞에서 보여 주는 자료다(apps/permissions#R24, R25).
// 요구(kind·정규 scope·reason), 조합 경고, Deno 한계 문구 key만 담는다. 문구 본문은
// design wording catalog의 몫이라 여기에는 key만 둔다. 이 자료를 만드는 것이 grant를 주는 것은
// 아니다: 아무 grant도 자동으로 만들지 않는다.

export const WARNING_KEYS = [
  // fs.read와 net.fetch를 함께 요구: 읽은 자료를 바깥으로 보낼 수 있다(R24).
  "permissions.warning.file-read-and-network",
  // 폴더 밖을 가리키는 link가 폴더 안에 있다(R6).
  "permissions.warning.outside-link",
] as const;
export type WarningKey = (typeof WARNING_KEYS)[number];

export type RequirementDisplay = {
  kind: ResolvedRequirement["kind"];
  // 부여 때 푼 실제 scope. fs는 실제 절대 경로다.
  scope: Record<string, unknown>;
  reason: string;
  // 같은 정규 scope의 active grant가 이미 있다.
  granted: boolean;
  warnings: WarningKey[];
  // 폴더 밖을 가리키는 link(fs만). 사람이 대상을 보게 한다.
  outside_links: string[];
};

export type CombinationWarning = {
  key: WarningKey;
  kinds: ResolvedRequirement["kind"][];
};

export type GrantDisplay = {
  app: string;
  release: string;
  requirements: RequirementDisplay[];
  combination_warnings: CombinationWarning[];
  limit_keys: readonly LimitKey[];
};

function scopeOf(requirement: ResolvedRequirement): Record<string, unknown> {
  if (requirement.kind === "fs.read" || requirement.kind === "fs.write") {
    return {
      path: requirement.scope.path,
      recursive: requirement.scope.recursive,
    };
  }
  return { ...requirement.scope };
}

function key(kind: string, scope: unknown): string {
  return `${kind}:${canonicalize(scope)}`;
}

export function buildGrantDisplay(input: {
  app: string;
  release: string;
  requirements: readonly ResolvedRequirement[];
  grants: readonly Grant[];
}): GrantDisplay {
  const active = new Set(
    input.grants.filter((grant) =>
      grant.status === "active" && grant.app === input.app
    ).map((grant) => {
      const { kind: _kind, ...scope } = grant.scope;
      return key(grant.kind, scope);
    }),
  );
  const requirements = input.requirements.map(
    (requirement): RequirementDisplay => {
      const scope = scopeOf(requirement);
      const outside =
        requirement.kind === "fs.read" || requirement.kind === "fs.write"
          ? [...requirement.scope.outsideLinks]
          : [];
      return {
        kind: requirement.kind,
        scope,
        reason: requirement.reason,
        granted: active.has(key(requirement.kind, scope)),
        warnings: outside.length > 0
          ? ["permissions.warning.outside-link"]
          : [],
        outside_links: outside,
      };
    },
  ).sort((a, b) => key(a.kind, a.scope).localeCompare(key(b.kind, b.scope)));
  const kinds = new Set(input.requirements.map((r) => r.kind));
  const combination: CombinationWarning[] = [];
  if (kinds.has("fs.read") && kinds.has("net.fetch")) {
    combination.push({
      key: "permissions.warning.file-read-and-network",
      kinds: ["fs.read", "net.fetch"],
    });
  }
  return {
    app: input.app,
    release: input.release,
    requirements,
    combination_warnings: combination,
    limit_keys: LIMIT_KEYS,
  };
}
