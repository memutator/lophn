import { z } from "zod";
import {
  err,
  type IdSource,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { LOPHN_AGENT_HANDLE } from "../../protocol/lophn-agent/mod.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";
import type {
  LineBy,
  ReportLine,
  StartedBy,
  workflowEdit,
  workflowInstanceApply,
  workflowInstanceRead,
  workflowList,
  workflowReport,
  workflowStart,
  workflowStop,
} from "../../protocol/workflows/mod.ts";
import {
  entryOf,
  flowStepsOf,
  parseDeclaration,
  participantsOf,
  stepsOf,
} from "./declaration.ts";
import { planHandoff } from "./plan.ts";
import type {
  WorkflowFiles,
  WorkflowFlows,
  WorkflowProjects,
  WorkflowStore,
  WorkflowTurns,
} from "./ports.ts";

type State = Output<typeof workflowInstanceRead>;
type Lines = State["lines"];
type ApplyInput = Input<typeof workflowInstanceApply>;

const fail = (
  code: "invalid_input" | "not_found" | "conflict",
  message: string,
): Result<never> => err({ code, message });

// 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session이다.
function sameSessionIn(lines: Lines) {
  return (participant: string): Id<"ses"> | null => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      if (line.kind === "handed" && line.participant === participant) {
        return line.receiver as Id<"ses">;
      }
    }
    return null;
  };
}

