// agent의 sign_in 입력 요청을 끝내는 로그인 흐름. 흐름은 Settings·앱 상세와 같은 것(settings/sign-in.ts, signInMcpServer)이고
// 무엇에 로그인하는지는 core가 요청에서 읽어 준 view의 target이다(agent가 적은 글이 아니다). browser 로그인과 desktop 설정 통로를
// 끌어 desktop 창만 factory에 준다(`coreAgentTabSourceFactory`의 `signIn`). 주지 않는 창(폰 앱)의 source에는 로그인이 없다.
import { ERROR_CODES } from "../../../base/mod.ts";
import {
  inputRequestDone,
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
import type { Target } from "./agent-tab-core-source-request.ts";
import type { SourceResult } from "./agent-tab-source.ts";

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
