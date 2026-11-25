// 폰이 컴퓨터에 coding session을 새로 연다(`coding_sessions/open`). 여는 일은 core가 한다: 새 터미널을 열고 사람이 치는 것과 같은
// `<harness> gui [--resume <id>]`를 친다. 창이 없어도 열린다(그 project를 보이는 창이 있으면 탭으로 보인다). 되살리기는 ledger의
// harness agent session에 한한다(그 CLI session id를 ledger가 안다). 한 CLI session에 process 둘을 띄우지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { isGuiHarness } from "../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/mod.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import type { WorkflowOrigin } from "../../protocol/workflows/values.ts";

// 다시 보낸 open을 알아보는 key 수(전체).
const OPEN_KEYS_MAX = 200;

// 터미널에 `--resume <id>`로 치는 글자다. shell 함수가 받는 글자(`[A-Za-z0-9._-]` 200자)만 싣는다.
const CLI_SESSION = /^[A-Za-z0-9._-]{1,200}$/;

/** workflow_origin이 있는 팀원 탭의 배치(원 workflow의 workspace·instance desk·묶음). 터미널 PTY는 실행 project에 둔다. */
export type CodingOpenTab = {
  workspace: string;
  desk: { workflow: string; instance?: string };
  group: string;
};

export type CodingOpenDeps = {
  // harness-gui handler가 준비돼 있다. 기동 중이거나 없으면 `<harness> gui`를 쳐도 GUI가 서지 않는다.
  guiOn(): boolean;
  // project에 새 터미널을 열고 command를 친다(탭도 연다). tab을 주면 탭은 그 workspace·desk에 놓는다. 연 터미널 참조다.
  open(
    project: string,
    command: string,
    tab?: CodingOpenTab,
  ): Promise<Result<string>>;
  // ledger session. harness는 harness agent session이면 그 adapter id(`claude`), 아니면 null이다. 없으면 undefined.
  session(session: string):
    | {
        project: string | null;
        harness: string | null;
        cli_session: string | null;
      }
    | undefined;
  // 지금 터미널의 coding agent(`CodingSessions.list`).
  listed(): readonly { harness: string; cli_session: string | null }[];
  // TUI hold를 건다(`HarnessHold.open`). TUI로 열려 있거나 headless turn이 돌면 conflict다. 통과하면 여는 동안 headless turn이 시작하지 않는다.
  hold(session: string): Result<unknown>;
  // 연 터미널이 끝날 때까지 그 ledger session을 쥔다.
  held(terminal: string, session: string): void;
  // 사람이 Settings › Coding agents에 저장한 실행 명령어(flag 포함). GUI 열기 시 그 flag를 함께 적용한다.
  codingCommand?(harness: string): string | undefined;
};

// 터미널에 치는 줄. 사람이 Settings › Coding agents에 저장한 명령(flag 포함)이 있으면 그것에 `--gui`를 더하고, 이을 CLI session이
// 있으면 `--resume <id>`를 붙인다.
export function guiCommand(
  binary: string,
  custom: string | undefined,
  cliSession: string | null,
): string {
  const saved = custom?.trim() ?? "";
  const base = saved !== "" && !/[\r\n]/.test(saved) ? saved : binary;
  const hasGui = base.split(/\s+/).includes("--gui");
  return `${base}${hasGui ? "" : " --gui"}${cliSession === null ? "" : ` --resume ${cliSession}`}`;
}

