// 제품 catalog에서 설치 resource를 만든다(coding-agent/harnesses#R8·R11,
// guides#R5·R13). 순수 값이다. 설정 파일의 현재 text는
// 호출자가 읽어 인자로 주고(관측), 이 함수는 파일을 읽지도 쓰지도 않는다.
// 결과는 root resolver별 묶음이다. 한 target의 resource가 CODEX_HOME과 home처럼
// 다른 root에 걸치기 때문이고, 묶음마다 plan 하나로 설치한다(engine은 plan당
// root 하나).
import type { JsonValue } from "./adapters/json.ts";
import { BEGIN_MARKER, END_MARKER } from "./adapters/region.ts";
import type { McpLaunch } from "./launch.ts";
import { mcpEntryOf } from "./launch.ts";
import type { HarnessDefinition, HookSpec } from "./model.ts";
import { versionAtLeast } from "./resolvers.ts";
import type { PlannedResource } from "./integration/plan.ts";

export type BuildInput = {
  definition: HarnessDefinition;
  scope: "user" | "app";
  launch: McpLaunch;
  // 설치할 skill이다. 없으면 skill resource를 만들지 않는다.
  skill?: { name: string; files: readonly { path: string; content: string }[] };
  // 감지된 제품 version이다. 모르면 null이고 version-sensitive hook은 쓰지 않는다.
  version: string | null;
  // 설치 hook의 argv다. 없으면 hook을 만들지 않는다.
  hookArgv?: readonly string[];
  // 관측한 현재 text다. 파일이 없으면 null이다. key는 root 기준 상대 경로다.
  current: Readonly<Record<string, string | null>>;
};

export type RootGroup = {
  root_resolver: string;
  resources: PlannedResource[];
};

export type BuildOutput = {
  groups: RootGroup[];
  // 설치하지 않은 이유와 사람이 볼 안내다.
  notices: string[];
};

// hook command는 제품 설정에 shell 문자열 하나로 들어가므로 각 인자를 따옴표로
// 감싼다.
function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

// hook 소유 token이다. command 문자열에 들어 있어 소유 원소를 찾는 열쇠다.
export const HOOK_OWNER_TOKEN = "lophn-summary-hook";

function push(
  groups: RootGroup[],
  root: string,
  resource: PlannedResource,
): void {
  const group = groups.find((item) => item.root_resolver === root);
  if (group === undefined) {
    groups.push({ root_resolver: root, resources: [resource] });
  } else group.resources.push(resource);
}

function hookEntry(spec: HookSpec, argv: readonly string[]): JsonValue {
  const command = [...argv, "--owner", HOOK_OWNER_TOKEN].map(shellQuote)
    .join(" ");
  // Claude timeout은 초, Gemini는 ms다.
  const timeout = spec.timeout_unit === "ms" ? 5_000 : 5;
  return {
    ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
    hooks: [{ type: "command", command, timeout }],
  };
}

// 시작 summary hook의 설치 가능 여부다. 상태 수집(`status`) hook은 이 판정에 들지 않는다.
export function summaryHookSupported(definition: HarnessDefinition): boolean {
  return definition.hooks.some((spec) =>
    spec.purpose === "summary" && spec.capability === "supported"
  );
}

export function summaryGuideOf(definition: HarnessDefinition): string {
  return `${definition.label}은 시작 summary hook을 설치하지 않는다. 시작할 때 \`lophn session summary --app <앱>\`이나 MCP lophn_session summary로 명시해서 읽는다. summary 조회는 착수 지시가 아니다`;
}

