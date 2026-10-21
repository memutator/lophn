import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  systemClock,
} from "../../../base/mod.ts";
import {
  agentAssignmentGet,
  toolGateCheck,
} from "../../../protocol/approvals/mod.ts";
import { domainList } from "../../../protocol/domains/mod.ts";
import { askWait } from "../../../protocol/lophn-agent/ask-tool.ts";
import {
  agentDefinitionRead,
  type AgentRef,
  instructionsGet,
  placeOfAgentRef,
} from "../../../protocol/lophn-agent/mod.ts";
import { instructionFilesOverCore } from "../../lophn-agent/instructions/mod.ts";
import { abortableWait } from "../../lophn-agent/run-loop/mod.ts";
import { workingDomains } from "../../lophn-agent/agents/resolve.ts";
import { spawnStdioMcp } from "../../lophn-agent/extensions/mod.ts";
import type { McpConnectionsDeps } from "../../lophn-agent/extensions/mod.ts";
import type { CoreCalls } from "./main.ts";
import {
  createMcpToolkit,
  type McpKit,
} from "../../lophn-agent/extensions/mcp-toolkit.ts";
import {
  createTurnPreparer,
  type Toolkit,
  type TurnPreparer,
} from "../../lophn-agent/run-loop/prepare.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";
import {
  type Compactor,
  createCompactor,
} from "../../lophn-agent/session/compactor.ts";
import { createModelResolver } from "../../lophn-agent/models/resolve.ts";
import { builtinToolNames } from "../../agent-roles/tool-lists.ts";
import { rolePrompt } from "../../agent-roles/roles/prompts.ts";
import { ROLE_TABLE } from "../../agent-roles/agents/role-table.ts";
import { PROJECT_LAYER } from "../../agent-roles/place/project-layer.ts";
import { BUNDLED_SKILLS_ROOT } from "../../agent-roles/skills/root.ts";
import {
  placeData,
  type PlaceFiles,
} from "../../agent-roles/place/place-data.ts";
import { isAbsolute } from "node:path";
import { lstat, open, readdir } from "node:fs/promises";
import { listArtifactEntries } from "../../agent-roles/place/artifact-list.ts";
import { placeDataFolder } from "../../agent-roles/place/data-folder.ts";
import { domainFolder } from "../../../protocol/domains/paths.ts";
import type { ProviderWatch } from "../../lophn-agent/providers/watch.ts";
import type { TurnDriver } from "../../lophn-agent/run-loop/driver.ts";
import {
  productSkillSnapshotDeps,
  productSkillStores,
  registeredSkillEntries,
} from "../../lophn-agent/extensions/skill-folders.ts";
import { turnSkillReader } from "../../lophn-agent/extensions/skill-read.ts";
import { routerOverCore } from "../../lophn-agent/tools/call/routing.ts";
import { agentTools } from "../agent-tools.ts";
import { createBuiltinToolkit } from "../../lophn-agent/tools/toolkit.ts";
import { createAppToolkit } from "../../lophn-agent/tools/app-toolkit.ts";
import { withPublicOnly } from "../../lophn-agent/tools/app-public.ts";
import { UNWIRED_TOOL_PORTS } from "../../lophn-agent/run-loop/unwired.ts";
import { FILE_HOOKS } from "../../agent-roles/hooks.ts";

// skill 발견이 쓰는 role 층의 자리 규칙이다. agent runtime child는 조립이라 role 층을 안다.
const SKILL_PLACES = {
  projectLayer: PROJECT_LAYER,
  bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
};

// agent가 일하는 domain id. PM·App Engineer는 place 그릇의 active domain 전부이고, Operator는 정의의 place와
// domains(고른 것 ∩ 그릇의 active domain, 고른 것이 없을 때만 전부 — resolve와 같다)가 정한다. lophn은 없다. 읽지 못하면 null.
async function callerDomains(
  machine: CoreCall,
  agent: AgentRef,
): Promise<string[] | null> {
  let place = placeOfAgentRef(agent);
  let chosen: readonly string[] = [];
  if (place === undefined) {
    const read = await readOf(machine, agentDefinitionRead, { agent });
    if (!read.ok) return null;
    place = read.value.place;
    const definition = read.value.definition;
    if (definition !== null && "domains" in definition) {
      chosen = definition.domains ?? [];
    }
  }
  if (place === null) return [];
  const listed = await readOf(machine, domainList, {
    owner: place,
    status: "active",
  });
  if (!listed.ok) return null;
  const ids = listed.value.domains.map((one) => one.id);
  return workingDomains(ids, chosen);
}

