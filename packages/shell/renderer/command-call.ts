// renderer가 core에 command를 보낼 때 봉투를 만드는 helper 하나. 봉투 정본은 protocol의 `commandRequestSchema`다.
// 화면마다 봉투를 따로 짜면 칸 하나(compare)가 빠진 것만으로 그 화면의 command가 모두 core에 닿기 전에
// `invalid_input`으로 거절된다. 그래서 봉투를 만드는 길을 여기 하나로 둔다.
import type { z } from "zod";

import type { ConfirmationRef } from "../../protocol/base/confirmation-handle.ts";
import type { CommandRoute } from "../../protocol/base/route.ts";
import type { CoreCall } from "../ipc/core.ts";

/** route가 compare를 선언하면 그 입력, 아니면 빈 객체다. */
export type CompareOf<R> = R extends {
  readonly compare?: infer C extends z.ZodType;
}
  ? z.input<C>
  : Record<string, never>;

export interface CommandBody<R extends CommandRoute> {
  readonly input: z.input<R["input"]>;
  /** compare는 기본값으로 채우지 않는다. 필요한 route에서 빠뜨리면 type이 잡는다. */
  readonly compare: CompareOf<R>;
  /** idempotency key. 같은 key로 다시 보내면 core가 이전 결과를 돌려준다. */
  readonly key: string;
  readonly confirmation?: ConfirmationRef;
}

export function commandBody<R extends CommandRoute>(
  _route: R,
  body: CommandBody<R>,
): Record<string, unknown> {
  return {
    input: body.input,
    idempotency_key: body.key,
    compare: body.compare,
    prepared: [],
    ...(body.confirmation === undefined
      ? {}
      : { confirmation: body.confirmation }),
  };
}

export function commandCall<R extends CommandRoute>(
  route: R,
  body: CommandBody<R>,
): CoreCall {
  return {
    kind: "command",
    resource: route.resource,
    method: route.method,
    body: commandBody(route, body),
  };
}
