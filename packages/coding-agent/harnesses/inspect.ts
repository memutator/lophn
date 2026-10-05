// 설치 관측이다(coding-agent/harnesses#R3, R10, T32). 설치한 resource의 현재
// 상태(component)와 네 loading 단계를 따로 모아 HarnessIntegrationObservation을
// 만든다. component의 current는 receipt와 현재 파일의 일치일 뿐이고 loading
// 성공을 뜻하지 않는다(R3). 읽기만 하며 파일·receipt·설정을 바꾸지 않는다.
import { fingerprint } from "../../base/mod.ts";
import {
  type ComponentKind,
  type ComponentObservation,
  type HarnessIntegrationObservation,
  harnessIntegrationObservationSchema,
} from "../../contracts/coding-agent/mod.ts";
import { fragmentDigest, type Store } from "./integration/apply.ts";
import type { PlannedResource } from "./integration/plan.ts";
import type { OwnedResource } from "./integration/receipt.ts";
import { treeDigest } from "./integration/tree.ts";
import {
  type LoadingInput,
  type LoadingPorts,
  type LoadingReport,
  observeLoading,
} from "./loading.ts";
import { rootOf } from "./resolvers.ts";

export type InspectInput = LoadingInput & {
  // 관측 시각이다(UTC `YYYY-MM-DDTHH:mm:ss.sssZ`).
  now: string;
};

export type InspectPorts = LoadingPorts & {
  // receipt 읽기만 쓴다. 저장 연산은 받지 않는다.
  store: Pick<Store, "receipt">;
};

export type Inspection = {
  observation: HarnessIntegrationObservation;
  // 다음 확인 방법을 담은 loading 결과다. observation의 loading_checks와 같은
  // 단계·결과·이유다.
  loading: LoadingReport[];
};

function kindOf(identity: string): ComponentKind {
  if (identity.startsWith("mcp:")) return "mcp";
  if (identity.startsWith("skill:")) return "skill";
  if (identity.startsWith("instruction:")) return "guide";
  if (identity.startsWith("hook:")) return "hook";
  return "cli_wrapper";
}

// receipt resource가 어느 root에 있는지다. builder가 만든 identity 규칙을
// 되짚는다. 모르면 null이고 그 component는 unknown이다.
function resolverOf(
  input: LoadingInput,
  identity: string,
): { resolver: string; format: PlannedResource["format"] } | null {
  const { definition, target } = input;
  const scope = target.scope_kind;
  const config =
    definition.config_targets.find((entry) => entry.scope_kind === scope) ??
      definition.config_targets.find((entry) => entry.scope_kind === "user");
  if (identity.startsWith("mcp:")) {
    return config === undefined
      ? null
      : { resolver: config.root_resolver, format: config.format };
  }
  if (identity.startsWith("skill:")) {
    const root = definition.skill_targets.find((entry) =>
      entry.scope_kind === scope
    );
    return root === undefined
      ? null
      : { resolver: root.root_resolver, format: "directory" };
  }
  if (identity === "instruction:region") {
    return { resolver: "project", format: "text" };
  }
  if (identity.startsWith("instruction:")) {
    return config === undefined
      ? null
      : { resolver: config.root_resolver, format: "json" };
  }
  if (identity.startsWith("hook:")) {
    const event = identity.slice("hook:".length);
    const hook = definition.hooks.find((entry) => entry.event === event);
    return hook === undefined
      ? null
      : { resolver: hook.target.root_resolver, format: "json" };
  }
  return null;
}

async function componentOf(
  input: LoadingInput,
  ports: InspectPorts,
  receiptRef: string,
  resource: OwnedResource,
  now: string,
): Promise<ComponentObservation> {
  const base = {
    kind: kindOf(resource.canonical_identity),
    resource_identity: resource.canonical_identity,
    expected_version: null,
    expected_hash: null,
    observed_version: null,
    observed_hash: null,
    ownership: "owned" as const,
    receipt_ref: receiptRef,
    observed_at: now,
  };
  const where = resolverOf(input, resource.canonical_identity);
  const roots = {
    ...input.roots,
    cwd: input.target.scope_kind === "app"
      ? input.target.app_realpath
      : input.roots.cwd,
  };
  const root = where === null ? null : rootOf(where.resolver, roots);
  if (where === null || root === null || !root.ok) {
    return {
      ...base,
      effective_target: resource.path,
      state: "unknown",
      reason: "resource의 설치 root를 풀지 못했다",
    };
  }
  const effective = `${where.resolver}/${resource.path}`;
  const path = `${root.value}/${resource.path}`;
  const read = await ports.files.read(path);
  if (read.kind === "absent") {
    return {
      ...base,
      effective_target: effective,
      state: "missing",
      reason: "receipt에 있는 resource가 사라졌다",
    };
  }
  if (read.kind === "symlink" || read.kind === "error") {
    return {
      ...base,
      effective_target: effective,
      state: "error",
      reason: "resource를 읽지 못했다(symlink·읽기 오류)",
    };
  }
  let digest: string | "broken";
  if (resource.topology === "directory") {
    const listed = await ports.files.listFiles(path);
    if (listed.kind !== "files") {
      return {
        ...base,
        effective_target: effective,
        state: "error",
        reason: "skill 디렉터리를 읽지 못했다(symlink·읽기 오류)",
      };
    }
    digest = await treeDigest(listed.files);
  } else if (read.kind === "directory") {
    return {
      ...base,
      effective_target: effective,
      state: "error",
      reason: "파일이어야 할 resource가 디렉터리다",
    };
  } else {
    digest = await fragmentDigest(read.text, {
      identity: resource.canonical_identity,
      path: resource.path,
      kind: "config",
      owned_key: resource.owned_key,
      format: where.format,
      content: "",
    });
  }
  if (digest === "broken") {
    return {
      ...base,
      effective_target: effective,
      state: "error",
      reason: "설정이 깨져 소유 조각을 읽지 못했다",
    };
  }
  const expected = resource.topology === "directory"
    ? resource.last_written_hash
    : resource.owned_fragment_digest;
  if (
    resource.topology === "file" && resource.owned_key !== null &&
    digest === await fingerprint(null)
  ) {
    return {
      ...base,
      effective_target: effective,
      state: "missing",
      reason: "파일은 있으나 lophn 소유 조각이 없다",
    };
  }
  return {
    ...base,
    observed_hash: digest,
    effective_target: effective,
    state: digest === expected ? "current" : "modified",
    reason: digest === expected
      ? "receipt의 마지막 hash와 현재 값이 같다(loading 성공을 뜻하지 않는다)"
      : "receipt의 마지막 hash와 현재 값이 달라 사람이 고친 것으로 보존한다",
  };
}

export async function inspectIntegration(
  input: InspectInput,
  ports: InspectPorts,
): Promise<Inspection> {
  const receipt = await ports.store.receipt(input.target);
  const components: ComponentObservation[] = [];
  if (receipt !== null) {
    const ref = receipt.operation_id;
    for (const resource of receipt.resources) {
      components.push(
        await componentOf(input, ports, ref, resource, input.now),
      );
    }
  }
  const loading = await observeLoading(input, ports);
  const observation = harnessIntegrationObservationSchema.parse({
    target: input.target,
    connection: input.connection?.id ?? null,
    catalog_revision: input.definition.catalog_revision,
    adapter_revision: input.definition.adapter_revision,
    observed_at: input.now,
    components,
    loading_checks: loading.map((check) => ({
      stage: check.stage,
      result: check.result,
      reason: check.reason,
    })),
  });
  return { observation, loading };
}
