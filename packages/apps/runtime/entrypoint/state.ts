// 프로세스 수명의 호출 상태. entry가 만들어 넘긴다.
import type { Clock, IdSource } from "@lophn/base";
import type { Blueprint } from "../../blueprint/mod.ts";
import { gateClock } from "./clock-gate.ts";
import { CONFIRM_MARKER_LIMIT } from "./limits.ts";
import type { BrokerClient } from "./broker-client.ts";
import type { ProcessIdentity } from "./verify.ts";
import type { VerifyKey } from "./signature.ts";
import type { InvocationCaller, Json } from "./wire.ts";

export type InvocationProgress = "running" | "succeeded" | "failed" | "unknown";

export type InvocationRecord = {
  id: string;
  requestKey: string;
  command: string;
  effect: "read" | "write" | "external";
  caller: InvocationCaller;
  progress: InvocationProgress;
  result?: Json;
  recorded: boolean;
};

export type ViewSession = {
  id: string;
  screen: string;
  size: "full" | "panel" | "card";
};

export type RuntimeState = {
  identity: ProcessIdentity;
  blueprint: Blueprint;
  key: VerifyKey;
  clock: Clock;
  // 업무 시각. 준비 모드에서는 닫혀 있고, 연결 만료 비교는 clock을 쓴다.
  businessClock: Clock;
  ids: IdSource;
  broker: BrokerClient;
  dataSchema: number;
  directSocket: string;
  ready: boolean;
  accepting: boolean;
  closed: boolean;
  invocations: Map<string, InvocationRecord>;
  byRequest: Map<string, string>;
  markers: Set<string>;
  views: Map<string, ViewSession>;
  screenBytes: (screen: string, path: string) => Uint8Array | undefined;
  contentType: (path: string) => string;
};

export function createRuntimeState(input: {
  identity: ProcessIdentity;
  blueprint: Blueprint;
  key: VerifyKey;
  clock: Clock;
  ids: IdSource;
  broker: BrokerClient;
  dataSchema: number;
  directSocket: string;
  screenBytes?: (screen: string, path: string) => Uint8Array | undefined;
  contentType?: (path: string) => string;
}): RuntimeState {
  const state: RuntimeState = {
    ...input,
    businessClock: input.clock,
    ready: false,
    accepting: false,
    closed: false,
    invocations: new Map(),
    byRequest: new Map(),
    markers: new Set(),
    views: new Map(),
    screenBytes: input.screenBytes ?? (() => undefined),
    contentType: input.contentType ??
      ((path) =>
        path.endsWith(".js") ? "text/javascript" : "application/octet-stream"),
  };
  state.businessClock = gateClock(input.clock, () => state.accepting);
  return state;
}

export function markerFull(state: RuntimeState): boolean {
  return state.markers.size >= CONFIRM_MARKER_LIMIT;
}
