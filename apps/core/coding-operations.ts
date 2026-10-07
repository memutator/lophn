import type { OperationPolicy } from "../../packages/platform/identity/mod.ts";

// coding_agent operation 상한. route 정의가 actors에 coding_agent를 선언한 route만 올리고
// 더 넓히지 않는다. 사람 token 상한과 같은 방식이다. 연결마다의 범위(앱 하나)는 credential의
// targets가 따로 좁힌다.
// - blobs 자원은 올리지 않는다. 일반 blob 읽기는 coding agent에 열지 않는다(coding-agent#T36);
//   안내 원문은 `packages.guide_body` 같은 좁은 route가 읽는다.
// - 이미 coding_agent 정책이 있는 이름은 다시 더하지 않는다.
export function codingAgentOperationPolicies(
  routes: readonly {
    name: string;
    resource: string;
    kind: string;
    actors: readonly string[];
  }[],
  existing: readonly OperationPolicy[],
): OperationPolicy[] {
  const taken = new Set(
    existing.filter((policy) => policy.actors.includes("coding_agent")).map((
      policy,
    ) => policy.name),
  );
  return routes.filter((route) =>
    route.actors.includes("coding_agent") && route.resource !== "blobs" &&
    !taken.has(route.name)
  ).map((route): OperationPolicy => ({
    name: route.name,
    actors: ["coding_agent"],
    kind: route.kind === "command" ? "command" : "read",
  }));
}
