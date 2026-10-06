import { z } from "zod";
import {
  type Clock,
  fingerprint,
  type IdSource,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  assignmentRead,
  finishRun,
  presetRead,
  runRead,
  sessionRead,
  startRun,
  type WorkPlace,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { settingsGet } from "../../packages/contracts/platform/mod.ts";
import type { InstructionDeps } from "../../packages/lophn-agent/instructions/mod.ts";
import type { SkillEntry } from "../../packages/lophn-agent/extensions/mod.ts";
import { ROLE_CAPS } from "../../packages/lophn-agent/presets/mod.ts";
import {
  abortableWait,
  type AppOffer,
  computeAgentAppScope,
  resolveRunLimits,
  RUN_LIMIT_SETTING_KEYS,
  type RunContext,
  type Selection,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import type { ToolBinding } from "../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import {
  BUILTIN_TOOLS,
  listTools,
  runOperations,
  TOOL_BUNDLES,
  type ToolDefinition,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import { createCorePorts, type RunSeat } from "./core-ports.ts";
import type { ModelBinding } from "./model-binding.ts";
import type { DriveDeps, PreparedRun } from "./run-driver.ts";

// 선택한 run을 시작하기 전의 재료를 core 기록에서 모은다(lophn-agent/harness/run-loop). assignment와
// preset 판, 역할 상한과 preset이 고른 tool 목록, 적용 한도, StartRun이 확정할 AgentAppScope, 고정할
// run 근거(basis)를 만든다. model 선택의 검증(catalog·credential)과 tool의 소유 계약 연결은 주입한다.

export type Toolkit = {
  // 내장 tool 정의의 출처. 없으면 제품 내장 전부다.
  definitions?: readonly ToolDefinition[];
  // 호출의 소유 계약 연결. 읽기 tool은 기본 연결을 쓰고 쓰기·external은 여기서 낸다.
  binding(definition: ToolDefinition): ToolBinding | undefined;
  // 이 run의 agent 자격으로 소유 계약을 부르는 handler.
  handlers(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler>;
  // 현재 run이 닿을 수 있는 대상 ID(assignment 담당 범위).
  targets?(
    assignment: { scope: { kind: string; id: string | null } },
  ): string[];
  server?(definition: ToolDefinition): string | null;
  mcpConnection?(definition: ToolDefinition): { revision: number } | undefined;
};

export type PreparerDeps = {
  clock: Clock;
  ids: IdSource;
  // machine 자격의 loopback.
  machine: CoreCall;
  // run의 agent credential token으로 부르는 loopback.
  agentCall(token: string): CoreCall;
  // preset의 선택을 검증해 model 묶음으로 만든다(catalog·계정·adapter).
  resolveModel(input: {
    preset: { id: string; revision: number };
    definition: unknown;
  }): Promise<Result<ModelBinding>>;
  toolkit: Toolkit;
  // 앱 command 선언과 사람 허락. 없으면 앱 command 없는 scope다.
  offers?(assignment: { id: string }): Promise<readonly AppOffer[]>;
  product: string;
  rolePrompt(role: string): Promise<Result<string>>;
  instructions: InstructionDeps;
  skills?(): Promise<readonly SkillEntry[]>;
  timezone?(): string | null;
  redact?: (text: string) => string | null;
  approvalTtlMs?: number;
  reservedOutput?: number;
};

// 읽기 tool의 기본 연결이다. 읽기는 대상 변경이 없어 소유 계약의 이름만 있으면 된다.
export function readBinding(definition: ToolDefinition): ToolBinding {
  return {
    resolve: () =>
      ok({
        concern: definition.contract,
        operation: definition.contract,
        contractRevision: definition.revision,
        targets: [],
        comparison: {},
        changes: "reads only",
        external: null,
        reversibility: "nothing changes",
      }),
  };
}

function placeOf(
  scope: { kind: string; id: string | null },
): WorkPlace {
  return (scope.kind === "all"
    ? { kind: "global", id: null }
    : { kind: scope.kind, id: scope.id }) as WorkPlace;
}

export function createRunPreparer(
  deps: PreparerDeps,
): Pick<DriveDeps, "prepare" | "closeUnusable"> {
  const { machine, clock, ids } = deps;

  async function prepare(
    selection: Selection,
  ): Promise<Result<PreparedRun>> {
    const run = await readOf(machine, runRead, { run: selection.run });
    if (!run.ok) return run;
    const assigned = await readOf(machine, assignmentRead, {
      assignment: selection.assignment,
    });
    if (!assigned.ok) return assigned;
    const assignment = assigned.value.assignment;
    const read = await readOf(machine, presetRead, {
      preset: assignment.preset,
      revision: assignment.preset_revision,
    });
    if (!read.ok) return read;
    const preset = read.value.preset;
    const definition = preset.definition;

    // 역할 상한 ∩ preset 선택이 이번 run이 제공하는 tool 목록이다.
    const roleTools = ROLE_CAPS.get(assignment.role)?.tools ?? null;
    const presetTools = [
      ...definition.capability.bundles.flatMap((bundle) =>
        TOOL_BUNDLES.get(bundle.name) ?? []
      ),
      ...definition.capability.tools.map((tool) => tool.tool),
    ];
    const listed = listTools(
      {
        builtin: deps.toolkit.definitions ?? BUILTIN_TOOLS,
        app: [],
        external: [],
      },
      { presetTools, roleTools },
    );

    const settings = await readOf(machine, settingsGet, {
      keys: Object.values(RUN_LIMIT_SETTING_KEYS),
    });
    if (!settings.ok) return settings;
    const limits = resolveRunLimits(settings.value.settings);
    if (!limits.ok) return limits;

    const offers = deps.offers === undefined
      ? []
      : await deps.offers(assignment);
    const scope = computeAgentAppScope({
      role: assignment.role,
      assignment: assignment.id,
      work: assignment.scope,
      read_apps: assignment.read_apps,
      read_commands: assignment.read_commands,
      offers,
    });
    if (!scope.ok) return scope;

    const model = await deps.resolveModel({
      preset: { id: preset.id, revision: preset.revision },
      definition,
    });
    if (!model.ok) return model;

    let place: WorkPlace = placeOf(assignment.scope);
    if (run.value.run.session !== null) {
      const session = await readOf(machine, sessionRead, {
        session: run.value.run.session,
      });
      if (session.ok) place = session.value.session.work_place as WorkPlace;
    }

    const basis = await fingerprint({
      preset: {
        id: preset.id,
        revision: preset.revision,
        snapshot_hash: preset.definition_hash,
        basis_seq: run.value.as_of_seq,
      },
      assignment: {
        id: assignment.id,
        revision: assignment.revision,
        snapshot_hash: await fingerprint(assignment),
        basis_seq: run.value.as_of_seq,
      },
      tools: {
        revision: "1",
        definitions_hash: await fingerprint(
          listed.map((tool) => [tool.name, tool.revision]),
        ),
      },
      models: { judgment: model.value.call, organizing: model.value.call },
      initial_work_place: place,
      limits: limits.value,
    });
    const seat: RunSeat = {
      run: selection.run,
      assignment: selection.assignment,
      session: run.value.run.session,
    };
    const toolkit = deps.toolkit;
    const bindings = new Map<string, ToolBinding>();
    for (const tool of listed) {
      const bound = toolkit.binding(tool) ??
        (tool.effect === "read" ? readBinding(tool) : undefined);
      if (bound !== undefined) bindings.set(tool.name, bound);
    }

    return ok({
      begin: {
        run: selection.run,
        assignment: selection.assignment,
        stateSeq: selection.stateSeq,
        basis,
        limits: limits.value,
        scope: scope.value,
      },
      async startRun(input) {
        const started = await commandOf(
          machine,
          startRun,
          {
            run: input.run,
            basis: input.basis,
            limits: input.limits,
            scope: input.scope,
          },
          { state_seq: input.stateSeq },
          `${input.run}:start`,
        );
        return started.ok
          ? ok({
            run: started.value.id,
            state_seq: started.value.state_seq,
            basis: started.value.basis,
          })
          : started;
      },
      loop(credential) {
        const agent = deps.agentCall(credential.token);
        const context = async (): Promise<Result<RunContext>> => {
          const role = await deps.rolePrompt(assignment.role);
          if (!role.ok) return role;
          return ok({
            product: { instructions: deps.product },
            role: { instructions: role.value, preset_prompt: null },
            tools: listed.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: z.toJSONSchema(tool.input),
            })),
            work: {
              role: assignment.role,
              session: place,
              scope: assignment.scope,
            },
            attachments: definition.instructions,
            purpose: null,
            run_facts: null,
            continuation_summary: null,
            sources: [],
            skills: (await deps.skills?.()) ?? [],
            timezone: deps.timezone?.() ?? null,
            limits: {
              context_limit: model.value.call.limits.context_limit,
              input_limit: model.value.call.limits.input_limit,
              output_limit: model.value.call.limits.output_limit,
            },
            reserved_output: Math.min(
              deps.reservedOutput ?? 8000,
              model.value.call.limits.output_limit,
            ),
          });
        };
        const ported = createCorePorts({
          seat,
          clock,
          ids,
          machine,
          agent,
          model: model.value,
          tools: {
            listed,
            bindings,
            handlers: toolkit.handlers(seat, agent),
            credential: {
              run: seat.run,
              targets: new Set(toolkit.targets?.(assignment) ?? []),
              operations: new Set(runOperations(listed)),
            },
            mcpConnection: toolkit.mcpConnection ?? (() => undefined),
            ...(toolkit.server === undefined ? {} : { server: toolkit.server }),
            approvalTtlMs: deps.approvalTtlMs ?? 600_000,
          },
          context,
        });
        return {
          deps: {
            clock,
            wait: abortableWait,
            random: Math.random,
            instructions: deps.instructions,
            ports: ported.ports,
          },
          input: {
            run: seat.run,
            session: seat.session,
            limits: limits.value,
            elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
            attempts: 0,
          },
        };
      },
    });
  }

  return {
    prepare,
    // StartRun은 확정됐지만 credential을 받지 못한 run은 설정 불가로 끝낸다.
    async closeUnusable(selection) {
      const run = await readOf(machine, runRead, { run: selection.run });
      if (!run.ok) return;
      await commandOf(
        machine,
        finishRun,
        {
          run: selection.run,
          outcome: { kind: "failed", reason: "configuration_unavailable" },
          result: await fingerprint({ run: selection.run, why: "credential" }),
        },
        { state_seq: run.value.run.state_seq },
        `${selection.run}:finish:credential`,
      );
    },
  };
}
