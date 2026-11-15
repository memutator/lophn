// 폰이 컴퓨터에 coding session을 새로 열거나(`coding_sessions/open`) 앱을 깨운다(`coding_sessions/wake`). 여는 일은 host(shell main)가
// 한다: core는 입력을 걸러 `coding_open`을 연결로 보내고 host가 연 터미널을 session id로 옮긴다. 되살리기는 ledger의 harness agent
// session에 한한다(그 CLI session id를 ledger가 안다). 한 CLI session에 process 둘을 띄우지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import { isGuiHarness } from "../../protocol/extensions/mod.ts";
import { guiSessionId } from "../../protocol/lophn-agent/session-tag.ts";
import { passed } from "./relay.ts";

// 다시 보낸 open을 알아보는 key 수(전체).
const OPEN_KEYS_MAX = 200;

type OpenRequest = {
  kind: "coding_open";
  payload: {
    project: string;
    harness: string;
    resume?: { session: string; cli_session: string };
  };
};

// shell이 터미널에 `--resume <id>`로 치는 글자다(`coding_open` payload와 같은 규칙).
const CLI_SESSION = /^[A-Za-z0-9._-]{1,200}$/;

export type CodingOpenDeps = {
  // 연결 요청(`HostQueue.callCoding`). 연결이 없거나 닫히거나 기한(60초)이 지나면 unavailable이다.
  call(request: OpenRequest): Promise<Result<unknown>>;
  // ledger session. harness는 harness agent session이면 그 adapter id(`claude`), 아니면 null이다. 없으면 undefined.
  session(session: string):
    | {
        project: string | null;
        harness: string | null;
        cli_session: string | null;
      }
    | undefined;
  // host가 보고한 지금 터미널의 coding agent(`CodingRelay.list`).
  listed(): readonly { harness: string; cli_session: string | null }[];
  // TUI hold를 건다(`HarnessHold.open`). TUI로 열려 있거나 headless turn이 돌면 conflict다. 통과하면 여는 동안 headless turn이 시작하지 않는다.
  hold(session: string): Result<unknown>;
  attached(): boolean;
  // shell을 띄운다(`HostQueue.startShell`). 띄울 길이 없으면(앱이 띄운 core가 아니다) 없다. 앞선 실패 뒤 쉬는 중이면 false다.
  startShell?: () => boolean;
};

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

// host의 답은 JSON `{"terminal_ref":"…"}` 글 하나다.
function terminalOf(content: unknown): string | null {
  const first = Array.isArray(content) ? content[0] : undefined;
  if (first?.type !== "text") return null;
  try {
    const ref = (JSON.parse(first.text) as { terminal_ref?: unknown })
      .terminal_ref;
    return typeof ref === "string" && ref.startsWith("trm_") ? ref : null;
  } catch {
    return null;
  }
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
        message: `${input.harness} cannot open as chat; use one of: claude, codex, opencode, omp.`,
      });
    }
    let resume: { session: string; cli_session: string } | undefined;
    if (input.resume !== undefined) {
      const found = resumable({ ...input, resume: input.resume });
      if (!found.ok) return found;
      resume = found.value;
    }
    const done = await deps.call({
      kind: "coding_open",
      payload: {
        project: input.project,
        harness: input.harness,
        ...(resume === undefined ? {} : { resume }),
      },
    });
    if (!done.ok) return err(passed(done.error));
    const terminal = terminalOf(done.value);
    return terminal === null
      ? unavailable("The lophn app answered without a terminal.")
      : ok({ session: guiSessionId(terminal) });
  }

  return {
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

    wake(): Result<{ shell: "attached" | "starting" }> {
      if (deps.attached()) return ok({ shell: "attached" });
      if (deps.startShell === undefined) {
        return unavailable(
          "This lophn cannot start the app on the computer. Open lophn on the computer.",
        );
      }
      return deps.startShell()
        ? ok({ shell: "starting" })
        : unavailable(
            "The lophn app on the computer did not start. Open lophn on the computer.",
          );
    },
  };
}

export type CodingOpen = ReturnType<typeof createCodingOpen>;
