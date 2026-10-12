// 앱 runtime entrypoint와 supervisor 쪽 broker·전달 목록을 잇는 시험 준비다. 실제 core로 가는 sender만 시험이
// 넣고, 응답은 전달을 기다리지 않는다. 다른 leaf의 fixture를 쓰므로 `*_test.ts`에 둔다.
import {
  createIdSource,
  type ManualClock,
  seededRandom,
} from "../../../base/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import {
  createSupervisorDelivery,
  type SupervisorDelivery,
} from "../../../../apps/app-supervisor/delivery.ts";
import type { BrokerChild } from "../permissions/mod.ts";
import type { CoreSigner } from "../runtime/mod.ts";
import {
  APP,
  type AppConnection,
  type BrokerTransport,
  connection,
  handleInvoke,
  installHandlers,
  NONCE,
  REL,
  shaKey,
  startLine,
  startRuntime,
} from "../runtime/testing/mod.ts";
import type {
  DeliveryLimits,
  DeliveryMessage,
  DeliveryOutcome,
} from "./mod.ts";
import { fixtureBlueprint } from "./testing/mod.ts";

export { APP, connection, installHandlers, NONCE, REL };

const ALL_COMMANDS = ["usage.read", "usage.save", "usage.sync", "usage.purge"];

// 앱 runtime이 broker socket으로 보내는 요청을 supervisor 쪽 broker가 받게 잇는다.
export function brokerTransport(
  delivery: SupervisorDelivery,
  child: BrokerChild,
): BrokerTransport {
  return (request) => {
    const result = delivery.broker.submit(child, request.body);
    return Promise.resolve(
      result.ok
        ? { status: 200, body: result.value }
        : { status: 400, body: { error: result.error } },
    );
  };
}

export type RuntimeWorld = {
  delivery: SupervisorDelivery;
  state: ReturnType<typeof startRuntime>["state"];
  frames: Uint8Array[];
  invoke(
    body: Record<string, unknown>,
    over?: Record<string, unknown>,
  ): ReturnType<typeof handleInvoke>;
  // direct socket의 cancel·status 같은 다른 경로를 같은 연결로 부른다.
  call(
    path: string,
    body: Record<string, unknown>,
    over?: Record<string, unknown>,
  ): ReturnType<typeof handleInvoke>;
};

// 앱 runtime 하나와 그 broker·전달 목록. 응답은 전달을 기다리지 않는다.
export function openRuntimeWorld(deps: {
  clock: ManualClock;
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>;
  blueprint?: Blueprint;
  limits?: DeliveryLimits;
  // 실제 Ed25519 key로 proof 서명을 검증한다. 없으면 시험용 hash 서명이다.
  signer?: CoreSigner;
  directSocket?: string;
  mode?: "live";
}): RuntimeWorld {
  const frames: Uint8Array[] = [];
  const delivery = createSupervisorDelivery({
    clock: deps.clock,
    send: deps.send,
    write: (frame) => frames.push(frame),
    limits: deps.limits,
    // 시험이 clock과 pump를 직접 다룬다.
    setTimer: () => 0,
    clearTimer: () => {},
  });
  const child: BrokerChild = {
    app: APP,
    release: REL,
    mode: "live",
    processNonce: NONCE,
  };
  const started = startRuntime({
    line: startLine({
      ...(deps.signer ? { verify_key: deps.signer.verifyKey } : {}),
      ...(deps.directSocket ? { direct_socket: deps.directSocket } : {}),
    }),
    blueprint: deps.blueprint ?? fixtureBlueprint(),
    ...(deps.signer ? {} : { key: shaKey() }),
    clock: deps.clock,
    ids: createIdSource({ clock: deps.clock, random: seededRandom(11) }),
    broker: brokerTransport(delivery, child),
    dataSchema: 0,
  });
  started.state.accepting = true;
  return {
    delivery,
    state: started.state,
    frames,
    invoke(body, over = {}) {
      return this.call("/_lophn/commands/invoke", body, over);
    },
    call(path, body, over = {}) {
      return handleInvoke(
        started.state,
        path,
        new TextEncoder().encode(JSON.stringify(body)),
        connection({ commands: ALL_COMMANDS, ...over }) as AppConnection,
      );
    },
  };
}