export function buildResources(input: BuildInput): BuildOutput {
  const { definition, scope } = input;
  const groups: RootGroup[] = [];
  const notices: string[] = [];

  const config = definition.config_targets.find((entry) =>
    entry.scope_kind === scope
  );
  if (config === undefined) {
    notices.push(
      `${definition.label}은 ${scope} 범위 MCP 설정 파일을 만들지 않는다`,
    );
  } else {
    push(groups, config.root_resolver, {
      identity: `mcp:${scope}`,
      path: config.path,
      kind: "config",
      owned_key: config.owned_key,
      format: config.format,
      content: JSON.stringify(mcpEntryOf(definition.mcp_shape, input.launch)),
    });
  }

  const skillRoot = definition.skill_targets.find((entry) =>
    entry.scope_kind === scope
  );
  if (input.skill !== undefined && skillRoot !== undefined) {
    push(groups, skillRoot.root_resolver, {
      identity: `skill:${scope}:${input.skill.name}`,
      path: `${skillRoot.path}/${input.skill.name}`,
      kind: "skill",
      owned_key: null,
      format: "directory",
      content: input.skill.files,
    });
  }

  for (const instruction of definition.instructions) {
    if (instruction.mode === "region") {
      if (scope !== "app") continue;
      const text = input.current[instruction.file] ?? null;
      const begins = text?.includes(BEGIN_MARKER) === true &&
        text.includes(END_MARKER);
      if (!begins) {
        // 관리 marker 없는 파일은 무변경이고 새 파일은 별도 명시 plan이다.
        notices.push(
          `${instruction.file}에 lophn 관리 구간이 없어 건드리지 않는다`,
        );
        continue;
      }
      push(groups, "project", {
        identity: "instruction:region",
        path: instruction.file,
        kind: "instruction",
        owned_key: instruction.marker,
        format: "text",
        content: instruction.body ?? "",
      });
    } else if (instruction.mode === "json_member" && config !== undefined) {
      const text = input.current[config.path] ?? null;
      const member = instruction.member ?? "";
      const key = instruction.json_key ?? "";
      if (text !== null && listsMember(text, key, member)) {
        notices.push(`${key}에 ${member}가 이미 있어 그대로 둔다`);
        continue;
      }
      push(groups, config.root_resolver, {
        identity: `instruction:${scope}`,
        path: config.path,
        kind: "instruction",
        owned_key: `${key}#${member}`,
        format: "json",
        content: JSON.stringify(member),
      });
    }
    if (instruction.override_file !== undefined) {
      const found = input.current[instruction.override_file];
      if (found !== undefined && found !== null) {
        notices.push(
          `${instruction.override_file}가 ${instruction.file}보다 먼저 읽혀 안내를 가린다`,
        );
      }
    }
  }

  // 시작 summary hook은 검증한 제품(Claude Code)에만 있다. 다른 제품은 상태 수집 hook이 있어도 summary를
  // 받지 않으므로 명시 summary 조회를 안내한다.
  if (!summaryHookSupported(definition)) {
    notices.push(summaryGuideOf(definition));
  }

  for (const spec of definition.hooks) {
    if (spec.purpose !== "summary") continue;
    if (spec.target.scope_kind !== scope) continue;
    if (input.hookArgv === undefined) continue;
    if (spec.capability !== "supported") {
      notices.push(`${spec.event} hook은 검증되지 않아 설치하지 않는다`);
      continue;
    }
    if (
      input.version === null || spec.minimum_version === null ||
      !versionAtLeast(input.version, spec.minimum_version)
    ) {
      notices.push(
        `${spec.event} hook은 검증 version(${
          spec.minimum_version ?? "없음"
        }) 이상일 때만 설치한다`,
      );
      continue;
    }
    push(groups, spec.target.root_resolver, {
      identity: `hook:${spec.event}`,
      path: spec.target.path,
      kind: "hook",
      owned_key: `hooks.${spec.event}#${HOOK_OWNER_TOKEN}`,
      format: "json",
      content: JSON.stringify(hookEntry(spec, input.hookArgv)),
    });
  }
  return { groups, notices };
}

function listsMember(text: string, key: string, member: string): boolean {
  try {
    let cursor: unknown = JSON.parse(text);
    for (const segment of key.split(".")) {
      if (cursor === null || typeof cursor !== "object") return false;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor === member ||
      (Array.isArray(cursor) && cursor.includes(member));
  } catch {
    return false;
  }
}