export function createWorkflowService(deps: {
  files: WorkflowFiles;
  projects: WorkflowProjects;
  turns: WorkflowTurns;
  store: WorkflowStore;
  flows: WorkflowFlows;
  ids: IdSource;
  logger: Logger;
}) {
  const { files, projects, turns, store, flows, ids, logger } = deps;

  const skip = (id: string, code: string): void => {
    logger.warn({
      component: "workflows",
      event: "skipped",
      fields: { instance: id, code },
    });
  };

  // 상태를 읽어 command 입력을 만들고 state_seq로 건다. conflict면 다시 읽어 state_seq가 바뀌었을 때만
  // 최대 3번 건다. 안 바뀌었으면 진짜 conflict다.
  async function apply(
    instance: string,
    make: (state: State) => Result<ApplyInput>,
  ): Promise<Result<Output<typeof workflowInstanceApply>>> {
    let seen: string | null = null;
    let last: Result<never> | null = null;
    for (let attempt = 0; ; attempt++) {
      const read = await store.read(instance as Id<"wfi">);
      if (!read.ok) return read;
      const state = read.value;
      if (seen === state.instance.state_seq) return last!;
      const input = make(state);
      if (!input.ok) return input;
      const done = await store.apply(input.value, {
        state_seq: state.instance.state_seq,
      });
      if (done.ok || done.error.code !== "conflict" || attempt >= 2) {
        return done;
      }
      seen = state.instance.state_seq;
      last = done;
    }
  }

  async function restarted(id: string): Promise<void> {
    const read = await store.read(id as Id<"wfi">);
    if (!read.ok) return skip(id, read.error.code);
    const { instance, lines } = read.value;
    // flow instance는 started 줄에 step이 없다. process는 다시 띄우지 않고 닫는다(바깥 효과가 두 번 나지 않게).
    const started = lines.find((l) => l.kind === "started");
    if (started?.kind === "started" && started.step === null) {
      const closed = await store.apply(
        {
          instance: id,
          change: { kind: "flow_restarted" },
          by: { kind: "lophn" },
          handoff: null,
        },
        { state_seq: instance.state_seq },
      );
      if (!closed.ok) skip(id, closed.error.code);
      return;
    }
    const at = lines.findLastIndex((l) => l.kind === "handed");
    const handed = lines[at];
    if (handed?.kind !== "handed") return;
    // 이미 남겼거나 그 step이 restart 전에 report했으면 또 남기지 않는다.
    const done = lines
      .slice(at + 1)
      .some(
        (l) =>
          l.kind === "lophn_restarted" ||
          (l.kind === "report" && l.step === handed.step),
      );
    if (done) return;
    const found = await turns.stepTurn(
      handed.receiver as Id<"ses">,
      id as Id<"wfi">,
      handed.step,
    );
    if (!found.ok) return skip(id, found.error.code);
    const turn = found.value;
    if (turn === null) return;
    const lost =
      turn.turn === null ||
      (turn.outcome?.kind === "interrupted" &&
        turn.outcome.reason === "restarted");
    if (!lost) return;
    const applied = await store.apply(
      {
        instance: id,
        change: {
          kind: "lophn_restarted",
          step: handed.step,
          receiver: handed.receiver,
        },
        by: { kind: "lophn" },
        handoff: null,
      },
      { state_seq: instance.state_seq },
    );
    if (!applied.ok) skip(id, applied.error.code);
  }

  async function programExited(input: {
    instance: Id<"wfi">;
    code: number | null;
    stderr_tail: string;
  }): Promise<Result<void>> {
    const done = await apply(input.instance, ({ instance }) =>
      ok({
        instance: instance.id,
        change: {
          kind: "program_exited",
          code: input.code,
          stderr_tail: input.stderr_tail,
        },
        by: { kind: "lophn" },
        handoff: null,
      }),
    );
    return done.ok ? ok(undefined) : done;
  }

  return {
    programExited,

    async list(
      input: z.output<typeof workflowList.input>,
      defaultProject: string | null,
    ) {
      const ref = input.project ?? defaultProject;
      if (ref === null) {
        return fail("invalid_input", "give a project");
      }
      const project = await projects.resolve(ref);
      if (!project.ok) return project;
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      return ok({
        workflows: listed.value.map((file) =>
          entryOf(project.value.id, `${project.value.name}/${file.name}`, file),
        ),
      });
    },

    async start(input: z.output<typeof workflowStart.input>, by: StartedBy) {
      const [projectRef, name] = input.workflow.split("/") as [string, string];
      const project = await projects.resolve(projectRef);
      if (!project.ok) return project;
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      const file = listed.value.find((f) => f.name === name);
      if (file === undefined) {
        return fail("not_found", "workflow not found");
      }
      const entry = entryOf(project.value.id, input.workflow, file);
      const parsed = parseDeclaration(file);
      if (!entry.startable || !parsed.ok) {
        return fail(
          "conflict",
          entry.problem?.message ?? "workflow cannot be started",
        );
      }
      if (parsed.declaration.kind === "flow") {
        if (input.step !== undefined) {
          return fail("invalid_input", "a flow has no step to start from");
        }
        const id = ids.newId("wfi") as Id<"wfi">;
        const created = await store.create({
          id,
          project: project.value.id,
          workflow: name,
          input: input.text,
          participants: {},
          steps: flowStepsOf(parsed.declaration),
          started_by: by,
          handoff: null,
        });
        if (!created.ok) return created;
        // process 인자에는 redaction을 거친 instance.input을 넘긴다.
        const launched = await flows.launch({
          instance: id,
          project: project.value.id,
          workflow: name,
          input: created.value.instance.input,
          agent: parsed.declaration.agent ?? LOPHN_AGENT_HANDLE,
        });
        if (launched.ok) return created;
        // 시작은 성공이다. 이유가 program_exited → ended 줄로 남아야 사람이 본다.
        await programExited({
          instance: id,
          code: null,
          stderr_tail: launched.error.message,
        });
        const again = await store.read(id);
        return ok({
          instance: again.ok ? again.value.instance : created.value.instance,
          handed: null,
        });
      }
      const steps = stepsOf(parsed.declaration);
      const participants = participantsOf(parsed.declaration);
      const step = input.step ?? steps[0]!.name;
      if (!steps.some((s) => s.name === step)) {
        return fail("not_found", "step not found");
      }
      const id = ids.newId("wfi") as Id<"wfi">;
      return await store.create({
        id,
        project: project.value.id,
        workflow: name,
        input: input.text,
        participants,
        steps,
        started_by: by,
        handoff: planHandoff({
          instance: { id, project: project.value.id, participants, steps },
          step,
          cause: "start",
          session: null,
          received: input.text,
          sameSession: () => null,
        }),
      });
    },

    async report(input: z.output<typeof workflowReport.input>, by: LineBy) {
      const done = await apply(input.instance, ({ instance, lines }) => {
        const next = input.next ?? null;
        // stopped·end·next 없음은 넘기지 않는다. stopped의 report는 줄만 남는다.
        // flow(program)의 report도 넘기지 않는다. next는 current를 옮기고 닫는 데만 쓴다.
        const hands =
          by.kind !== "program" &&
          instance.state !== "stopped" &&
          next !== null &&
          next !== "end";
        const session = input.session ?? "new";
        return ok({
          instance: instance.id,
          change: {
            kind: "report",
            step: input.step,
            text: input.text,
            next,
            session,
          },
          by,
          handoff: hands
            ? planHandoff({
                instance,
                step: next,
                cause: "report",
                session,
                received: input.text,
                sameSession: sameSessionIn(lines),
              })
            : null,
        });
      });
      return done.ok
        ? ok({ line: done.value.line, handed: done.value.handed })
        : done;
    },

    async edit(input: z.output<typeof workflowEdit.input>, by: LineBy) {
      const { instance: id, ...edit } = input;
      const done = await apply(id, ({ instance, lines }) => {
        if (instance.state === "stopped") {
          return fail("conflict", "workflow instance is stopped");
        }
        let handoff = null;
        if (edit.op === "hand_now") {
          const session = edit.session ?? "new";
          const lastReport = lines.findLast(
            (l): l is ReportLine => l.kind === "report",
          );
          handoff = planHandoff({
            instance,
            step: edit.step,
            cause: "edit",
            session,
            received: edit.text ?? lastReport?.text ?? instance.input,
            sameSession: sameSessionIn(lines),
          });
        }
        return ok({
          instance: id,
          change: { kind: "edit", edit },
          by,
          handoff,
        });
      });
      return done.ok
        ? ok({ line: done.value.line, handed: done.value.handed })
        : done;
    },

    async stop(input: z.output<typeof workflowStop.input>, by: LineBy) {
      let sessions: string[] = [];
      const done = await apply(input.instance, ({ instance, lines }) => {
        if (instance.state === "stopped") {
          return fail("conflict", "workflow instance is stopped");
        }
        sessions = [
          ...new Set(
            lines.flatMap((l) => (l.kind === "handed" ? [l.receiver] : [])),
          ),
        ];
        return ok({
          instance: instance.id,
          change: { kind: "stop" },
          by,
          handoff: null,
        });
      });
      if (!done.ok) return done;
      // 멈춘 기록이 먼저다. 못 멈춘 session은 기록에 남기지 않는다(CancelRun과 같다).
      for (const session of sessions) {
        await turns.stopSession(session as Id<"ses">);
      }
      // process를 죽인다. 늦게 오는 program_exited는 stopped라 줄만 남는다. 못 죽여도 기록하지 않는다.
      await flows.stop(input.instance as Id<"wfi">);
      return ok({ instance: done.value.instance });
    },

    // 켤 때 한 번. 넘겼는데 turn이 가져가지 않았거나 restart로 끊긴 step에 줄만 남긴다.
    // 다시 넣지 않는다: 바깥 효과가 두 번 날 수 있어서, 다시 넘기는 일은 agent나 사람이 hand_now로 한다.
    async reconcile(): Promise<void> {
      const running = await store.running();
      if (!running.ok) return;
      for (const { id } of running.value) {
        try {
          await restarted(id);
        } catch (e) {
          logger.error({
            component: "workflows",
            event: "reconcile_failed",
            message: `workflows: could not reconcile ${id}`,
            fields: { error: String(e) },
          });
        }
      }
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