// 제품 runtime의 tool 묶음이다. 내장 tool의 정의·handler와 외부 MCP 등록 통로를 한 곳에서 낸다.
// 시험도 같은 묶음을 쓴다.
function productToolkit(options: {
  machine: CoreCall;
  definitions: Toolkit["definitions"];
  mcp?: Toolkit["mcp"];
}): Toolkit {
  return {
    ...createBuiltinToolkit(),
    definitions: options.definitions,
    // 허락된 앱의 tool. 할당은 machine 자격의 loopback으로 읽는다.
    // agent의 domain 집합 밖 domain의 비공개 tool은 목록에서 뺀다.
    appTool: withPublicOnly(
      createAppToolkit({
        machine: options.machine,
        async assignment(agent) {
          const read = await readOf(options.machine, agentAssignmentGet, {
            agent,
          });
          return read.ok ? ok(read.value.assignment) : read;
        },
      }),
      {
        callerDomains: (agent) => callerDomains(options.machine, agent),
        async toolDomain(app, name) {
          const read = await readOf(options.machine, domainList, {
            owner: { kind: "app", id: app as never },
          });
          if (!read.ok) return null;
          return read.value.domains.find((one) => one.name === name)?.id ??
            null;
        },
      },
    ),
    ...(options.mcp === undefined ? {} : { mcp: options.mcp }),
  };
}

// domain 폴더는 data root(LOPHN_HOME) 아래에 있다. 절대 path가 아니면 폴더를 알 수 없어 범위에서 빠진다.
function placeFiles(): PlaceFiles {
  const home = Deno.env.get("LOPHN_HOME");
  const root = home !== undefined && isAbsolute(home) ? home : null;
  return {
    domainFolder: (domain) => root === null ? null : domainFolder(root, domain),
    dataFolder: (place) =>
      root === null ? null : placeDataFolder(root, place as never),
    ensureDir: (path) => Deno.mkdir(path, { recursive: true }),
    listArtifacts: (folder) =>
      listArtifactEntries(folder, {
        readdir,
        lstat,
        async readHead(path, bytes) {
          const handle = await open(path, "r");
          try {
            const buffer = new Uint8Array(bytes);
            const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
            return new TextDecoder().decode(buffer.subarray(0, bytesRead));
          } finally {
            await handle.close();
          }
        },
      }),
  };
}

