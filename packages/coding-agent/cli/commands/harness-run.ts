// `lophn harness` command의 실행이다. 표(harness.ts)는
// 입력 검사를, 여기는 이미 있는 catalog·감지·설치 engine을 부르는 일만 한다. 새 규칙이 없다.
// plan·install·update·remove는 사람이 고른 exact target 하나만 다루고 coding credential은 거절한다
// (cli#R40). 감지는 `detect`가 저장 결과를, `refresh`만 사람 요청 재감지를 먹는다(R2).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type {
  HarnessId,
  IntegrationTarget,
} from "../../../protocol/coding-agent/mod.ts";
import {
  catalogOf,
  type DetectOutcome,
  HARNESS_CATALOG,
  type Inspection,
  type InstallOutcome,
} from "../../harnesses/mod.ts";
import { describeInstall } from "./connection.ts";
import type { CommandOutput } from "./connection.ts";

export type HarnessWriteName =
  | "harness plan"
  | "harness install"
  | "harness update"
  | "harness remove";

export type HarnessRunDeps = {
  actor: "user" | "coding_agent";
  detect(mode: "detect" | "refresh"): Promise<Result<DetectOutcome>>;
  inspect(harness: HarnessId): Promise<Result<Inspection>>;
  // 선택 target의 설치 계획·설치·갱신·제거다. connection 참조가 있어야 한다.
  write(
    name: HarnessWriteName,
    request: {
      connection: string;
      target: IntegrationTarget;
      components: readonly string[];
      operationId: string;
    },
  ): Promise<Result<InstallOutcome>>;
  // 연결 상태 읽기다. 회수된 연결로는 쓰지 않는다.
  connections: {
    read(id: string): Promise<Result<{ state: "active" | "revoked" }>>;
  };
};

export function runHarnessList(): CommandOutput {
  const harnesses = HARNESS_CATALOG.map((definition) => ({
    harness_id: definition.harness_id,
    label: definition.label,
    catalog_revision: definition.catalog_revision,
    adapter_revision: definition.adapter_revision,
    version_policy: definition.version_policy,
    environments: definition.environments,
    config_scopes: definition.config_targets.map((item) => item.scope_kind),
    skill_scopes: definition.skill_targets.map((item) => item.scope_kind),
    hooks: definition.hooks.map((hook) => ({
      event: hook.event,
      purpose: hook.purpose,
      capability: hook.capability,
    })),
    execution: {
      transport: definition.execution.transport,
      capability: definition.execution.capability,
    },
  }));
  return {
    summary: `catalog에 제품 ${harnesses.length}개가 있다`,
    data: { harnesses },
    next: ["`lophn harness detect`로 이 컴퓨터에서 감지한 제품을 읽는다"],
  };
}

export async function runHarnessDetect(
  mode: "detect" | "refresh",
  deps: Pick<HarnessRunDeps, "detect">,
): Promise<Result<CommandOutput, LophnError>> {
  const detected = await deps.detect(mode);
  if (!detected.ok) return detected;
  const { detections, source, cache_saved } = detected.value;
  const found = detections.filter((item) => item.discovery === "detected");
  return ok({
    summary: source === "cached"
      ? `저장한 감지 결과다. 제품 ${found.length}개가 감지됐다(다시 감지하지 않았다)`
      : source === "refreshed"
      ? `다시 감지했다. 제품 ${found.length}개가 감지됐다`
      : `처음 감지했다. 제품 ${found.length}개가 감지됐다(version·auth probe는 refresh에서 한다)`,
    data: { source, cache_saved, detections },
    next: source === "refreshed"
      ? ["`lophn harness plan`으로 고른 제품 하나의 설치 계획을 본다"]
      : [
        "사람이 다시 확인하려면 `lophn harness refresh`를 실행한다. 자동 재감지는 없다",
      ],
  });
}

export async function runHarnessInspect(
  input: { harness?: HarnessId },
  deps: Pick<HarnessRunDeps, "inspect">,
): Promise<Result<CommandOutput, LophnError>> {
  const targets = input.harness === undefined
    ? HARNESS_CATALOG.map((definition) => definition.harness_id)
    : [input.harness];
  const inspections: {
    harness_id: HarnessId;
    observation: Inspection["observation"];
    loading: Inspection["loading"];
  }[] = [];
  for (const harness of targets) {
    const inspected = await deps.inspect(harness);
    if (!inspected.ok) return inspected;
    inspections.push({
      harness_id: harness,
      observation: inspected.value.observation,
      loading: inspected.value.loading,
    });
  }
  return ok({
    summary: `제품 ${inspections.length}개의 설치·loading 관측을 읽었다`,
    data: { inspections },
    next: ["loading이 unknown이면 `lophn doctor --target`으로 이유를 확인한다"],
  });
}

const VERB: Record<HarnessWriteName, string> = {
  "harness plan": "설치 계획",
  "harness install": "설치",
  "harness update": "갱신",
  "harness remove": "제거",
};

export async function runHarnessWrite(
  name: HarnessWriteName,
  input: {
    connection?: string;
    target: IntegrationTarget;
    components: readonly string[];
    operation_id?: string;
  },
  deps: Pick<HarnessRunDeps, "actor" | "write" | "connections">,
): Promise<Result<CommandOutput, LophnError>> {
  if (deps.actor !== "user") {
    return err({ code: "forbidden", message: "관리 쓰기는 사람 전용이다" });
  }
  if (catalogOf(input.target.harness_id) === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
  }
  if (input.connection === undefined) {
    return err({
      code: "invalid_input",
      message: "연결 참조(--connection)가 필요하다",
    });
  }
  const read = await deps.connections.read(input.connection);
  if (!read.ok) {
    return err(
      read.error.code === "not_found"
        ? { code: "not_found", message: "연결을 읽을 수 없다" }
        : read.error,
    );
  }
  if (read.value.state !== "active" && name !== "harness remove") {
    return ok({
      summary: `연결 ${input.connection}은 회수됐다. ${VERB[name]}하지 않았다`,
      data: { connection: input.connection, state: read.value.state },
      next: ["사람이 새 연결을 만든다. 회수된 연결은 되살리지 않는다"],
      isError: true,
    });
  }
  const done = await deps.write(name, {
    connection: input.connection,
    target: input.target,
    components: input.components,
    operationId: input.operation_id ?? `cli-${crypto.randomUUID()}`,
  });
  if (!done.ok) return done;
  const described = describeInstall(
    input.connection as Parameters<typeof describeInstall>[0],
    done.value,
  );
  if (name === "harness plan") {
    // 계획의 changed는 쓰게 될 것이다. 설치 결과로 읽히지 않게 이름을 바꾼다.
    return ok({
      summary: "설치 계획이다. 아무것도 쓰지 않았다",
      data: {
        planned: true,
        connection: input.connection,
        resources: done.value.resources,
        notices: done.value.notices,
      },
      next: [
        "`lophn harness install`로 같은 target·components를 설치한다. conflict는 사람이 먼저 확인한다",
      ],
    });
  }
  return ok(described);
}
