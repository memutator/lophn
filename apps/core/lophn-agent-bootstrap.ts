// 내장 assignment 준비(lophn-agent/assignments#R2). 새 데이터 root에는 거두지 않은 lophn과
// Context Engineer 전역 assignment가 각각 하나 있어야 한다. 만드는 command(제품 기본
// preset 등록, CreateBuiltinAssignment)는 machine 전용이고 부르는 자리가 core 기동뿐이라
// 여기서 한다. 이미 있으면 아무것도 보내지 않으므로 재시작은 중복을 만들지 않는다.
// 준비는 단계마다 다시 시작해도 이어진다: 기본 preset만 있고 assignment가 없으면 그
// preset으로 assignment를 만든다.
import {
  err,
  fingerprint,
  type IdSource,
  ok,
  type Result,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  assignmentList,
  createBuiltinAssignment,
  presetList,
  registerDefaultPreset,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ReadRoute,
} from "../../packages/contracts/platform/mod.ts";
import type { Writer } from "../../packages/platform/ledger/mod.ts";
import {
  BUILTIN_ROLES,
  type BuiltinRole,
  productPresetDefinition,
} from "../../packages/lophn-agent/presets/mod.ts";
import type { PreparedRelayResult } from "./blob-prepare.ts";

export const BOOTSTRAP_PRINCIPAL = "machine:lophn-agent-bootstrap";
export const PRESET_PROMPT_PURPOSE = "preset_prompt";

export type BootstrapDeps = {
  // 등록된 command 이름. lophn-agent 팀이 조립에 없으면 아무것도 하지 않는다.
  commands: ReadonlySet<string>;
  writer: Writer;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  // 역할 prompt 자산의 바이트(설치 bundle의 assets/roles/ 또는 소스의 roles/<역할>/prompt.md).
  asset(role: BuiltinRole): Promise<Result<Uint8Array>>;
  // blob 준비 통로. 없으면(I/O 감독이 없는 기동) 준비를 하지 못하므로 건너뛴다.
  prepare:
    | ((call: {
      principal: string;
      purpose: string;
      expectedHash: string;
      bytes: ReadableStream<Uint8Array>;
    }) => Promise<Result<PreparedRelayResult>>)
    | undefined;
  ids: IdSource;
};

const OPERATIONS = [
  registerDefaultPreset.name,
  createBuiltinAssignment.name,
  assignmentList.name,
  presetList.name,
];

function context(): AuthenticatedContext {
  return {
    principal: BOOTSTRAP_PRINCIPAL,
    actor: "machine",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: BOOTSTRAP_PRINCIPAL,
  };
}

function failed(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export async function bootstrapBuiltinAssignments(
  deps: BootstrapDeps,
): Promise<Result<void>> {
  if (
    !deps.commands.has(registerDefaultPreset.name) ||
    !deps.commands.has(createBuiltinAssignment.name) || deps.prepare === undefined
  ) return ok(undefined);
  const ctx = context();
  const recorded = await deps.record(ctx);
  if (!recorded.ok) return recorded;
  for (const role of BUILTIN_ROLES) {
    const done = await prepareRole(deps, ctx, role);
    if (!done.ok) return done;
  }
  return ok(undefined);
}

async function prepareRole(
  deps: BootstrapDeps,
  ctx: AuthenticatedContext,
  role: BuiltinRole,
): Promise<Result<void>> {
  const assignments = await deps.read(assignmentList, ctx, { role });
  if (!assignments.ok) return assignments;
  const existing = (assignments.value as { assignments?: unknown[] })
    .assignments;
  if (existing === undefined) return failed("assignment 목록을 읽지 못했다");
  if (existing.length > 0) return ok(undefined);
  const preset = await defaultPreset(deps, ctx, role);
  if (!preset.ok) return preset;
  const created = await deps.writer.command(ctx, {
    command: createBuiltinAssignment.name,
    input: {
      id: deps.ids.newId("asg"),
      preset: preset.value.id,
      preset_revision: preset.value.revision,
      role,
      scope: { kind: "all", id: null },
    },
    compare: {},
    idempotency_key: `bootstrap:assignment:${role}`,
    prepared: [],
  });
  return created.ok ? ok(undefined) : created;
}

// 그 역할의 제품 기본 preset. 없으면 prompt 자산을 blob으로 준비해 등록한다.
async function defaultPreset(
  deps: BootstrapDeps,
  ctx: AuthenticatedContext,
  role: BuiltinRole,
): Promise<Result<{ id: string; revision: number }>> {
  const listed = await deps.read(presetList, ctx, {
    kind: role,
    origin: "product",
  });
  if (!listed.ok) return listed;
  const presets = (listed.value as {
    presets?: { id: string; revision: number }[];
  }).presets;
  if (presets === undefined) return failed("preset 목록을 읽지 못했다");
  if (presets[0] !== undefined) {
    return ok({ id: presets[0].id, revision: presets[0].revision });
  }
  const asset = await deps.asset(role);
  if (!asset.ok) return asset;
  const prompt = await sha256Hex(asset.value);
  const prepared = await deps.prepare!({
    principal: ctx.principal,
    purpose: PRESET_PROMPT_PURPOSE,
    expectedHash: prompt,
    bytes: new ReadableStream({
      start(controller) {
        controller.enqueue(asset.value);
        controller.close();
      },
    }),
  });
  if (!prepared.ok) return prepared;
  const definition = productPresetDefinition(role, prompt);
  const id = deps.ids.newId("pst");
  const registered = await deps.writer.command(ctx, {
    command: registerDefaultPreset.name,
    input: {
      id,
      definition,
      definition_hash: await fingerprint(definition),
    },
    compare: {},
    idempotency_key: `bootstrap:preset:${role}`,
    prepared: [],
  });
  return registered.ok ? ok({ id, revision: 1 }) : registered;
}

// 소스 배치의 역할 prompt 자산이다. 설치 bundle의 assets/roles/ 배치는 설치 조립이 정한다.
const ROLE_DIRECTORY: Record<BuiltinRole, string> = {
  lophn: "lophn",
  context_engineer: "context-engineer",
};

export async function readRoleAsset(
  role: BuiltinRole,
): Promise<Result<Uint8Array>> {
  try {
    return ok(
      await Deno.readFile(
        new URL(
          `../../packages/lophn-agent/roles/${ROLE_DIRECTORY[role]}/prompt.md`,
          import.meta.url,
        ),
      ),
    );
  } catch {
    return failed("역할 prompt 자산을 읽지 못했다");
  }
}
