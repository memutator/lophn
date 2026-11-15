// coding relay가 밖에 기대는 것. 구현은 core/main의 wiring/coding-relay.ts가 끼운다.
import type { Clock, Result } from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";

// host에 보내는 연결 요청이다(`HostQueue.callCoding`). 답은 host의 content나 error 그대로다.
export type CodingRequest =
  | {
      kind: "coding_input";
      payload: { session: string; input: Record<string, unknown> };
    }
  | {
      kind: "coding_switch";
      payload: { terminal_ref: string; to: "gui" | "tui" };
    };

export type CodingRelayDeps = {
  clock: Clock;
  // `AcpUpdated`와 `StateChanged`를 Bus에 낸다.
  publish(event: BusEvent): void;
  // 연결이 없거나, 닫히거나, 기한이 지나면 `unavailable`이다.
  call(request: CodingRequest): Promise<Result<unknown>>;
  // `/host-link`가 열려 있다.
  attached(): boolean;
  // 제품 redactor로 값 안의 모든 글을 거른다. 알려진 secret을 아직 다 모르면 null이다(내지 않는다).
  redact<T>(value: T): T | null;
  // core가 도는 OS(`process.platform`). shell과 같은 기계다.
  platform: string;
};