// 제품 runtime의 driver 재료. core 연결을 받아 turn 시작 재료와 기본 harness 묶음(내장 tool, 역할 prompt, model
// 선택 검증, 등록 skill 폴더)을 만든다. 아래는 조립이 채울 자리다: ToolContext의 바깥 연결(`toolPorts`). 지금은
// 닫힌 연결이 들어 있다. agent event는 감독 pipe로 core Bus에 간다(`calls.events`).
export function productDriver(options: { fetch?: typeof fetch } = {}) {
  return (
    calls: CoreCalls,
  ): {
    preparer: TurnPreparer;
    compactor: Compactor;
    listMcpTools: McpKit["listTools"];
  } => {
    const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
    const resolveModel = createModelResolver({
      machine: calls.machine,
      ...(calls.secrets === undefined ? {} : { attach: calls.secrets }),
      catalog: async () => {
        if (calls.catalog === undefined) {
          return err({
            code: "unavailable",
            message: "the model catalog is not available",
          });
        }
        const loaded = await calls.catalog.load();
        return loaded.ok ? ok(loaded.value.entries) : loaded;
      },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    // 외부 MCP 연결과 등록 통로다. 프로세스 수명의 상태는 entry에서
    // 만들어 넘기므로 productDriver 호출마다 하나를 만든다.
    const mcpKit = createMcpToolkit({
      machine: calls.machine,
      operatorRef: ROLE_TABLE.operatorRef,
      connections: mcpConnectionsDeps(calls.secrets),
    });
    const preparer = createTurnPreparer({
      clock: systemClock,
      ids,
      machine: calls.machine,
      agentCall: calls.agentCall,
      blobs: calls.blobs,
      resolveModel,
      toolkit: productToolkit({
        machine: calls.machine,
        definitions: agentTools({ file: FILE_HOOKS }),
        // 외부 MCP tool 등록 통로다. 등록·재조회는 mcp-toolkit이 소유한다.
        mcp: (session: string) => mcpKit.toolkit(session),
      }),
      // gate와 questions는 core가 기다림을 쥐고 runtime은 긴 한 번의 호출로 결과를 받는다.
      toolPorts: (session, turn) => ({
        ...UNWIRED_TOOL_PORTS,
        gate: { check: (input) => readOf(turn.core, toolGateCheck, input) },
        questions: {
          ask: (call, questions) =>
            readOf(turn.core, askWait, { ...call, questions }),
        },
        router: routerOverCore(turn.core),
        skills: turnSkillReader(
          productSkillSnapshotDeps(calls.machine, SKILL_PLACES),
          session,
          turn.skills,
        ),
      }),
      events: calls.events,
      rolePrompt,
      placeData: (call, agent) => placeData(call, agent, placeFiles()),
      roleTools: builtinToolNames,
      roles: ROLE_TABLE,
      instructions: {
        // turn 없이는 읽지 않는다. 실제 읽기는 아래 instructionFilesFor가 turn마다 연다.
        files: {
          read: () =>
            Promise.resolve(
              err({
                code: "unavailable",
                message: "no turn for instructions",
              }),
            ),
        },
        redact: calls.redact,
      },
      // LOPHN.md와 agent 정의 본문은 core의 GetInstructions로 그 session의 이름으로 읽는다.
      // core가 session의 place로 어느 파일인지 정한다.
      instructionFilesFor: (session) =>
        instructionFilesOverCore(
          session,
          (input) => readOf(calls.machine, instructionsGet, input),
        ),
      redact: calls.redact,
      // 그 agent 자리의 skill 폴더와 등록한 skill 폴더만 검사한다. 내장 skill은 그 role에 선언된 것만이다. 설정이 없으면
      // 빈 목록이다.
      skills: (place, role) =>
        registeredSkillEntries(
          calls.machine,
          productSkillStores(place, SKILL_PLACES),
          role,
        ),
    });
    // 사람이 요청한 Compact의 요약 call이다. 같은 model 선택 검증과 core 연결을 쓴다.
    const compactor = createCompactor({
      clock: systemClock,
      ids,
      machine: calls.machine,
      roleTools: builtinToolNames,
      roles: ROLE_TABLE,
      blobs: calls.blobs,
      redact: calls.redact,
      resolveModel,
    });
    return { preparer, compactor, listMcpTools: mcpKit.listTools };
  };
}

// 입력함의 turn을 계속 시작한다(source → preparer → StartTurn → loop → end). 시작할 turn이 없으면 쉰다.
const PUMP_IDLE_MS = 500;

// 제품 MCP 연결 눈이다. 실제 stdio process를 열고(spawnStdioMcp) 단조
// deadline timer를 쓴다. 테스트는 fake child·fake fetch를 끼운다.
function mcpConnectionsDeps(
  secrets?: McpConnectionsDeps["secrets"],
): McpConnectionsDeps {
  return {
    nowMs: () => Date.now(),
    wait: abortableWait,
    deadline: (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve("elapsed");
        }, ms);
        function onAbort() {
          clearTimeout(timer);
          resolve("aborted");
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    // HTTP MCP는 core가 child 권한에 더한 등록 server의 정확한 host:port로만 닿는다.
    fetch: (url, init) => fetch(url, init),
    // bearer·api_key·secret 헤더·OAuth 접근 token의 값은 core가 감독 pipe로 요청마다 한 번 건넨다.
    ...(secrets === undefined ? {} : { secrets }),
    openStdio: (_server, input, signal) => {
      void signal;
      return Promise.resolve(spawnStdioMcp(input));
    },
  };
}

export function startTurnPump(options: {
  driver: TurnDriver;
  // 사람이 요청한 Compact와 "Summarize from here"의 요약을 한 번에 하나씩 끝낸다. turn을 시작하는 길과 따로 돈다.
  compactor?: Compactor;
  // Disconnect한 provider로 진행 중인 turn을 멈추게 하는 알림을 매 주기 훑는다.
  providerWatch?: Pick<ProviderWatch, "poll">;
  // turn 준비·시작이 던진 예외를 남긴다. 같은 오류가 이어지면 처음 한 번만 부른다.
  report?(text: string): void;
  signal: AbortSignal;
  idleMs?: number;
}): Promise<void> {
  const idleMs = options.idleMs ?? PUMP_IDLE_MS;
  let lastFailure: string | undefined;
  return (async () => {
    while (!options.signal.aborted) {
      let started = false;
      try {
        await options.providerWatch?.poll();
      } catch {
        // 알림을 읽지 못해도 pump는 계속 돈다. 위치를 옮기지 않았으므로 다음 주기에 같은 알림을 다시 본다.
      }
      try {
        const next = await options.driver.startNext();
        started = next.kind === "started" || next.kind === "not_started";
        lastFailure = undefined;
      } catch (error) {
        // 한 번의 실패가 pump를 끝내지 않는다. 다음 주기에 다시 본다. 이유를 안 남기면 받은 메시지가 turn이 되지 않는 까닭을 아무도 모른다.
        const text = `turn start failed: ${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)
        }`;
        if (text !== lastFailure) options.report?.(text);
        lastFailure = text;
      }
      try {
        const compacted = await options.compactor?.next();
        if (compacted !== undefined && compacted.kind !== "idle") {
          started = true;
        }
      } catch {
        // 요약 한 번의 실패도 pump를 끝내지 않는다. 요청은 core에 열려 있어 다음 주기에 다시 본다.
      }
      try {
        const summarized = await options.compactor?.nextRange();
        if (summarized !== undefined && summarized.kind !== "idle") {
          started = true;
        }
      } catch {
        // 요약 한 번의 실패도 pump를 끝내지 않는다. 사람이 다시 요청하면 새 요청으로 온다.
      }
      if (!started) await abortableWait(idleMs, options.signal);
    }
  })();
}
