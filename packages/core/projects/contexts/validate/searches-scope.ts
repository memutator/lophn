// 검색 한 개의 이름 풀이: 시작 type과 follow 별칭이 어느 type의 field를 보여 주는지.
import {
  type BundleContent,
  type Condition,
  type ContractType,
  followedTypeRef,
  splitExternalRef,
} from "../../../../protocol/projects/mod.ts";
import type { ContractIssue, ExternalType, ValidationEnv } from "./types.ts";

type Path = (string | number)[];
type Search = BundleContent["searches"][number];
type Follow = Search["query"]["follow"][number];

// 모든 개체가 가진 field
const BUILTIN_FIELDS = ["key", "path"];

// 별칭이 가리키는 type. unresolved면 원인은 이미 다른 issue로 알렸으니 더 말하지 않는다.
type Target =
  | { kind: "own"; type: ContractType }
  | { kind: "external"; ref: string; type: ExternalType }
  | { kind: "unresolved" };

export type Scope = {
  start: Target;
  aliases: Map<string, Target>;
};

function ownTarget(
  bundle: BundleContent,
  name: string,
): Target {
  const type = bundle.contract.types.find((t) => t.name === name);
  return type === undefined ? { kind: "unresolved" } : { kind: "own", type };
}

function externalTarget(env: ValidationEnv, ref: string): Target {
  const parts = splitExternalRef(ref);
  const type = parts === undefined
    ? undefined
    : env.externalTypes.find((t) =>
      t.context === parts.context && t.name === parts.type
    );
  // 없는 type과 private type은 relations 검사가 알린다.
  if (type === undefined || type.visibility !== "public") {
    return { kind: "unresolved" };
  }
  return { kind: "external", ref, type };
}

function resolveFollow(
  bundle: BundleContent,
  env: ValidationEnv,
  from: Target,
  follow: Follow,
): { target: Target; relationKnown: boolean } {
  if (from.kind === "unresolved") {
    return { target: from, relationKnown: true };
  }
  // 같은 계약은 `Type`, 다른 context는 `context/Type`으로 가리킨다.
  const fromRef = from.kind === "own" ? from.type.name : from.ref;
  const ref = followedTypeRef(bundle.contract.types, fromRef, follow);
  if (ref === undefined) {
    return { target: { kind: "unresolved" }, relationKnown: false };
  }
  return {
    target: ref.includes("/")
      ? externalTarget(env, ref)
      : ownTarget(bundle, ref),
    relationKnown: true,
  };
}

// follow를 차례로 풀어 별칭 표를 만든다. 별칭은 앞선 follow의 것만 출발점이 된다.
export function buildScope(
  bundle: BundleContent,
  env: ValidationEnv,
  searchIndex: number,
  search: Search,
  issues: ContractIssue[],
  // follow 하나를 풀 때마다 그 시점의 scope를 알려 준다(follow.where가 쓴다).
  onFollow?: (index: number, scope: Scope) => void,
): Scope {
  const start = ownTarget(bundle, search.query.from);
  const scope: Scope = { start, aliases: new Map() };
  search.query.follow.forEach((follow, i) => {
    const at: Path = ["searches", searchIndex, "query", "follow", i];
    let from = start;
    if (follow.from !== undefined) {
      const known = scope.aliases.get(follow.from);
      if (known === undefined) {
        issues.push({
          code: "search_follow_from_unknown",
          path: [...at, "from"],
        });
        from = { kind: "unresolved" };
      } else {
        from = known;
      }
    }
    const { target, relationKnown } = resolveFollow(bundle, env, from, follow);
    if (!relationKnown) {
      issues.push({
        code: "search_follow_relation_unknown",
        path: [...at, "relation"],
      });
    }
    scope.aliases.set(follow.as, target);
    onFollow?.(i, scope);
  });
  return scope;
}

function fieldIssue(
  target: Target,
  field: string,
): "unknown" | "private" | undefined {
  if (target.kind === "unresolved" || BUILTIN_FIELDS.includes(field)) {
    return undefined;
  }
  if (target.kind === "own") {
    return target.type.fields.some((f) => f.name === field)
      ? undefined
      : "unknown";
  }
  const found = target.type.fields.find((f) => f.name === field);
  if (found === undefined) return "unknown";
  return found.visibility === "public" ? undefined : "private";
}

export function checkPath(
  scope: Scope,
  value: string,
  path: Path,
  issues: ContractIssue[],
): void {
  const dot = value.indexOf(".");
  let target: Target | undefined;
  let field: string;
  if (dot < 0) {
    target = scope.start;
    field = value;
  } else {
    target = scope.aliases.get(value.slice(0, dot));
    field = value.slice(dot + 1);
  }
  if (target === undefined) {
    issues.push({ code: "search_path_unknown", path });
    return;
  }
  const problem = fieldIssue(target, field);
  if (problem === "unknown") {
    issues.push({ code: "search_path_unknown", path });
  } else if (problem === "private") {
    issues.push({ code: "search_path_private", path });
  }
}

export function checkCondition(
  scope: Scope,
  inputs: ReadonlySet<string>,
  condition: Condition,
  path: Path,
  issues: ContractIssue[],
): void {
  if ("all" in condition || "any" in condition) {
    const key = "all" in condition ? "all" : "any";
    const list = "all" in condition ? condition.all : condition.any;
    list.forEach((child, i) =>
      checkCondition(scope, inputs, child, [...path, key, i], issues)
    );
    return;
  }
  if ("not" in condition) {
    checkCondition(scope, inputs, condition.not, [...path, "not"], issues);
    return;
  }
  checkPath(scope, condition.path, [...path, "path"], issues);
  const value = condition.value;
  if (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    !inputs.has(value.input)
  ) {
    issues.push({
      code: "search_input_unknown",
      path: [...path, "value", "input"],
    });
  }
}
