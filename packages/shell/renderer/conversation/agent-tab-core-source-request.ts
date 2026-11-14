// agent의 입력 요청 card가 읽고 접고 로그인하는 route. 보호 창을 여는 것은 card의 [Enter]가 shell main에 보내는 IPC다.
// sign_in 요청은 창이 아니라 이 로그인 흐름이 끝낸다: 흐름은 Settings·앱 상세와 같은 것(settings/sign-in.ts,
// signInMcpServer)이고 무엇에 로그인하는지는 core가 요청에서 읽어 준 view의 target이다(agent가 적은 글이 아니다).
import { ERROR_CODES } from "../../../base/mod.ts";
import {
  inputRequestCancel,
  inputRequestDone,
  inputRequestRead,
  type InputRequestView,
  type SignInRequestView,
} from "../../../protocol/lophn-agent/input-request.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import { windowLinkOpener } from "../desktop/settings/core-call.ts";
import {
  signInApp,
  signInProvider,
  type SignInProgress,
  timerWait,
} from "../desktop/settings/sign-in.ts";
import { createLink } from "../workspace/agents/core-link.ts";
import {
  cancelMcpSignIn,
  signInMcpServer,
} from "../workspace/agents/core-extensions.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";
import type { SourceResult } from "./agent-tab-source.ts";

type Target = { session: string; toolCall: string };

export function readInputRequest(
  env: Env,
  input: Target,
): Promise<SourceResult<InputRequestView>> {
  return env.read(inputRequestRead, {
    session: input.session,
    tool_call: input.toolCall,
  });
}

export async function cancelInputRequest(
  env: Env,
  input: Target,
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(inputRequestCancel, {
      session: input.session,
      tool_call: input.toolCall,
    }),
  );
}

const random = () => crypto.randomUUID().slice(0, 8);

/**
 * view의 로그인 흐름을 끝까지 돌리고 결과를 core에 알린다(signed_in이나 오류 code). 사람이 그만두면(signal) 결과를 알리지
 * 않고 `cancelled`를 돌려준다: card가 요청을 접는다.
 */
export async function signInInputRequest(
  core: CoreSource,
  env: Env,
  input: Target & {
    view: SignInRequestView;
    events: EventClient | null;
    progress: SignInProgress;
  },
): Promise<SourceResult<void>> {
  const { target } = input.view;
  const { signal } = input.progress;
  const openLink = windowLinkOpener();
  const flow = { openLink, random, wait: timerWait };
  let outcome: SourceResult<null>;
  if (target.type === "provider") {
    outcome = await signInProvider(core, flow, target.login, input.progress);
  } else if (target.type === "app") {
    outcome =
      input.events === null
        ? { ok: false, code: "unavailable" }
        : await signInApp(
            input.events,
            openLink,
            target.app,
            target.name,
            signal,
          );
  } else {
    const link = createLink(core, random);
    const server = {
      name: target.begin.name,
      login: {
        workspace: target.begin.workspace,
        agent: target.begin.agent,
        client_id: target.begin.client_id,
        scopes: target.begin.scopes,
      },
    };
    // complete는 사람이 돌아올 때까지 기다리므로 그만두면 기다리는 로그인을 닫아 끝나게 한다.
    const stop = () => void cancelMcpSignIn(link, server);
    signal.addEventListener("abort", stop, { once: true });
    const done = await signInMcpServer(link, openLink, server);
    signal.removeEventListener("abort", stop);
    outcome = done.ok
      ? { ok: true, value: null }
      : { ok: false, code: done.message };
  }
  if (signal.aborted) return { ok: false, code: "cancelled" };
  const finished = await env.read(inputRequestDone, {
    session: input.session,
    tool_call: input.toolCall,
    result: outcome.ok
      ? { signed_in: true }
      : {
          error: {
            code: (ERROR_CODES as readonly string[]).includes(outcome.code)
              ? outcome.code
              : "internal",
            message: "The sign-in did not finish.",
          },
        },
  } as never);
  return dropValue(finished);
}
