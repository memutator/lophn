// 설치 plan이다(coding-agent/harnesses#R6, T29). 사람이 고른 harness·native
// 환경·profile·범위의 exact target만 담는다. 감지된 다른 제품·다른 profile은
// 이 plan에 들어오지 않는다(R6 확인). plan은 파일을 읽기만 하고 쓰지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  HarnessId,
  IntegrationTarget,
} from "../../../protocol/coding-agent/mod.ts";
import type { HarnessDefinition } from "../model.ts";

// 설치할 조각의 종류다. 제품 adapter(T30·T31)가 내용을 채운다.
export type PlannedResource = {
  identity: string;
  // target root 기준 상대 경로다. 절대 경로·`..`는 거절한다(R6).
  path: string;
  kind: "config" | "skill" | "instruction" | "hook";
  // config fragment merge의 소유 key다. 파일 전체 소유면 null이다.
  owned_key: string | null;
  format: "json" | "toml" | "yaml" | "text" | "directory";
  // 쓸 내용이다. directory는 파일 목록이고 나머지는 본문이다.
  content: string | readonly { path: string; content: string }[];
};

export type InstallPlan = {
  target: IntegrationTarget;
  // 사람이 고른 connection 참조다. token 원문은 없다(connection#R17).
  connection: string | null;
  catalog_revision: string;
  adapter_revision: string;
  resources: readonly PlannedResource[];
};

export type PlanInput = {
  definition: HarnessDefinition;
  target: IntegrationTarget;
  connection: string | null;
  resources: readonly PlannedResource[];
};

// plan이 거절하는 이유다(domain-model integration.plan).
export type PlanError =
  | { code: "invalid_target"; detail: string }
  | { code: "unsupported"; detail: string };

// 고른 harness와 target이 같은 제품인지, native host인지, 경로가 root 안인지
// 본다(R6). 다른 제품·WSL·remote·root 밖 경로는 plan에 들어오지 않는다.
export type PlanResult = Result<InstallPlan, PlanError>;

export function planOf(input: PlanInput): PlanResult {
  const { definition, target } = input;
  if (definition.harness_id !== target.harness_id) {
    return err({
      code: "invalid_target",
      detail: "plan은 고른 harness의 target만 받는다",
    });
  }
  if (target.environment.kind !== "host") {
    return err({
      code: "unsupported",
      detail: "지금은 native host만 설치한다",
    });
  }
  for (const resource of input.resources) {
    if (!insideRoot(resource.path)) {
      return err({
        code: "invalid_target",
        detail: "resource 경로가 target root 밖이다",
      });
    }
    if (Array.isArray(resource.content)) {
      for (const file of resource.content) {
        if (!insideRoot(file.path)) {
          return err({
            code: "invalid_target",
            detail: "skill 파일이 skill 디렉터리 밖이다",
          });
        }
      }
    }
  }
  return ok({
    target,
    connection: input.connection,
    catalog_revision: definition.catalog_revision,
    adapter_revision: definition.adapter_revision,
    resources: input.resources,
  });
}

// root 밖을 가리키는 경로를 거절한다. 절대 경로·`..`·빈 조각이 없다.
function insideRoot(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.length > 0 &&
    segments.every((segment) =>
      segment !== "" && segment !== "." && segment !== ".."
    );
}

// 고른 harness가 catalog에 있는지 확인하는 자리의 식별자다. 다른 제품 설치를
// 막기 위해 plan은 harness id를 그대로 보존한다(R6).
export function chosenHarness(plan: InstallPlan): HarnessId {
  return plan.target.harness_id;
}
