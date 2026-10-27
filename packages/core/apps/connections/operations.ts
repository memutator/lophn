import type { OperationPolicy } from "../../server/identity/mod.ts";

// 어떤 coding agent 통로도 approval 결정·grant 변경·secret 값·운영 backup·원본 임의 파일 접근을
// 제공하지 않는다(approval은 읽기만). 이 자원에서는 read만 상한에 오르고, 그 밖 종류(command·memory·upload·worker·file)는
// route 정의가 coding_agent를 선언해도 올리지 않는다. 이름 목록이 아니라 자원과 종류로 막아 새 route도
// 같은 선을 넘지 못한다.
const READ_ONLY_RESOURCES: ReadonlySet<string> = new Set([
  "approvals",
  "grants",
  "secrets",
  "backups",
]);

type RouteShape = {
  name: string;
  resource: string;
  method: string;
  kind: string;
  actors: readonly string[];
};

// coding_agent operation 상한. route 정의가 actors에 coding_agent를 선언한 route만 올리고
// 더 넓히지 않는다. 사람 token 상한과 같은 방식이다. 연결마다의 범위(앱 하나)는 credential의
// targets가 따로 좁힌다.
// - blobs 자원은 올리지 않는다. 일반 blob 읽기는 coding agent에 열지 않는다;
//   안내 원문은 `packages.guide_body` 같은 좁은 route가 읽는다.
// - 위 READ_ONLY_RESOURCES의 비 read는 올리지 않는다.
// - 이미 coding_agent 정책이 있는 이름은 다시 더하지 않는다.
export function codingAgentOperationPolicies(
  routes: readonly RouteShape[],
  existing: readonly OperationPolicy[],
): OperationPolicy[] {
  const taken = new Set(
    existing
      .filter((policy) => policy.actors.includes("coding_agent"))
      .map((policy) => policy.name),
  );
  return routes
    .filter(
      (route) =>
        route.actors.includes("coding_agent") &&
        route.resource !== "blobs" &&
        !(READ_ONLY_RESOURCES.has(route.resource) && route.kind !== "read") &&
        !taken.has(route.name),
    )
    .map(
      (route): OperationPolicy => ({
        name: route.name,
        actors: ["coding_agent"],
        kind: route.kind === "command" ? "command" : "read",
      }),
    );
}