export function createCodingOpen(deps: CodingOpenDeps) {
  const opens = new Map<string, Promise<Result<{ session: string }>>>();

  // 되살릴 ledger session을 거르고 hold를 건다. 보낼 resume이다.
  function resumable(input: {
    project: string;
    harness: string;
    resume: { session: string };
  }): Result<{ session: string; cli_session: string }> {
    const row = deps.session(input.resume.session);
    if (row === undefined || row.project !== input.project) {
      return err({
        code: "not_found",
        message: "No such coding agent session in this project.",
      });
    }
    if (row.harness === null) {
      return err({
        code: "invalid_input",
        message: "Only a coding agent session can continue as chat.",
      });
    }
    if (row.harness !== input.harness) {
      return err({
        code: "invalid_input",
        message: `This session belongs to ${row.harness}, not ${input.harness}.`,
      });
    }
    if (row.cli_session === null || !CLI_SESSION.test(row.cli_session)) {
      return err({
        code: "invalid_input",
        message:
          "This session has no saved CLI session to continue (it has not run yet).",
      });
    }
    const cli = row.cli_session;
    if (
      deps
        .listed()
        .some((one) => one.harness === row.harness && one.cli_session === cli)
    ) {
      return err({
        code: "conflict",
        message: "This session is already open on the computer.",
      });
    }
    const held = deps.hold(input.resume.session);
    return held.ok
      ? ok({ session: input.resume.session, cli_session: cli })
      : held;
  }

  async function send(input: {
    project: string;
    harness: string;
    resume?: { session: string };
  }): Promise<Result<{ session: string }>> {
    if (!isGuiHarness(input.harness)) {
      return err({
        code: "invalid_input",
        message: `${input.harness} cannot open as chat; use one of: claude, codex, opencode, omp, antigravity.`,
      });
    }
    if (!deps.guiOn()) {
      return err({
        code: "unavailable",
        message: "Chat view is not ready on this computer yet.",
      });
    }
    let resume: { session: string; cli_session: string } | undefined;
    if (input.resume !== undefined) {
      const found = resumable({ ...input, resume: input.resume });
      if (!found.ok) return found;
      resume = found.value;
    }
    const command = guiCommand(
      HARNESS_ADAPTERS[input.harness].commands[0]!,
      deps.codingCommand?.(input.harness),
      resume?.cli_session ?? null,
    );
    const opened = await deps.open(input.project, command);
    if (!opened.ok) return opened;
    if (resume !== undefined) deps.held(opened.value, resume.session);
    return ok({ session: guiSessionId(opened.value) });
  }

  return {
    // GUI 탭 팀원에게 입력이 왔는데 묶인 탭이 없다. 그 project에 그 CLI session을 이어(없으면 새로) GUI로 연다. 그 CLI session이 이미
    // 터미널에 열려 있으면 둘째 process를 띄우지 않는다. workflow_origin이 있으면 PTY는 실행 project에 두고 탭은 원 workflow desk에 놓는다.
    async member(input: {
      project: string;
      harness: string;
      cli_session: string | null;
      workflow_origin?: WorkflowOrigin | null;
    }): Promise<Result<string>> {
      if (!isGuiHarness(input.harness)) {
        return err({ code: "invalid_input", message: "not a GUI harness" });
      }
      if (!deps.guiOn()) {
        return err({
          code: "unavailable",
          message: "Chat view is not ready on this computer yet.",
        });
      }
      const cli = input.cli_session;
      if (cli !== null && !CLI_SESSION.test(cli)) {
        return err({
          code: "invalid_input",
          message: "The saved CLI session id cannot be typed in a terminal.",
        });
      }
      if (
        cli !== null &&
        deps
          .listed()
          .some(
            (one) => one.harness === input.harness && one.cli_session === cli,
          )
      ) {
        return err({
          code: "conflict",
          message: "This session is already open on the computer.",
        });
      }
      const origin = input.workflow_origin ?? null;
      const tab: CodingOpenTab | undefined =
        origin === null
          ? undefined
          : {
              workspace: origin.project,
              desk: { workflow: origin.workflow, instance: origin.instance },
              group: `${origin.instance}:${origin.step}`,
            };
      return await deps.open(
        input.project,
        guiCommand(
          HARNESS_ADAPTERS[input.harness].commands[0]!,
          deps.codingCommand?.(input.harness),
          cli,
        ),
        tab,
      );
    },
    // 같은 key는 한 번만 연다(보내는 중이거나 성공한 것의 답을 준다. 실패한 key는 잊어 다시 열 수 있다).
    open(input: {
      project: string;
      harness: string;
      resume?: { session: string };
      key: string;
    }): Promise<Result<{ session: string }>> {
      const seen = opens.get(input.key);
      if (seen !== undefined) return seen;
      const sent = send(input);
      opens.set(input.key, sent);
      while (opens.size > OPEN_KEYS_MAX) {
        opens.delete(opens.keys().next().value!);
      }
      void sent.then((done) => {
        if (!done.ok && opens.get(input.key) === sent) opens.delete(input.key);
      });
      return sent;
    },
  };
}

export type CodingOpen = ReturnType<typeof createCodingOpen>;
