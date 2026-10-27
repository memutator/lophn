import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { RUN_WAIT_MAX_MS } from "../../../protocol/runs/mod.ts";
import {
  FLOW_ENTRY_FILE,
  FLOW_SDK_NAME,
  FLOW_SDK_VERSION,
  type FlowOutcome,
  type FlowRequest,
} from "../../../protocol/workflows/flow-wire.ts";
import {
  WORKFLOW_FLOW_FILE,
  workflowFolder,
} from "../../../protocol/workflows/paths.ts";
import { devImportMap, packageInstallPath } from "../../apps/packages/mod.ts";
import { realPathResolver } from "../../apps/permissions/mod.ts";
import {
  createStreamDecoder,
  drain,
} from "../../apps/runtime/observations/stream-decoder.ts";
import type { InstanceOrigin, RunService } from "../../runs/mod.ts";
import { settledWithin } from "../../supervision/responsiveness/deadline.ts";
import {
  type Spawned,
  spawnProcess,
} from "../../supervision/responsiveness/process.ts";
import type {
  createWorkflowService,
  WorkflowFlows,
} from "../../workflows/mod.ts";
import { createWriter, readRequests } from "./channel.ts";
import { flowArgv } from "./flags.ts";

type FlowHostDeps = {
  dataRoot: string;
  deno: string;
  env: Record<string, string>;
  clock: Clock;
  runs: Pick<RunService, "start" | "wait" | "cancelOfInstance">;
  workflows: Pick<
    ReturnType<typeof createWorkflowService>,
    "report" | "programExited"
  >;
  // null이면 redaction이 끝나지 못한 것이다. 그 글은 쓰지 않는다.
  redact(line: string): string | null;
};

// log와 import map의 자리. PM이 쓰는 workflow 폴더와 SDK 읽기 범위 밖이라 flow process가 읽지 못한다.
const FLOWS_FOLDER = "flows";
const LOG_MAX_BYTES = 1024 * 1024;
const TAIL_LINES = 10;
const TAIL_LINE_CHARS = 500;
// exit 신호가 마지막 data나 EOF보다 늦게 올 수 있다. 정상 종료를 틀린 통로로 읽지 않게 잠깐 기다린다.
const EXIT_GRACE_MS = 200;

type Entry = {
  child: Spawned;
  respond(id: string, outcome: FlowOutcome): void;
  // report는 step 순서가 의미를 가져 한 줄로 처리한다. agent·tool은 동시에 돈다.
  reports: Promise<void>;
  tail: string[];
  exited: boolean;
  // launch가 실패해 service가 직접 닫는다. 끝난 뒤 programExited를 또 부르지 않는다.
  quiet: boolean;
  logBytes: number;
  logFull: boolean;
  logChain: Promise<void>;
};

