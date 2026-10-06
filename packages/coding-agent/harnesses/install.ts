// 사람이 고른 target 하나의 설치 흐름이다(coding-agent/harnesses#R6, R8, R9, connection#R12,
// cli#R40). catalog에서 resource를 만들고(builder), root별 plan을 세워(plan), hash를 관측한 뒤
// receipt와 함께 쓴다(apply). 고른 target 하나만 바꾸고 다른 제품·profile은 읽지도 쓰지도 않는다.
// 설치 결과는 resource별 변경·무변경·건너뜀·충돌·실패이고 일부 실패를 전체 성공으로 표시하지
// 않는다. 설치 실패는 이미 발급한 credential의 재발급·회수를 하지 않는다(connection#R12): 이
// module은 credential을 모른다. 설정에는 connection 참조만 쓴다.
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  IntegrationTarget,
  ResourceInstallResult,
} from "../../contracts/coding-agent/mod.ts";
import { buildResources } from "./builder.ts";
import { catalogOf } from "./catalog/definitions.ts";
import { environmentSupported } from "./detection.ts";
import {
  type FilePort,
  install,
  observe,
  result as resultOf,
  type Store,
} from "./integration/apply.ts";
import { planOf } from "./integration/plan.ts";
import type { McpLaunch } from "./launch.ts";
import { type RootInputs, rootOf } from "./resolvers.ts";

export type InstallPorts = {
  files: FilePort;
  store: Store;
};

export type InstallInput = {
  target: IntegrationTarget;
  // 사람이 고른 connection 참조다. token 원문은 없다.
  connection: string;
  launch: McpLaunch;
  // 설치할 skill이다. 없으면 skill resource를 만들지 않는다(skill 본문은 guides가 낸다).
  skill?: {
    name: string;
    files: readonly { path: string; content: string }[];
  };
  // 감지한 제품 version이다. 모르면 null이고 version-sensitive hook은 쓰지 않는다.
  version: string | null;
  hookArgv?: readonly string[];
  roots: RootInputs;
  operationId: string;
  now: string;
};

export type InstallOutcome = {
  // resource별 결과다.
  resources: ResourceInstallResult[];
  notices: string[];
  // 모든 resource가 변경·무변경이고 receipt가 보관됐을 때만 complete다. 일부 실패는 partial이고
  // 아무것도 쓰지 못했으면 failed다.
  status: "complete" | "partial" | "failed";
  receipt_stored: boolean;
  recovery_pending: boolean;
};

// builder가 보는 현재 text다. 설정 파일·관리 구간 지침·덮는 파일만 읽는다. 없으면 null이다.
async function currentTexts(
  files: FilePort,
  target: IntegrationTarget,
  roots: RootInputs,
  definition: NonNullable<ReturnType<typeof catalogOf>>,
): Promise<Record<string, string | null>> {
  const current: Record<string, string | null> = {};
  async function load(resolver: string, path: string): Promise<void> {
    const root = rootOf(resolver, roots);
    if (!root.ok) return;
    const read = await files.read(`${root.value}/${path}`);
    current[path] = read.kind === "file" ? read.text : null;
  }
  const scope = target.scope_kind;
  const config = definition.config_targets.find((entry) =>
    entry.scope_kind === scope
  );
  if (config !== undefined) await load(config.root_resolver, config.path);
  for (const instruction of definition.instructions) {
    if (instruction.mode === "region") {
      await load("project", instruction.file);
    }
    if (instruction.override_file !== undefined) {
      await load("project", instruction.override_file);
    }
  }
  return current;
}

export async function installSelected(
  input: InstallInput,
  ports: InstallPorts,
): Promise<Result<InstallOutcome>> {
  const definition = catalogOf(input.target.harness_id);
  if (definition === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
  }
  const supported = environmentSupported(definition, input.target.environment);
  if (!supported.ok) return supported;
  // 앱 범위 target의 project root는 고른 앱의 실제 폴더다. cwd나 다른 앱 폴더가 아니다.
  const roots: RootInputs = input.target.scope_kind === "app"
    ? { ...input.roots, cwd: input.target.app_realpath }
    : input.roots;
  const scope = input.target.scope_kind;
  const resources: ResourceInstallResult[] = [];
  const notices: string[] = [];
  let stored = true;
  let recoveryPending = false;
  const built = buildResources({
    definition,
    scope,
    launch: input.launch,
    version: input.version,
    hookArgv: input.hookArgv,
    current: await currentTexts(ports.files, input.target, roots, definition),
    ...(input.skill === undefined ? {} : { skill: input.skill }),
  });
  notices.push(...built.notices);
  if (built.groups.length === 0) {
    return ok({
      resources,
      notices,
      status: "failed",
      receipt_stored: false,
      recovery_pending: false,
    });
  }
  for (const group of built.groups) {
    const root = rootOf(group.root_resolver, roots);
    if (!root.ok) {
      for (const resource of group.resources) {
        resources.push(
          resultOf(resource.identity, "failed", false, "root를 정할 수 없다"),
        );
      }
      stored = false;
      continue;
    }
    const plan = planOf({
      definition,
      target: input.target,
      connection: input.connection,
      resources: group.resources,
    });
    if (!plan.ok) {
      for (const resource of group.resources) {
        resources.push(
          resultOf(resource.identity, "failed", false, plan.error.detail),
        );
      }
      stored = false;
      continue;
    }
    const seen = await observe(ports.files, root.value, plan.value);
    if (seen === "blocked") {
      for (const resource of group.resources) {
        resources.push(
          resultOf(
            resource.identity,
            "skipped",
            false,
            "symlink·root 밖 경로·읽기 실패라 건드리지 않는다",
          ),
        );
      }
      stored = false;
      continue;
    }
    const applied = await install(
      ports.files,
      ports.store,
      root.value,
      plan.value,
      seen,
      `${input.operationId}:${group.root_resolver}`,
      input.now,
    );
    resources.push(...applied.resources);
    stored = stored && applied.receipt_stored;
    recoveryPending = recoveryPending || applied.recovery_pending;
  }
  const clean = resources.length > 0 &&
    resources.every((item) =>
      item.outcome === "changed" || item.outcome === "unchanged"
    );
  const wrote = resources.some((item) =>
    item.outcome === "changed" || item.outcome === "unchanged"
  );
  return ok({
    resources,
    notices,
    status: clean && stored && !recoveryPending
      ? "complete"
      : wrote
      ? "partial"
      : "failed",
    receipt_stored: stored,
    recovery_pending: recoveryPending,
  });
}
