import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import process from "node:process";
import {
  createIdSource,
  cryptoRandom,
  err,
  ok,
  type Result,
  systemClock,
} from "../../../base/mod.ts";
import {
  assignmentGet,
  toolGateCheck,
} from "../../../protocol/approvals/mod.ts";
import { appGet } from "../../../protocol/apps/mod.ts";
import { artifactsFolder } from "../../../protocol/projects/mod.ts";
import { askWait } from "../../../protocol/lophn-agent/ask-tool.ts";
import {
  type AgentId,
  type AgentWorkspace,
  instructionsGet,
} from "../../../protocol/lophn-agent/mod.ts";
import { toolResultFolder } from "../../../protocol/lophn-agent/tool-results.ts";
import { projectApi } from "../../../protocol/projects/mod.ts";
import { workflowsFolder } from "../../../protocol/workflows/paths.ts";
import { FILE_HOOKS, readMemoryTexts } from "../../agent-workspaces/hooks.ts";
import { listArtifactEntries } from "../../agent-workspaces/workspace/artifact-list.ts";
import {
  workspaceDataFolder,
  workspaceDataSkillsFolder,
} from "../../agent-workspaces/workspace/data-folder.ts";
import {
  type WorkspaceFiles,
  workspaceData,
} from "../../agent-workspaces/workspace/workspace-data.ts";
import { PROJECT_LAYER } from "../../agent-workspaces/workspace/project-layer.ts";
import { workspacePrompt } from "../../agent-workspaces/prompts/prompts.ts";
import { BUNDLED_SKILLS_ROOT } from "../../agent-workspaces/skills/root.ts";
import { workspaceToolNames } from "../../../protocol/lophn-agent/tool-lists.ts";
import {
  createMcpToolkit,
  type McpKit,
} from "../../lophn-agent/extensions/mcp-toolkit.ts";
import type { McpConnectionsDeps } from "../../lophn-agent/extensions/mod.ts";
import { spawnStdioMcp } from "../../lophn-agent/extensions/mod.ts";
import {
  productSkillSnapshotDeps,
  productSkillStores,
  registeredSkillEntries,
} from "../../lophn-agent/extensions/skill-folders.ts";
import { turnSkillReader } from "../../lophn-agent/extensions/skill-read.ts";
import { instructionFilesOverCore } from "../../lophn-agent/instructions/mod.ts";
import { createModelResolver } from "../../lophn-agent/models/resolve.ts";
import type { ProviderWatch } from "../../lophn-agent/providers/watch.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";
import type { TurnDriver } from "../../lophn-agent/run-loop/driver.ts";
import { abortableWait } from "../../lophn-agent/run-loop/mod.ts";
import {
  createTurnPreparer,
  type Toolkit,
  type TurnPreparer,
} from "../../lophn-agent/run-loop/prepare.ts";
import { UNWIRED_TOOL_PORTS } from "../../lophn-agent/run-loop/unwired.ts";
import {
  type Compactor,
  createCompactor,
} from "../../lophn-agent/session/compactor.ts";
import { withPublicOnly } from "../../lophn-agent/tools/app-public.ts";
import { createAppToolkit } from "../../lophn-agent/tools/app-toolkit.ts";
import { fileResultSpill } from "../../lophn-agent/tools/spill.ts";
import { createBuiltinToolkit } from "../../lophn-agent/tools/toolkit.ts";
import { agentTools } from "../agent-tools.ts";
import type { CoreCalls } from "./main.ts";

// skill 발견이 쓰는 workspace 층의 자리 규칙이다. agent runtime child는 조립이라 workspace 층을 안다.
const SKILL_WORKSPACES = {
  projectLayer: PROJECT_LAYER,
  bundledSkillsRoot: BUNDLED_SKILLS_ROOT,
  // 그 workspace의 `.lophn/skills`가 skill 층이다: project는 첫 등록 폴더, 앱은 source 폴더.
  async sourceFolder(machine: CoreCall, workspace: AgentWorkspace) {
    if (workspace.kind === "project") {
      const read = await readOf(machine, projectApi.get, {
        project: workspace.id,
      });
      return read.ok ? (read.value.project.folders[0]?.path ?? null) : null;
    }
    const read = await readOf(machine, appGet, { app: workspace.id });
    return read.ok ? read.value.app.source_path : null;
  },
};

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
    // 허락된 앱의 command를 `lophn <slug> <command>`를 부를 때 푸는 재료. 할당은 machine 자격의 loopback으로 읽는다.
    // 다른 앱의 비공개 command는 뺀다.
    appTool: withPublicOnly(
      createAppToolkit({
        machine: options.machine,
        async assignment(agent: AgentId) {
          const read = await readOf(options.machine, assignmentGet, {
            agent,
          });
          return read.ok ? ok(read.value.assignment) : read;
        },
      }),
    ),
    ...(options.mcp === undefined ? {} : { mcp: options.mcp }),
  };
}

