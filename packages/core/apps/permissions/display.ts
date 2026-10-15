import { canonicalize } from "../../../base/mod.ts";
import {
  GRANT_WARNING_KEYS,
  type GrantCombinationWarning,
  type GrantDisplay as ContractGrantDisplay,
  type GrantRequirementDisplay,
  type GrantWarningKey,
} from "../../../protocol/apps/mod.ts";
import { resourceLabel } from "./declarations.ts";
import { LIMIT_KEYS } from "./flags.ts";
import type { ResolvedRequirement } from "./model.ts";

// confirmation window가 grant 결정 앞에서 보여 주는 자료다.
// 요구(kind·정규 scope·reason), 조합 경고, Deno 한계 문구 key만 담는다. 문구 본문은
// design wording catalog의 몫이라 여기에는 key만 둔다. 이 자료를 만드는 것이 grant를 주는 것은
// 아니다: 아무 grant도 자동으로 만들지 않는다. activation 카드가 "늘어난 선언"을 보일 때 쓴다.

export const WARNING_KEYS = GRANT_WARNING_KEYS;
export type WarningKey = GrantWarningKey;

export type RequirementDisplay = GrantRequirementDisplay;
export type CombinationWarning = GrantCombinationWarning;
export type GrantDisplay = ContractGrantDisplay;

function scopeOf(
  requirement: ResolvedRequirement,
): RequirementDisplay["scope"] {
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
  // compareDeclarations가 낸 늘어난 바깥 자원 이름. 여기 없는 요구는 이미 grant가 덮는다.
  added_resources: readonly string[];
}): GrantDisplay {
  const added = new Set(input.added_resources);
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
        granted: !added.has(resourceLabel(
          {
            kind: requirement.kind,
            ...scope,
          } as Parameters<typeof resourceLabel>[0],
        )),
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
    limit_keys: [...LIMIT_KEYS],
  };
}
