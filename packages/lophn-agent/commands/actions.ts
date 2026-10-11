import type { LophnError, Result } from "../../base/mod.ts";
import type {
  BUILTIN_COMMAND_IDS,
  CommandEntry,
} from "../../contracts/lophn-agent/mod.ts";
import { resolveSubmission } from "./list.ts";
import type { CommandRegistry } from "./registry.ts";
import { skillPrompt, withArgument } from "./role-prompts.ts";

// `/` 명령 실행(concern lophn-agent/commands). 명령이 session에 일으키는 일은 모두 port로
// 부른다: port는 사람의 자격으로 conversation command(OpenSession·RenameSession·ArchiveSession·
// ForkSession·CompactSession)와 ReceiveMessage를 부르는 얇은 연결이라, 명령이 일반 입력과 다른
// 권한을 갖지 않는다(R9, R10). 이 모듈은 어느 명령이 무엇을 부를지만 정한다.

export type CommandPorts = {
  newSession(): Promise<Result<{ session: string }>>;
  renameSession(title: string): Promise<Result<unknown>>;
  archiveSession(): Promise<Result<unknown>>;
  compactSession(): Promise<Result<unknown>>;
  forkSession(): Promise<Result<{ session: string }>>;
  // 사람이 보낸 다음 요청 메시지로 접수한다. 일이 도는 중이면 conversation이 그 일 뒤에 새 run으로
  // 처리한다(conversation#R6).
  sendMessage(text: string): Promise<Result<unknown>>;
};

export type CommandScreen = "mcp" | "skills" | "permissions";

export type CommandOutcome =
  // `/`로 시작하지 않는 입력이다. 호출자가 일반 메시지로 보낸다.
  | { kind: "message" }
  // 맞는 명령이 없다. 명령으로도 일반 메시지로도 보내지 않는다(R11).
  | { kind: "unknown_command"; name: string }
  | { kind: "choose_skill"; name: string; candidates: readonly CommandEntry[] }
  // 이름 뒤에 글이 있어야 하는 명령(Rename)이다.
  | { kind: "needs_argument"; command: string }
  // 작업 중에는 못 쓰는 명령이다(R8).
  | { kind: "blocked"; command: string }
  // 이번 일이 끝난 뒤 실행하려고 줄 세웠다(R8).
  | { kind: "queued"; command: string }
  | { kind: "open_screen"; screen: CommandScreen }
  | { kind: "done"; command: string }
  | { kind: "opened_session"; command: string; session: string }
  // role·skill 명령을 사람의 메시지로 접수했다. queued는 일이 도는 중이라 그 일 뒤로 간 경우다.
  | { kind: "sent"; command: string; queued: boolean }
  | { kind: "failed"; command: string; error: LophnError };

// 작업 중에 부른 Compact를 일이 끝날 때까지 쥐고 있는 줄이다. 프로세스 수명의 상태이므로 entry가
// 만들어 넘긴다. 줄 서는 것은 session마다 Compact 하나뿐이다(role·skill 메시지는 다음 요청으로
// 접수해 conversation이 줄을 세운다).
export type CommandQueue = {
  hold(session: string): void;
  // 일이 끝난 session의 줄 선 명령을 실행하고 줄을 비운다. 실패해도 다시 줄 서지 않는다.
  drain(session: string, ports: CommandPorts): Promise<CommandOutcome[]>;
};

export function createCommandQueue(): CommandQueue {
  const compacts = new Set<string>();
  return {
    hold: (session) => {
      compacts.add(session);
    },
    async drain(session, ports) {
      if (!compacts.delete(session)) return [];
      return [await settle("compact", ports.compactSession())];
    },
  };
}

export type CommandDeps = {
  registry: CommandRegistry;
  ports: CommandPorts;
  queue: CommandQueue;
  session: string;
};

async function settle(
  command: string,
  pending: Promise<Result<unknown>>,
): Promise<CommandOutcome> {
  const result = await pending;
  return result.ok
    ? { kind: "done", command }
    : { kind: "failed", command, error: result.error };
}

async function opened(
  command: string,
  pending: Promise<Result<{ session: string }>>,
): Promise<CommandOutcome> {
  const result = await pending;
  return result.ok
    ? { kind: "opened_session", command, session: result.value.session }
    : { kind: "failed", command, error: result.error };
}

function runBuiltin(
  deps: CommandDeps,
  entry: CommandEntry,
  id: typeof BUILTIN_COMMAND_IDS[number],
  argument: string,
  working: boolean,
): Promise<CommandOutcome> | CommandOutcome {
  const { ports } = deps;
  switch (id) {
    case "new":
      return opened(id, ports.newSession());
    case "rename":
      return argument === ""
        ? { kind: "needs_argument", command: id }
        : settle(id, ports.renameSession(argument));
    case "archive":
      return settle(id, ports.archiveSession());
    case "compact":
      if (working && entry.while_running === "queue") {
        deps.queue.hold(deps.session);
        return { kind: "queued", command: id };
      }
      return settle(id, ports.compactSession());
    case "fork":
      return opened(id, ports.forkSession());
    // 화면을 열 뿐이다. 명령 자체로 권한이나 설정을 바꾸지 않는다(R10).
    case "mcp":
    case "skills":
    case "permissions":
      return { kind: "open_screen", screen: id };
  }
}

async function send(
  deps: CommandDeps,
  entry: CommandEntry,
  text: string,
  working: boolean,
): Promise<CommandOutcome> {
  const sent = await deps.ports.sendMessage(text);
  return sent.ok
    ? {
      kind: "sent",
      command: entry.name,
      queued: working && entry.while_running === "queue",
    }
    : { kind: "failed", command: entry.name, error: sent.error };
}

// 제출한 입력 하나를 registry대로 실행한다. 작업 중 값(while_running)이 정하는 대로: blocked는 부르지
// 않고, queue는 일이 끝난 뒤로 미루고(role·skill 메시지는 다음 요청으로 접수해 conversation이 줄을
// 세운다), run은 바로 부른다(R8).
export async function runCommand(
  deps: CommandDeps,
  input: { text: string; working: boolean },
): Promise<CommandOutcome> {
  const submission = resolveSubmission(deps.registry, input.text);
  switch (submission.kind) {
    case "message":
      return { kind: "message" };
    case "unknown_command":
      return { kind: "unknown_command", name: submission.name };
    case "choose_skill":
      return {
        kind: "choose_skill",
        name: submission.name,
        candidates: submission.candidates,
      };
    case "command":
      break;
  }
  const { entry, argument } = submission;
  if (input.working && entry.while_running === "blocked") {
    return { kind: "blocked", command: entry.name };
  }
  const action = entry.action;
  switch (action.kind) {
    case "builtin":
      return await runBuiltin(deps, entry, action.id, argument, input.working);
    case "prompt":
      return send(
        deps,
        entry,
        withArgument(action.template, argument),
        input.working,
      );
    case "skill":
      return send(
        deps,
        entry,
        skillPrompt(action.skill_name, argument),
        input.working,
      );
    case "tool":
      return {
        kind: "failed",
        command: entry.name,
        error: {
          code: "invalid_input",
          message: "a tool command has no way to run yet",
        },
      };
  }
}