// workspace 폴더는 data root(LOPHN_HOME) 아래에 있다. 절대 path가 아니면 폴더를 알 수 없어 범위에서 빠진다.
function workspaceFiles(): WorkspaceFiles {
  const home = process.env.LOPHN_HOME;
  const root = home !== undefined && isAbsolute(home) ? home : null;
  return {
    skillsFolder: (workspace) =>
      root === null
        ? null
        : workspaceDataSkillsFolder(root, workspace as never),
    dataFolder: (workspace) =>
      root === null ? null : workspaceDataFolder(root, workspace as never),
    artifactsFolder: (workspace) =>
      root === null ? null : artifactsFolder(root, workspace),
    workflowsFolder: (project) =>
      root === null ? null : workflowsFolder(root, project),
    ensureDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
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

// 제품 runtime의 driver 재료. core 연결을 받아 turn 시작 재료와 기본 harness 묶음(내장 tool, workspace 종류 prompt, model
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
      connections: mcpConnectionsDeps(calls.secrets),
    });
    // Compact의 요약 call이다. 사람이 요청한 Compact, 다음 turn 전 Compact, turn 안 Compact가 같은 model 선택 검증(Model
    // for summaries)과 core 연결을 쓴다.
    const compactor = createCompactor({
      clock: systemClock,
      ids,
      machine: calls.machine,
      workspaceTools: workspaceToolNames,
      blobs: calls.blobs,
      redact: calls.redact,
      resolveModel,
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
        spill: fileResultSpill(process.env.LOPHN_HOME),
        gate: { check: (input) => readOf(turn.core, toolGateCheck, input) },
        questions: {
          ask: (call, questions) =>
            readOf(turn.core, askWait, { ...call, questions }),
        },
        skills: turnSkillReader(
          productSkillSnapshotDeps(calls.machine, SKILL_WORKSPACES),
          {
            id: session.id,
            workspace: session.workspace,
            apps: turn.apps,
          },
          turn.skills,
        ),
      }),
      events: calls.events,
      compact: (input) => compactor.compactInTurn(input),
      workspacePrompt,
      workspaceData: async (call, agent, session) =>
        withToolResults(
          await workspaceData(call, agent, workspaceFiles()),
          session,
        ),
      workspaceTools: workspaceToolNames,
      memory: readMemoryTexts,
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
      // core가 session의 workspace로 어느 파일인지 정한다.
      instructionFilesFor: (session) =>
        instructionFilesOverCore(session, (input) =>
          readOf(calls.machine, instructionsGet, input),
        ),
      redact: calls.redact,
      // 그 agent 자리의 skill 폴더와 등록한 skill 폴더만 검사한다. 내장 skill은 그 workspace 종류에 선언된 것만이다. 설정이 없으면
      // 빈 목록이다.
      skills: (workspace, kind, apps) =>
        registeredSkillEntries(
          calls.machine,
          productSkillStores(workspace, SKILL_WORKSPACES),
          kind,
          apps,
        ),
    });
    return { preparer, compactor, listMcpTools: mcpKit.listTools };
  };
}

// 자기 session의 tool-results 폴더를 읽기 전용 칸(results)에 둔다. read 목록에 넣으면 cwd가 될 수 있다.
function withToolResults<T extends { scope: { results?: string } }>(
  placed: Result<T>,
  session: string,
): Result<T> {
  const home = process.env.LOPHN_HOME;
  if (!placed.ok) return placed;
  if (home === undefined || !isAbsolute(home)) return placed;
  placed.value.scope.results = toolResultFolder(home, session);
  return placed;
}

// queue의 turn을 계속 시작한다(source → preparer → StartTurn → loop → end). 시작할 turn이 없으면 쉰다.
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
    // HTTP MCP는 등록 server 설정의 url로만 닿는다. model이나 tool이 준 URL을 여는 길은 없다.
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
  // 사람이 요청한 Compact와 "Summarize from here"의 요약을 한 번에 하나씩 끝낸다. turn을 시작하는 길과 기다림 없이 따로 돈다.
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
  let summarizing: Promise<void> | undefined;
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
        // 입력이 queue에서 빠진 경우와 session을 Compact로 잡은 경우가 진전이다. 빠지지 않은 입력은 다시 골라지므로
        // 쉬었다 본다.
        started =
          next.kind === "started" ||
          next.kind === "compacting" ||
          (next.kind === "not_started" && next.consumed);
        if (next.kind === "started") {
          void next.done.catch((error) => {
            options.report?.(
              `turn ended with an error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        }
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
      // 요약은 model call이라 오래 걸린다. 기다리면 다른 session의 turn 시작이 늦어지므로 pump 밖에서 한 번에 하나만 돌린다.
      if (options.compactor !== undefined && summarizing === undefined) {
        const compactor = options.compactor;
        summarizing = (async () => {
          // 요청은 core에 열려 있어 실패한 요청은 다음 주기에 다시 본다. 요약 한 번의 실패도 pump를 끝내지 않는다.
          await compactor.next().catch(() => {});
          await compactor.nextRange().catch(() => {});
        })().finally(() => {
          summarizing = undefined;
        });
      }
      if (!started) await abortableWait(idleMs, options.signal);
    }
  })();
}
