import {
  type AppResult,
  failed,
  failure,
  host,
  plain,
  type PortResponse,
} from "./connect.ts";
import { currentContext, handle } from "./handlers.ts";

// 앱 event. 일이 일어난 뒤의 알림이다: 한 번 전달되고 저장되지 않으며, 그 순간 켜져 있는 구독 앱만 받는다.
// 발행은 core를 거치고(broker), core가 선언한 event인지와 payload를 검사한다. broker 경로는
// protocol/apps/events.ts·core의 broker server와 같다(SDK는 protocol을 import하지 않는다).
const EVENTS_PUBLISH_PATH = "/_lophn/broker/events/publish";

export type PublishOutput = {
  // preview·test에서는 core에 가지 않아 null이고 standIn이 true다.
  publication: string | null;
  // 구독을 선언했고 그 순간 켜져 있던 앱 수. 호출을 넘긴 뒤의 거절이나 실패는 반영되지 않는다.
  reachable: number;
  // 구독을 선언했지만 켜져 있지 않아 받지 못한 앱 수.
  unreachable: number;
  // reachable 가운데 event 고리나 깊이 한도 때문에 호출을 넘기지 않은 앱 수.
  refused: number;
  standIn?: true;
};

// 구독 handler의 이름이다. 선언의 `subscriptions`가 같은 규칙으로 이름을 정한다(protocol/apps/declaration의 subscriptionHandlerName).
function subscriptionHandlerName(source: string, event: string): string {
  return `on.${source}.${event}`;
}

// 선언한 구독의 handler를 등록한다. `source`는 event를 낸 앱의 slug이거나 lophn의 `"lophn"`이다. handler는 payload를 받고
// 반환값은 쓰이지 않는다. 같은 구독을 두 번 등록하면 던진다. 선언하지 않은 구독의 handler는 앱이 시작하지 못하게 한다.
export function subscribe<Payload = unknown>(
  source: string,
  event: string,
  handler: (payload: Payload) => Promise<void> | void,
): void {
  handle(subscriptionHandlerName(source, event), async (payload) => {
    await handler(payload as Payload);
    return null;
  });
}

// event를 낸다. 선언하지 않은 event나 선언한 schema와 맞지 않는 payload는 `invalid_input`이다. 구독자의 답을 기다리지 않는다.
// 부모 invocation이 돌고 있지 않아도 된다(시작 코드와 timer에서도 낸다).
export async function publish(
  name: string,
  payload: unknown,
): Promise<AppResult<PublishOutput>> {
  const port = host();
  if (port === undefined) return failure("events are not available");
  if (port.mode !== undefined && port.mode !== "live") {
    return {
      ok: true,
      value: {
        publication: null,
        reachable: 0,
        unreachable: 0,
        refused: 0,
        standIn: true,
      },
    };
  }
  let response: PortResponse;
  try {
    response = await port.post(EVENTS_PUBLISH_PATH, {
      event: name,
      payload,
      parent_invocation: currentContext()?.invocation ?? null,
    });
  } catch {
    return failure("publish could not reach the broker");
  }
  if (response.status !== 200) return failed(response);
  const body = plain(response.body);
  if (
    typeof body?.["publication"] !== "string" ||
    typeof body["reachable"] !== "number" ||
    typeof body["unreachable"] !== "number" ||
    typeof body["refused"] !== "number"
  ) {
    return failure("response did not match");
  }
  return {
    ok: true,
    value: {
      publication: body["publication"],
      reachable: body["reachable"],
      unreachable: body["unreachable"],
      refused: body["refused"],
    },
  };
}
