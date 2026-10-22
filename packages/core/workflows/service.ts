import { z } from "zod";
import { err, type IdSource, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";
import type {
  LineBy,
  ReportLine,
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
  parseDeclaration,
  participantsOf,
  stepsOf,
} from "./declaration.ts";
import { planHandoff } from "./plan.ts";
import type {
  WorkflowFiles,
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
  ids: IdSource;
}) {
  const { files, projects, turns, store, ids } = deps;

  // 상태를 읽어 command 입력을 만들고 state_seq로 건다. conflict면 다시 읽어 state_seq가 바뀌었을 때만
  // 최대 3번 건다. 안 바뀌었으면 진짜 conflict다.
  async function apply(
    instance: string,
    make: (state: State) => Result<ApplyInput>,
  ): Promise<Result<Output<typeof workflowInstanceApply>>> {
    let seen: string | null = null;
    let last: Result<never> | null = null;
    for (let attempt = 0;; attempt++) {
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
    const at = lines.findLastIndex((l) => l.kind === "handed");
    const handed = lines[at];
    if (handed?.kind !== "handed") return;
    // 이미 남겼거나 그 step이 restart 전에 report했으면 또 남기지 않는다.
    const done = lines.slice(at + 1).some((l) =>
      l.kind === "lophn_restarted" ||
      (l.kind === "report" && l.step === handed.step)
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
    const lost = turn.turn === null ||
      (turn.outcome?.kind === "interrupted" &&
        turn.outcome.reason === "restarted");
    if (!lost) return;
    const applied = await store.apply({
      instance: id,
      change: {
        kind: "lophn_restarted",
        step: handed.step,
        receiver: handed.receiver,
      },
      by: { kind: "lophn" },
      handoff: null,
    }, { state_seq: instance.state_seq });
    if (!applied.ok) skip(id, applied.error.code);
  }

  return {
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
          entryOf(project.value.id, `${project.value.name}/${file.name}`, file)
        ),
      });
    },

    async start(input: z.output<typeof workflowStart.input>, by: LineBy) {
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
      if (
        !entry.startable || !parsed.ok || parsed.declaration.kind !== "agent"
      ) {
        return fail(
          "conflict",
          entry.problem?.message ?? "workflow cannot be started",
        );
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
        const hands = instance.state !== "stopped" && next !== null &&
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
          const lastReport = lines.findLast((l): l is ReportLine =>
            l.kind === "report"
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
            lines.flatMap((l) => l.kind === "handed" ? [l.receiver] : []),
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
          console.error(`workflows: could not reconcile ${id} (${e})`);
        }
      }
    },
  };
}

function skip(id: string, code: string): void {
  console.error(`workflows: skipped ${id} (${code})`);
}