const failure = (reason: string, message: string): FlowOutcome => ({
  ok: false,
  reason,
  message,
});

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createFlowHost(
  deps: FlowHostDeps,
): WorkflowFlows & { close(): Promise<void> } {
  const { dataRoot, clock } = deps;
  const flowsRoot = `${dataRoot}/${FLOWS_FOLDER}`;
  const processes = new Map<string, Entry>();
  let closing = false;

  // 내용이 instance와 무관해 한 번만 쓴다. 동시 launch가 같은 파일을 덮어쓰지 않게 promise를 재사용한다.
  let importMapReady: Promise<string> | undefined;
  const importMap = () =>
    (importMapReady ??= (async () => {
      await mkdir(flowsRoot, { recursive: true, mode: 0o700 });
      const path = `${flowsRoot}/import-map.json`;
      const map = devImportMap(
        {
          [FLOW_SDK_NAME]: `lophn-sdk:${FLOW_SDK_NAME}@${FLOW_SDK_VERSION}/mod.ts`,
        },
        dataRoot,
        dataRoot,
      );
      await writeFile(path, JSON.stringify(map));
      return path;
    })().catch((e) => {
      importMapReady = undefined;
      throw e;
    }));

  // log 쓰기가 실패해도 flow는 멈추지 않는다.
  function appendLog(instance: string, entry: Entry, text: string) {
    if (entry.logFull) return;
    const at = clock.now();
    let data = `${at} ${text}\n`;
    const bytes = new TextEncoder().encode(data).length;
    if (entry.logBytes + bytes > LOG_MAX_BYTES) {
      entry.logFull = true;
      data = `${at} [log truncated]\n`;
    } else entry.logBytes += bytes;
    entry.logChain = entry.logChain
      .then(() =>
        appendFile(`${flowsRoot}/${instance}.log`, data, { mode: 0o600 }),
      )
      .catch(() => {});
  }

  // stderr 한 줄(과 host가 stderr에 남기는 [lophn] 줄)을 redaction을 거쳐 log와 끝 줄에 쌓는다.
  function stderrLine(instance: string, entry: Entry, raw: string) {
    const safe = deps.redact(raw);
    if (safe === null) {
      return appendLog(instance, entry, "[line withheld: redaction not ready]");
    }
    appendLog(instance, entry, safe);
    entry.tail.push(safe.slice(0, TAIL_LINE_CHARS));
    if (entry.tail.length > TAIL_LINES) entry.tail.shift();
  }

  async function guard<T>(
    work: () => Promise<T>,
    otherwise: (message: string) => T,
  ): Promise<T> {
    try {
      return await work();
    } catch (e) {
      return otherwise(messageOf(e));
    }
  }

  async function runOutcome(
    entry: Entry,
    request: Extract<FlowRequest, { type: "agent" | "tool" }>,
    origin: InstanceOrigin,
  ): Promise<FlowOutcome | null> {
    const started = await deps.runs.start(
      request.type === "agent"
        ? {
            kind: "agent",
            agent: request.agent,
            prompt: request.prompt,
            input: request.input,
            schema: request.schema,
          }
        : {
            kind: "tool",
            app: request.app,
            tool: request.tool,
            input: request.input,
          },
      origin,
    );
    if (!started.ok) {
      return failure(started.error.code, started.error.message);
    }
    let run = started.value;
    while (run.state === "running") {
      if (entry.exited || closing) return null;
      const waited = await deps.runs.wait(run.id as Id<"run">, RUN_WAIT_MAX_MS);
      if (!waited.ok) {
        return failure(waited.error.code, waited.error.message);
      }
      run = waited.value;
    }
    if (run.state === "done") return { ok: true, result: run.result };
    if (run.state === "failed") {
      return failure(run.error!.reason, run.error!.message);
    }
    return failure("cancelled", "the run was cancelled");
  }

  function handle(instance: Id<"wfi">, project: Id<"prj">, entry: Entry) {
    const origin: InstanceOrigin = {
      instance,
      creator: { role: "project_manager", project },
      creator_place: { kind: "project", id: project },
    };
    return (request: FlowRequest) => {
      if (entry.exited) return;
      if (request.type === "report") {
        entry.reports = entry.reports.then(async () => {
          // lophn은 report를 믿고 기록할 뿐이다. 판정을 더하지 않는다.
          const outcome = await guard(
            async (): Promise<FlowOutcome> => {
              const done = await deps.workflows.report(
                {
                  instance,
                  step: request.step,
                  text: request.text,
                  next: request.next,
                },
                { kind: "program" },
              );
              return done.ok
                ? { ok: true, result: null }
                : failure(done.error.code, done.error.message);
            },
            (message) => failure("internal", message),
          );
          entry.respond(request.id, outcome);
        });
        return;
      }
      void guard(
        () => runOutcome(entry, request, origin),
        (message) => failure("internal", message),
      ).then((outcome) => {
        if (outcome !== null) entry.respond(request.id, outcome);
      });
    };
  }

  async function launch(start: {
    instance: Id<"wfi">;
    project: Id<"prj">;
    workflow: string;
    input: string;
  }): Promise<Result<void>> {
    const { instance, project } = start;
    const unavailable = (message: string) =>
      err({ code: "unavailable" as const, message });
    const installed = packageInstallPath(FLOW_SDK_NAME, FLOW_SDK_VERSION);
    if (!installed.ok) return installed;
    let importMapPath: string;
    try {
      importMapPath = await importMap();
    } catch (e) {
      return unavailable(`flow import map is not ready: ${messageOf(e)}`);
    }
    if (closing) return unavailable("flow host is closing");
    if (processes.has(instance)) {
      return err({ code: "conflict", message: "flow is already running" });
    }
    const folder = workflowFolder(dataRoot, project, start.workflow);
    // 훑기와 launch 사이에 새로 생긴 link는 막지 못한다(앱의 symlink-changes와 같은 한계).
    // 대상을 못 푸는 link도 목록에 들어온다.
    const links = await realPathResolver("", dataRoot).linksIn(folder);
    const argv = flowArgv({
      workflowFolder: folder,
      sdkRoot: `${dataRoot}/sdk`,
      outsideLinks: links.map((found) => found.link),
      importMap: importMapPath,
      entry: `${dataRoot}/${installed.value}/${FLOW_ENTRY_FILE}`,
      flow: `${folder}/${WORKFLOW_FLOW_FILE}`,
    });
    if (!argv.ok) return argv;

    let child: Spawned;
    try {
      child = spawnProcess({
        command: deps.deno,
        args: argv.value,
        env: deps.env,
      });
    } catch (e) {
      return unavailable(`flow process did not start: ${messageOf(e)}`);
    }
    const writer = createWriter(child.stdin);
    const entry: Entry = {
      child,
      respond(id, outcome) {
        if (entry.exited || closing) return;
        void writer.response({ type: "response", id, outcome });
      },
      reports: Promise.resolve(),
      tail: [],
      exited: false,
      quiet: false,
      logBytes: 0,
      logFull: false,
      logChain: Promise.resolve(),
    };
    processes.set(instance, entry);

    const closeChannel = (reason: string) => {
      stderrLine(instance, entry, `[lophn] channel closed: ${reason}`);
      void child.terminate();
    };
    const reading = readRequests(child.stdout, {
      request: handle(instance, project, entry),
      invalid: (id, message) =>
        entry.respond(id, failure("invalid_input", message)),
      bad: closeChannel,
    }).then(async () => {
      // stdout이 먼저 끝났는데 process가 살아 있으면 끝낸다. 이미 끝나는 중이면 사유를 남기지 않는다.
      if (!(await settledWithin(child.exited, EXIT_GRACE_MS))) {
        closeChannel("stdout closed");
      }
    });
    const errReading = drain(
      child.stderr,
      createStreamDecoder({
        onLine: (line) => stderrLine(instance, entry, line),
        onDropped: () => {},
      }),
    );

    void child.exited.then(async (code) => {
      entry.exited = true;
      // exit이 마지막 data보다 먼저 올 수 있어 두 pipe가 끝난 뒤에 본다. 마지막 report가 program_exited 앞에 남는다.
      await Promise.all([reading, errReading]);
      await entry.reports;
      processes.delete(instance);
      if (closing || entry.quiet) return;
      await guard(
        () => deps.runs.cancelOfInstance(instance),
        (message) =>
          stderrLine(instance, entry, `[lophn] cancel failed: ${message}`),
      );
      await guard(
        async () => {
          const done = await deps.workflows.programExited({
            instance,
            code,
            stderr_tail: entry.tail.join("\n"),
          });
          if (!done.ok) {
            stderrLine(
              instance,
              entry,
              `[lophn] program_exited failed: ${done.error.message}`,
            );
          }
        },
        (message) =>
          stderrLine(
            instance,
            entry,
            `[lophn] program_exited failed: ${message}`,
          ),
      );
    });

    try {
      await writer.start({ type: "start", instance, input: start.input });
    } catch (e) {
      entry.quiet = true;
      processes.delete(instance);
      await child.terminate();
      return unavailable(
        `flow process did not take its start: ${messageOf(e)}`,
      );
    }
    return ok(undefined);
  }

  return {
    launch,

    async stop(instance) {
      const entry = processes.get(instance);
      if (entry === undefined) return ok(undefined);
      const gone = await entry.child.terminate();
      await guard(
        () => deps.runs.cancelOfInstance(instance),
        () => {},
      );
      return gone
        ? ok(undefined)
        : err({ code: "unavailable", message: "flow process did not end" });
    },

    // programExited와 cancelOfInstance를 부르지 않는다. 꺼지는 중인 ledger에 쓰지 않고, instance는 running으로
    // 남아 다음 기동 때 flow_restarted로 닫힌다.
    async close() {
      closing = true;
      await Promise.all(
        [...processes.values()].map((entry) => entry.child.terminate()),
      );
    },
  };
}
