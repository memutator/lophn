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
import { remove } from "./integration/remove.ts";
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
  // 고른 component만 만든다(`mcp`·`skill`·`guide`·`hook`). 없으면 만들 수 있는 전부다.
  components?: readonly string[];
};

// component 이름이 가리키는 resource identity의 앞부분이다(builder).
const COMPONENT_PREFIX: Readonly<Record<string, string>> = {
  mcp: "mcp:",
  skill: "skill:",
  guide: "instruction:",
  hook: "hook:",
};

export const INSTALL_COMPONENTS = Object.keys(COMPONENT_PREFIX);

export type InstallAction = "install" | "update" | "remove";

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

// 설치 계획이다. 같은 흐름을 쓰되 파일·receipt·journal에는 쓰지 않고 메모리에만 겹쳐 쓴다.
// 결과의 `changed`는 실제로 쓰였다는 뜻이 아니라 쓰게 될 것이라는 뜻이다(harnesses#R9: 계획을
// 설치 결과로 표시하지 않는다).
function dryRunPorts(ports: InstallPorts): InstallPorts {
  const texts = new Map<string, string>();
  const trees = new Map<string, readonly { path: string; content: string }[]>();
  const files: FilePort = {
    ...ports.files,
    async read(path) {
      const text = texts.get(path);
      if (text !== undefined) return { kind: "file", text };
      if (trees.has(path)) return { kind: "directory" };
      return await ports.files.read(path);
    },
    async listFiles(dir) {
      const tree = trees.get(dir);
      if (tree !== undefined) {
        return {
          kind: "files",
          files: tree.map((file) => ({ path: file.path, text: file.content })),
        };
      }
      return await ports.files.listFiles(dir);
    },
    writeAtomic(path, text) {
      texts.set(path, text);
      return Promise.resolve(true);
    },
    writeTree(dir, tree) {
      trees.set(dir, tree);
      return Promise.resolve(true);
    },
    remove(path) {
      texts.delete(path);
      trees.delete(path);
      return Promise.resolve(true);
    },
  };
  const store: Store = {
    receipt: (target) => ports.store.receipt(target),
    saveReceipt: () => Promise.resolve(true),
    journal: () => ports.store.journal(),
    saveJournal: () => Promise.resolve(true),
  };
  return { files, store };
}

export async function installSelected(
  input: InstallInput,
  ports: InstallPorts,
): Promise<Result<InstallOutcome>> {
  return await runSelected(input, ports, "install");
}

// `harness plan`: 쓰지 않고 설치할 때의 resource별 결과를 미리 낸다.
export async function planSelected(
  input: InstallInput,
  ports: InstallPorts,
): Promise<Result<InstallOutcome>> {
  return await runSelected(input, dryRunPorts(ports), "install");
}

// `harness update`: receipt가 있는 target의 소유 resource만 새로 쓴다(R7). receipt 없는 target의
// 설치는 install이 한다.
export async function updateSelected(
  input: InstallInput,
  ports: InstallPorts,
): Promise<Result<InstallOutcome>> {
  if (await ports.store.receipt(input.target) === null) {
    return err({
      code: "not_found",
      message: "이 target의 설치 receipt가 없다. 설치는 install로 한다",
    });
  }
  return await runSelected(input, ports, "update");
}

// `harness remove`: receipt의 소유 resource만 지운다. 사람이 고친 것은 conflict로 남긴다(R7).
export async function removeSelected(
  input: InstallInput,
  ports: InstallPorts,
): Promise<Result<InstallOutcome>> {
  return await runSelected(input, ports, "remove");
}

async function runSelected(
  input: InstallInput,
  ports: InstallPorts,
  action: InstallAction,
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
  if (input.components !== undefined) {
    const prefixes = input.components.map((name) => COMPONENT_PREFIX[name]);
    if (prefixes.some((prefix) => prefix === undefined)) {
      return err({
        code: "invalid_input",
        message: `component는 ${INSTALL_COMPONENTS.join("·")}만 받는다`,
      });
    }
    for (const group of built.groups) {
      group.resources = group.resources.filter((resource) =>
        prefixes.some((prefix) => resource.identity.startsWith(prefix))
      );
    }
    built.groups = built.groups.filter((group) => group.resources.length > 0);
    for (const name of input.components) {
      const made = built.groups.some((group) =>
        group.resources.some((resource) =>
          resource.identity.startsWith(COMPONENT_PREFIX[name])
        )
      );
      if (!made) {
        notices.push(`${name}: 이 target에서 만들 resource가 없어 건너뛴다`);
      }
    }
  }
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
    if (action === "remove") {
      const removedGroup = await remove(
        ports.files,
        ports.store,
        root.value,
        plan.value,
        `${input.operationId}:${group.root_resolver}`,
        input.now,
      );
      resources.push(...removedGroup.resources);
      stored = stored && removedGroup.receipt_stored;
      recoveryPending = recoveryPending || removedGroup.recovery_pending;
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

// 고른 target 하나의 설치·갱신·제거가 쓸 수 있는 파일의 정확한 절대 경로다(CLI launcher의 쓰기 권한 계산,
// open-issues coding-agent/mcp-server#Q9). 설정 파일 하나와, 앱 범위의 관리 구간 지침 파일이다. CLI는
// 시작 summary hook(검증한 제품의 `summary` 목적 hook)의 설정 파일을 더하고 상태 수집 hook의 파일은 더하지
// 않는다. skill은 아직 설치하지 않는다.
// 폴더·와일드카드·다른 제품·다른 앱의 경로는 나오지 않는다. 절대 경로로 풀리지 않으면 err다.
export function selectedWriteFiles(
  target: IntegrationTarget,
  roots: RootInputs,
): Result<string[]> {
  const definition = catalogOf(target.harness_id);
  if (definition === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
  }
  if (target.environment.kind !== "host") {
    return err({
      code: "invalid_input",
      message: "지금은 native host만 설치한다",
    });
  }
  const scoped: RootInputs = target.scope_kind === "app"
    ? { ...roots, cwd: target.app_realpath }
    : roots;
  const files: string[] = [];
  const add = (resolver: string, path: string): Result<void> => {
    const root = rootOf(resolver, scoped);
    if (!root.ok) return root;
    const full = `${root.value}/${path}`;
    if (
      !full.startsWith("/") || full.split("/").includes("..") ||
      /[\0\n,]/.test(full)
    ) {
      return err({
        code: "invalid_input",
        message: "쓸 경로가 정확한 절대 경로가 아니다",
      });
    }
    if (!files.includes(full)) files.push(full);
    return ok(undefined);
  };
  const config = definition.config_targets.find((entry) =>
    entry.scope_kind === target.scope_kind
  );
  if (config !== undefined) {
    const added = add(config.root_resolver, config.path);
    if (!added.ok) return added;
  }
  if (target.scope_kind === "app") {
    for (const instruction of definition.instructions) {
      if (instruction.mode !== "region") continue;
      const added = add("project", instruction.file);
      if (!added.ok) return added;
    }
  }
  // 시작 summary hook의 설정 파일이다. 상태 수집 hook은 이 설치에 없어 그 파일은 더하지 않는다(guides#R25).
  for (const hook of definition.hooks) {
    if (
      hook.purpose !== "summary" || hook.capability !== "supported" ||
      hook.target.scope_kind !== target.scope_kind
    ) continue;
    const added = add(hook.target.root_resolver, hook.target.path);
    if (!added.ok) return added;
  }
  return ok(files);
}
