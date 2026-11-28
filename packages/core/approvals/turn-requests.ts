// turn 안 request. 물음이 나온 turn이 기다리고, 메모리에만 둔다.
// 꺼졌다 켜지면 비어 있고 다시 열지 않는다.

import type { Clock, IdSource } from "../../base/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  PermissionRuleLayers,
  TurnRequest,
  TurnRequestChoice,
  TurnRequestChoiceKind,
  TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type { Workspace } from "../../protocol/lophn-agent/workspaces.ts";
import type { Bus } from "../events/ports.ts";
import { alwaysPatterns } from "./gate/mod.ts";
import type {
  AlwaysEffect,
  OpenTurnRequestOptions,
  SessionEffect,
  TurnOrigin,
} from "./ports.ts";

type Cancelled = Extract<TurnRequestOutcome, { outcome: "cancelled" }>;

type Entry = {
  request: TurnRequest;
  workspace: Workspace | null;
  // 결정을 받는 중이거나 끝났으면 true. 같은 request를 두 번 결정하지 못하게 한다.
  closed: boolean;
  outcome: TurnRequestOutcome | null;
  waiters: ((outcome: TurnRequestOutcome) => void)[];
};

type TurnRequestsDeps = {
  permissionRules(workspace: Workspace | null): PermissionRuleLayers;
  homeDir?: string;
  dataRoot?: string;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

function cancelledFor(cause: Cancelled["cause"]): Cancelled {
  return { outcome: "cancelled", cause };
}

function defaultOutsideRewind(subject: TurnRequest["subject"]): boolean {
  switch (subject.kind) {
    case "shell":
    case "mcp_tool":
    case "local_tool":
    case "setting":
    case "project_command":
    case "project_command_definition":
    case "workflow_run":
    case "worktree_remove":
      return true;
    case "file_write":
      return subject.outside_workspace;
    case "file_read":
      return false;
    case "app_tool":
      return subject.effect !== "read";
    case "harness":
      return true;
  }
}

export function createTurnRequests(deps: TurnRequestsDeps) {
  const entries = new Map<string, Entry>();

  function resolve(entry: Entry, outcome: TurnRequestOutcome): void {
    entry.closed = true;
    entry.outcome = outcome;
    for (const waiter of entry.waiters) waiter(outcome);
    entry.waiters = [];
    deps.bus.publish({
      session: entry.request.session,
      type: "TurnRequestClosed",
      at: deps.clock.now(),
      payload: { request: entry.request.id, outcome: outcome.outcome },
    });
  }

  return {
    open(
      origin: TurnOrigin,
      subject: TurnRequest["subject"],
      options?: OpenTurnRequestOptions,
    ): Result<TurnRequest> {
      // 부모가 푸는 request는 always가 없다: 부모가 권한 규칙을 더하는 길은 없다.
      const patterns = origin.toParent
        ? []
        : options?.alwaysPatterns !== undefined
          ? [...options.alwaysPatterns]
          : subject.kind === "shell" && subject.opaque !== true
            ? alwaysPatterns(
                deps.permissionRules(origin.workspace),
                subject.command,
                deps.homeDir,
                deps.dataRoot,
              )
            : [];

      let allowedChoices: TurnRequestChoiceKind[];
      if (origin.toParent) {
        allowedChoices = ["once", "reject"];
      } else if (options?.allowedChoices !== undefined) {
        // `always_patterns`가 비어 있으면 `always` 선택지를 열지 않는다.
        allowedChoices = options.allowedChoices.filter(
          (choice) => choice !== "always" || patterns.length > 0,
        );
        if (allowedChoices.length === 0) allowedChoices = ["once", "reject"];
      } else {
        allowedChoices =
          patterns.length > 0
            ? ["once", "session", "always", "reject"]
            : ["once", "reject"];
      }

      const request: TurnRequest = {
        id: deps.ids.newId("apr"),
        session: origin.session,
        turn: origin.turn,
        tool_call: origin.tool_call,
        subject,
        always_patterns: patterns,
        allowed_choices: allowedChoices,
        reason: options?.reason ?? null,
        outside_rewind: options?.outsideRewind ?? defaultOutsideRewind(subject),
        to_parent: origin.toParent,
        created_at: deps.clock.now(),
      };
      entries.set(request.id, {
        request,
        workspace: origin.workspace,
        closed: false,
        outcome: null,
        waiters: [],
      });
      deps.bus.publish({
        session: request.session,
        type: "TurnRequestOpened",
        at: request.created_at,
        payload: { request },
      });
      return ok(request);
    },

    wait(id: string): Promise<TurnRequestOutcome> {
      const entry = entries.get(id);
      if (entry === undefined) {
        return Promise.resolve(cancelledFor("turn_ended"));
      }
      if (entry.outcome !== null) return Promise.resolve(entry.outcome);
      return new Promise((resolveWaiter) => entry.waiters.push(resolveWaiter));
    },

    // 사람의 결정. 호출 자격이 사람인지는 route가 정한다.
    async decide(
      session: string,
      id: string,
      choice: TurnRequestChoice,
      effects: ReadonlyMap<string, AlwaysEffect>,
      sessionEffect?: SessionEffect,
    ): Promise<Result<{ outcome: TurnRequestOutcome }>> {
      const entry = entries.get(id);
      // 부모가 푸는 request는 카드가 없다. 사람이 결정하는 길을 열지 않는다.
      if (
        entry === undefined ||
        entry.request.session !== session ||
        entry.request.to_parent
      ) {
        return err({
          code: "not_found",
          message: "the request does not exist",
        });
      }
      if (entry.closed) {
        return err({
          code: "conflict",
          message: "the request is already decided",
        });
      }
      if (!entry.request.allowed_choices.includes(choice.kind)) {
        return err({
          code: "invalid_input",
          message: `choice "${choice.kind}" is not allowed for this request`,
        });
      }

      let outcome: TurnRequestOutcome;
      if (choice.kind === "reject") {
        entry.closed = true;
        outcome = { outcome: "reject", reason: choice.reason ?? null };
      } else if (choice.kind === "session") {
        // 아래 await 동안 다른 결정이 끼어들지 못하게 먼저 닫는다.
        entry.closed = true;
        if (sessionEffect !== undefined) {
          const done = await sessionEffect(entry.request, entry.workspace);
          if (!done.ok) {
            entry.closed = false;
            return done;
          }
          if (entry.outcome !== null) {
            return err({
              code: "conflict",
              message: "the request was cancelled",
            });
          }
        }
        outcome = { outcome: "allow", scope: "session" };
      } else if (choice.kind === "always") {
        const effect = effects.get(entry.request.subject.kind);
        if (entry.request.always_patterns.length === 0 || !effect) {
          return err({
            code: "invalid_input",
            message: "this request cannot be allowed always",
          });
        }
        entry.closed = true;
        const done = await effect(entry.request, entry.workspace);
        if (!done.ok) {
          entry.closed = false;
          return done;
        }
        if (entry.outcome !== null) {
          return err({
            code: "conflict",
            message: "the request was cancelled",
          });
        }
        outcome = { outcome: "allow", scope: "always" };
      } else {
        entry.closed = true;
        outcome = { outcome: "allow", scope: "once" };
      }
      resolve(entry, outcome);
      return ok({ outcome });
    },

    // 부모의 답(call reply)이나 부모의 끝남. once와 reject만 낸다. 이미 풀렸으면 아무것도 하지 않는다.
    answerFromParent(
      id: string,
      decision: "allow" | "reject",
      reason: string | null,
    ): void {
      const entry = entries.get(id);
      if (entry === undefined || entry.closed) return;
      resolve(
        entry,
        decision === "allow"
          ? { outcome: "allow", scope: "once" }
          : { outcome: "reject", reason },
      );
    },

    // turn이 끝나거나 session이 닫히거나 시작 때 정리한다. 기다리던 쪽은 거절과 구별해 cancelled를 받는다.
    cancel(session: string, cause: Cancelled["cause"]): void {
      for (const [id, entry] of entries) {
        if (entry.request.session !== session) continue;
        if (entry.outcome === null) resolve(entry, cancelledFor(cause));
        entries.delete(id);
      }
    },

    list(session: string): TurnRequest[] {
      return [...entries.values()]
        .filter((entry) => entry.request.session === session && !entry.closed)
        .map((entry) => entry.request);
    },
  };
}
