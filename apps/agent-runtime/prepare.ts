import { z } from "zod";
import {
  canonicalize,
  type Clock,
  err,
  fingerprint,
  type IdSource,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  assignmentRead,
  finishRun,
  presetRead,
  RUN_BLOB_PURPOSES,
  runBody,
  runList,
  runRead,
  sessionRead,
  startRun,
  type WorkPlace,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  createApprovalRequest,
  settingsGet,
} from "../../packages/contracts/platform/mod.ts";
import type { InstructionDeps } from "../../packages/lophn-agent/instructions/mod.ts";
import type { SkillEntry } from "../../packages/lophn-agent/extensions/mod.ts";
import { ROLE_CAPS } from "../../packages/lophn-agent/presets/mod.ts";
import {
  abortableWait,
  type AgentRunCredential,
  type AppOffer,
  computeAgentAppScope,
  type LoopDeps,
  resolveRunLimits,
  RUN_LIMIT_SETTING_KEYS,
  type RunContext,
  type RunCredentials,
  type Selection,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  createWaitResolver,
  recoverRunFromLedger,
  type ToolLookup,
} from "../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import type { ToolBinding } from "../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import {
  BUILTIN_TOOLS,
  listTools,
  runOperations,
  TOOL_BUNDLES,
  type ToolDefinition,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import type { AppTool } from "../../packages/lophn-agent/harness/tools/mod.ts";
import type { AppToolkit } from "./app-toolkit.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import { contextMaterials } from "./context-materials.ts";
import { createCorePorts, type RunSeat } from "./core-ports.ts";
import type { ModelBinding } from "./model-binding.ts";
import { type BlobPort, type RedactText, storeValue } from "./run-blobs.ts";
import type { DriveDeps, PreparedResume, PreparedRun } from "./run-driver.ts";
import {
  buildMcpTools,
  createMcpToolHandlers,
  EXTERNAL_TOOL_CONCERN,
  type ExternalTool,
  type McpSelection,
  type McpToolCall,
  type McpToolsSource,
} from "../../packages/lophn-agent/extensions/mod.ts";

// 선택한 run을 시작하기 전의 재료를 core 기록에서 모은다(lophn-agent/harness/run-loop). assignment와
// preset 판, 역할 상한과 preset이 고른 tool 목록, 적용 한도, StartRun이 확정할 AgentAppScope, 고정할
// run 근거(basis)를 만든다. model 선택의 검증(catalog·credential)과 tool의 소유 계약 연결은 주입한다.

// 이 run의 외부 MCP tool 등록이다(Q16, T37). 등록 화면은 현재 서버 설정과 연결 화면을 읽어
// buildMcpTools로 정의를 만들고, Q16 재조회가 끝날 때까지 그 server tool 호출을 막는다.
export type McpToolkit = {
  // 등록된 서버 설정과 검증을 지난 tool 목록을 읽는다. 설정은 사람의 registry 출처(R11)다.
  source(assignment: string): Promise<Result<McpToolsSource>>;
  // preset 판의 MCP 선택(서버+현재 tool 정확한 쌍, R31)과 safe 표시를 골라낸다.
  selection(definition: unknown): McpSelection | null;
  // 도구 호출 통로다(Q16 재조회가 끝날 때까지 호출은 거절된다).
  call(assignment: string): McpToolCall;
  // 서버의 연결 설정 판이다(판정 근거 mcp_configuration_revision).
  connectionRevision(
    definition: ToolDefinition,
    assignment: string,
  ): { revision: number } | undefined;
};

export type Toolkit = {
  // 내장 tool 정의의 출처. 없으면 제품 내장 전부다.
  definitions?: readonly ToolDefinition[];
  // 호출의 소유 계약 연결. 읽기 tool은 기본 연결을 쓰고 쓰기·external은 여기서 낸다. run은 이 run의
  // agent 자격과 자리, 확인을 마친 대상을 올리는 범위다.
  binding(
    definition: ToolDefinition,
    run?: { agent: CoreCall; seat: RunSeat; reach: Set<string> },
  ): ToolBinding | undefined;
  // 이 run의 agent 자격으로 소유 계약을 부르는 handler.
  handlers(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler>;
  // 현재 run이 닿을 수 있는 대상 ID(assignment 담당 범위).
  targets?(
    assignment: { scope: { kind: string; id: string | null } },
  ): string[];
  // 외부 MCP tool 등록이다. 없으면 external 정의가 없다.
  mcp?(assignment: string): McpToolkit | undefined;
  // 결과를 모르는 쓰기·external의 저장된 결과를 소유 계약에서 조회한다(tool 이름 → 조회). 없는 tool은
  // 결과를 확인할 수 없는 것으로 다룬다.
  lookups?(seat: RunSeat, agent: CoreCall): ReadonlyMap<string, ToolLookup>;
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
  // 앱 command의 자동 tool(선언·허락 읽기, 판정 근거, 호출, 결과 조회). 있으면 `offers`를 대신한다.
  apps?: AppToolkit;
  product: string;
  rolePrompt(role: string): Promise<Result<string>>;
  instructions: InstructionDeps;
  // run 근거·결과와 model·tool 기록의 본문을 blob으로 먼저 저장하는 통로.
  blobs: BlobPort;
  skills?(): Promise<readonly SkillEntry[]>;
  timezone?(): string | null;
  redact?: RedactText;
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

// 외부 MCP tool의 연결이다. 대상은 고른 쌍 하나이고 판정이 그 쌍으로 범위와 되돌림을 본다.
// 분류가 안 됐거나 쓰기·external이면 판정표가 묻는다(R26, R28). 입력 비교 기준은 없다.
function externalBinding(tool: ExternalTool): ToolBinding {
  return {
    resolve: () =>
      ok({
        concern: EXTERNAL_TOOL_CONCERN,
        operation: tool.definition.contract,
        contractRevision: tool.definition.revision,
        targets: [{
          id: tool.target,
          reversibility: tool.reversible
            ? "reversible" as const
            : "unknown" as const,
        }],
        comparison: {},
        changes: tool.effect === "read"
          ? "reads only"
          : `calls tool ${tool.original} of server ${tool.server}`,
        external: tool.effect === "read" ? null : `MCP server ${tool.server}`,
        reversibility: tool.reversible ? "reversible" : "not guaranteed",
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

type RunRecord = z.output<typeof runRead.output>["run"];
type AssignmentRecord = z.output<typeof assignmentRead.output>["assignment"];

export type PreparerResult =
  & Pick<
    DriveDeps,
    "prepare" | "closeUnusable" | "liveRuns"
  >
  & {
    // 재시작·사람의 결정 뒤 같은 run을 잇는 재료(lophn-agent/harness/waiting-and-recovery).
    prepareResume(
      run: string,
      credentials: RunCredentials,
    ): Promise<Result<PreparedResume>>;
  };

// 앱 command tool의 원래 호출 계약이다(tool_calls.app_command). revert_command가 있으면 기록이 앱의 선언된
// revert command를 revert에 싣는다(lophn-agent#T48, R10).
export function appCommandOf(app: AppTool) {
  return {
    app: app.app,
    release: app.release,
    command: app.command,
    blueprint_hash: app.blueprintHash,
    definition_hash: app.definitionHash,
    permission_basis: app.permissionBasis,
    context_binding: null,
    ...(app.revertCommand === null
      ? {}
      : { revert_command: app.revertCommand }),
  };
}

export function createRunPreparer(deps: PreparerDeps): PreparerResult {
  const { machine, clock, ids } = deps;

  // run과 assignment, 고른 preset 판으로 이번 run의 tool·scope·model을 모은다.
  async function material(
    run: RunRecord,
    assignment: AssignmentRecord,
    pinned: { id: string; revision: number },
  ) {
    const read = await readOf(machine, presetRead, {
      preset: pinned.id,
      revision: pinned.revision,
    });
    if (!read.ok) return read;
    const preset = read.value.preset;
    const definition = preset.definition;

    // 역할 상한 ∩ preset 선택이 이번 run이 제공하는 tool 목록이다. 외부 MCP tool은
    // 상한 항목이 아니라 preset의 선택 항목이라(presets role-caps R5) 정의 이름을
    // 양쪽 이름 목록에 더한다. 그렇지 않으면 목록 이름 검사가 모두 떨어뜨린다.
    const roleTools = ROLE_CAPS.get(assignment.role)?.tools ?? null;
    const presetTools = [
      ...definition.capability.bundles.flatMap((bundle) =>
        TOOL_BUNDLES.get(bundle.name) ?? []
      ),
      ...definition.capability.tools.map((tool) => tool.tool),
    ];

    // 앱 command의 선언과 사람의 허락. 읽지 못하면 앱 command 없는 scope다(fail closed).
    const loaded = deps.apps === undefined ? undefined : await deps.apps.load();
    const offers = loaded !== undefined
      ? (loaded.ok ? loaded.value.offers : [])
      : deps.offers === undefined
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

    // 앱 command 정의는 역할·현재 허락·assignment(AgentAppScope)의 교집합만이다.
    const appTools: readonly AppTool[] = deps.apps === undefined ||
        loaded === undefined || !loaded.ok
      ? []
      : await deps.apps.define(scope.value, loaded.value);

    // 외부 MCP tool 등록이다(T37). 사람의 registry(mcp_servers 설정)와 preset 선택만이 출처이며,
    // 목록을 다시 읽지 못하면 그 server tool 정의가 없는 것과 같다(Q16: 재조회 실패는 옛 정의를
    // 호출 가능으로 두지 않는다).
    const mcpKit = deps.toolkit.mcp?.(assignment.id);
    let external: readonly ExternalTool[] = [];
    if (mcpKit !== undefined) {
      const source = await mcpKit.source(assignment.id);
      // 설정을 읽지 못하면 서버 자체가 없는 것과 같은 답이다(R11: fails closed).
      if (source.ok) {
        const selection = mcpKit.selection(definition);
        // 선택이 아직 고정되지 않았으면 제공도 없다(R31).
        if (selection !== null) {
          const built = await buildMcpTools(source.value, selection);
          // 남은 충돌은 등록을 거절한다(R23). 그 server의 정의가 전부 빠진다.
          if (built.ok) external = built.value;
        }
      }
    }

    const listed = listTools(
      {
        builtin: deps.toolkit.definitions ?? BUILTIN_TOOLS,
        app: appTools.map((tool) => tool.definition),
        external: external.map((tool) => tool.definition),
      },
      {
        presetTools: external.length === 0
          ? presetTools
          : [...presetTools, ...external.map((tool) => tool.definition.name)],
        roleTools: roleTools === null || external.length === 0 ? roleTools : [
          ...roleTools,
          ...external.map((tool) => tool.definition.name),
        ],
      },
    );

    const model = await deps.resolveModel({
      preset: { id: preset.id, revision: preset.revision },
      definition,
    });
    if (!model.ok) return model;

    let place: WorkPlace = placeOf(assignment.scope);
    if (run.session !== null) {
      const session = await readOf(machine, sessionRead, {
        session: run.session,
      });
      if (session.ok) place = session.value.session.work_place as WorkPlace;
    }
    const seat: RunSeat = {
      run: run.id,
      assignment: assignment.id,
      session: run.session,
    };
    return ok({
      preset,
      definition,
      listed,
      appTools,
      external,
      scope: scope.value,
      model: model.value,
      place,
      seat,
      mcpKit,
    });
  }

  type Material = Extract<
    Awaited<ReturnType<typeof material>>,
    { ok: true }
  >["value"];

  // 이 run의 loop deps와 core port. agent 호출은 credential token을 받은 뒤에 열린다.
  function loopFor(
    m: Material,
    assignment: AssignmentRecord,
    agent: CoreCall,
  ) {
    const { seat, listed, model, definition, place, external } = m;
    const toolkit = deps.toolkit;
    const externalByName = new Map(
      external.map((tool) => [tool.definition.name, tool]),
    );
    const bindings = new Map<string, ToolBinding>();
    // 이 run이 닿는 대상 ID다. 앱 command의 대상은 AgentAppScope에 든 앱이고, 쓰기 tool의 연결이 확인을
    // 마친 대상을 더한다. run과 assignment는 호출하는 자기 자신이다.
    const reach = new Set<string>([
      ...(toolkit.targets?.(assignment) ?? []),
      ...m.scope.apps.map((entry) => entry.app),
      ...external.map((tool) => tool.target),
      seat.run,
      assignment.id,
    ]);
    const appByName = new Map(
      m.appTools.map((tool) => [tool.definition.name, tool]),
    );
    for (const tool of listed) {
      const app = appByName.get(tool.name);
      if (app !== undefined && deps.apps !== undefined) {
        bindings.set(tool.name, deps.apps.binding(app, agent));
        continue;
      }
      const bound = toolkit.binding(tool, { agent, seat, reach }) ??
        (tool.effect === "read" ? readBinding(tool) : undefined);
      if (bound !== undefined) bindings.set(tool.name, bound);
    }
    // 외부 MCP tool의 소유 계약 연결이다. 스코프 검사는 builder가 이미 정확한 쌍만 골랐다.
    for (const tool of external) {
      bindings.set(tool.definition.name, externalBinding(tool));
    }
    const context = async (): Promise<Result<RunContext>> => {
      const role = await deps.rolePrompt(assignment.role);
      if (!role.ok) return role;
      return ok({
        product: { instructions: deps.product },
        role: { instructions: role.value, preset_prompt: null },
        tools: listed.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema ?? z.toJSONSchema(tool.input),
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
        sources: await contextMaterials(agent, definition.context),
        skills: (await deps.skills?.()) ?? [],
        timezone: deps.timezone?.() ?? null,
        limits: {
          context_limit: model.call.limits.context_limit,
          input_limit: model.call.limits.input_limit,
          output_limit: model.call.limits.output_limit,
        },
        reserved_output: Math.min(
          deps.reservedOutput ?? 8000,
          model.call.limits.output_limit,
        ),
      });
    };
    const ported = createCorePorts({
      seat,
      clock,
      ids,
      machine,
      agent,
      blobs: deps.blobs,
      redact: deps.instructions.redact,
      model,
      tools: {
        listed,
        bindings,
        handlers: new Map([
          ...toolkit.handlers(seat, agent),
          ...(deps.apps?.handlers(m.appTools, agent) ?? []),
          ...(m.mcpKit === undefined ? [] : createMcpToolHandlers(
            external,
            m.mcpKit.call(assignment.id),
          )),
        ]),
        credential: {
          run: seat.run,
          targets: reach,
          operations: new Set([
            ...runOperations(listed),
            // ask는 이 run의 자격으로 approval request를 만든다(R28). 쓰기·external tool이 하나라도
            // 있으면 내장·앱·외부 어느 길이든 물을 수 있다.
            ...(external.length > 0 ||
                listed.some((tool) => tool.effect !== "read")
              ? [createApprovalRequest.name]
              : []),
          ]),
        },
        mcpConnection: (toolDefinition) =>
          m.mcpKit?.connectionRevision(toolDefinition, assignment.id),
        server: (toolDefinition) =>
          externalByName.get(toolDefinition.name)?.server ?? null,
        extension: (toolDefinition) => {
          const found = externalByName.get(toolDefinition.name);
          return found === undefined ? null : {
            server_name: found.server,
            configuration_revision: found.configurationRevision,
            original_tool: found.original,
            canonical_name: found.definition.name,
          };
        },
        // 앱 command tool의 원래 호출 계약이다. 기록이 tool_calls.app_command로 묶는다(R10).
        // revert_command가 있으면 기록이 앱의 선언된 revert command를 revert에 싣는다.
        appCommand: (definition) => {
          const app = appByName.get(definition.name);
          return app === undefined ? undefined : appCommandOf(app);
        },
        approvalTtlMs: deps.approvalTtlMs ?? 600_000,
      },
      context,
    });
    const resolver = createWaitResolver({
      machine,
      judgment: ported.judgment,
      callRequest: ported.callRequest,
    });
    const loopDeps: LoopDeps = {
      clock,
      wait: abortableWait,
      random: Math.random,
      instructions: deps.instructions,
      ports: ported.ports,
    };
    return { ported, resolver, loopDeps };
  }

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

    const settings = await readOf(machine, settingsGet, {
      keys: Object.values(RUN_LIMIT_SETTING_KEYS),
    });
    if (!settings.ok) return settings;
    const limits = resolveRunLimits(settings.value.settings);
    if (!limits.ok) return limits;

    const found = await material(run.value.run, assignment, {
      id: assignment.preset,
      revision: assignment.preset_revision,
    });
    if (!found.ok) return found;
    const { preset, listed, scope, model, place } = found.value;

    // run 근거는 영구 참조다. 저장한 바이트의 hash로 StartRun에 싣는다.
    const basis = await storeValue(
      deps.blobs,
      deps.instructions.redact,
      RUN_BLOB_PURPOSES.run_basis,
      {
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
        models: { judgment: model.call, organizing: model.call },
        initial_work_place: place,
        limits: limits.value,
      },
    );
    if (!basis.ok) return basis;

    return ok({
      begin: {
        run: selection.run,
        assignment: selection.assignment,
        stateSeq: selection.stateSeq,
        basis: basis.value.hash,
        basisSize: basis.value.size,
        limits: limits.value,
        scope,
      },
      async startRun(input) {
        const started = await commandOf(
          machine,
          startRun,
          {
            run: input.run,
            basis: input.basis,
            ...(input.basisSize === undefined
              ? {}
              : { basis_size: input.basisSize }),
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
        const built = loopFor(
          found.value,
          assignment,
          deps.agentCall(credential.token),
        );
        return {
          settle: () => built.resolver.settle(selection.run),
          deps: built.loopDeps,
          input: {
            run: selection.run,
            session: found.value.seat.session,
            limits: limits.value,
            elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
            attempts: 0,
          },
        };
      },
    });
  }

  // 시작한 run을 저장된 경계에서 잇는 재료다. preset은 run basis가 고정한 판을 쓰고 한도는 StartRun이
  // 고정한 값이다. 현재 assignment·scope·credential·model은 새 진입 전에 다시 확인한다(R9).
  async function prepareResume(
    runId: string,
    credentials: RunCredentials,
  ): Promise<Result<PreparedResume>> {
    const run = await readOf(machine, runRead, { run: runId });
    if (!run.ok) return run;
    const record = run.value.run;
    const assigned = await readOf(machine, assignmentRead, {
      assignment: record.assignment,
    });
    if (!assigned.ok) return assigned;
    const assignment = assigned.value.assignment;
    const basis = await readOf(machine, runBody, {
      kind: "run_basis",
      id: runId,
    });
    if (!basis.ok) return basis;
    const pinned = (basis.value.value as {
      preset?: { id?: string; revision?: number };
    }).preset;
    if (pinned?.id === undefined || pinned.revision === undefined) {
      return err({
        code: "unavailable",
        message: "the run basis is unreadable",
      });
    }
    const found = await material(record, assignment, {
      id: pinned.id,
      revision: pinned.revision,
    });
    if (!found.ok) return found;
    const holder: { agent?: CoreCall } = {};
    const agent: CoreCall = (path, body) =>
      holder.agent === undefined
        ? Promise.resolve(
          err({ code: "unauthorized" as const, message: "no run credential" }),
        )
        : holder.agent(path, body);
    const built = loopFor(found.value, assignment, agent);
    const lookups = new Map([
      ...(deps.toolkit.lookups?.(found.value.seat, agent) ?? []),
      ...(deps.apps?.lookups(found.value.appTools) ?? []),
    ]);
    let held: AgentRunCredential | undefined;
    const recoveryDeps = {
      machine,
      clock,
      store: (purpose: string, value: unknown) =>
        storeValue(deps.blobs, deps.instructions.redact, purpose, value),
      lookup: (tool: string) => lookups.get(tool),
      close: built.ported.ports.tools.close,
    };
    return ok({
      assignment: record.assignment,
      settle: () => built.resolver.settle(runId),
      async recover(executing) {
        // 이 run의 ledger 사실로 경계를 확정한다. credential은 새 진입이 확정된 뒤에만 받는다.
        const outcome = await recoverRunFromLedger(recoveryDeps, runId, {
          ...(executing === undefined ? {} : { executing }),
          async preflight(fixed) {
            // 현재 scope가 StartRun이 고정한 값과 다르면 진행하지 않는다.
            if (
              canonicalize(fixed.scope) !== canonicalize(found.value.scope)
            ) return "target_unavailable";
            if (!(await found.value.model.available())) {
              return "configuration_unavailable";
            }
            const opened = await credentials.open({
              run: runId,
              assignment: record.assignment,
              scope: found.value.scope,
            });
            if (!opened.ok) return "configuration_unavailable";
            held = opened.value;
            holder.agent = deps.agentCall(opened.value.token);
            return null;
          },
        });
        if (!outcome.ok || outcome.value.kind !== "resume") {
          if (held !== undefined) credentials.end(runId);
          return outcome.ok
            ? ok({ kind: "ended" as const, outcome: outcome.value })
            : outcome;
        }
        const resumed = outcome.value;
        built.ported.resumeAfter(resumed.lastModelCall);
        return ok({
          kind: "resumed" as const,
          credential: held!,
          deps: built.loopDeps,
          settle: () => built.resolver.settle(runId),
          input: {
            run: runId,
            session: resumed.session,
            limits: record.limits,
            elapsed: resumed.elapsed,
            attempts: resumed.attempts,
            resume: resumed.resume,
          },
        });
      },
    });
  }

  return {
    prepare,
    prepareResume,
    // 재시작 뒤 복구할 run: 시작했고 끝나지 않은 run. 사람이 멈춘 run은 이미 끝나 있다.
    async liveRuns() {
      const live: { run: string; state: "running" | "waiting_user" }[] = [];
      for (const state of ["running", "waiting_user"] as const) {
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
          const listed = await readOf(machine, runList, {
            state,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (!listed.ok) return listed;
          for (const run of listed.value.runs) {
            live.push({ run: run.id, state });
          }
          if (
            listed.value.next_cursor === null ||
            listed.value.next_cursor === undefined
          ) break;
          cursor = listed.value.next_cursor;
        }
      }
      return ok(live);
    },
    // StartRun은 확정됐지만 credential을 받지 못한 run은 설정 불가로 끝낸다.
    async closeUnusable(selection) {
      const run = await readOf(machine, runRead, { run: selection.run });
      if (!run.ok) return;
      const result = await storeValue(
        deps.blobs,
        deps.instructions.redact,
        RUN_BLOB_PURPOSES.run_result,
        { run: selection.run, why: "credential" },
      );
      if (!result.ok) return;
      await commandOf(
        machine,
        finishRun,
        {
          run: selection.run,
          outcome: { kind: "failed", reason: "configuration_unavailable" },
          result: result.value.hash,
          result_size: result.value.size,
        },
        { state_seq: run.value.run.state_seq },
        `${selection.run}:finish:credential`,
      );
    },
  };
}
