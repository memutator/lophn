// writer Worker 메모리에만 있는 값. 감지 결과와 Settings 기본은 main thread가 command로 알려 주고,
// 터미널 요청은 결과가 돌아올 때 무엇을 보냈는지 알아야 해서 둔다. 잃어도 session은 exit으로 끝난다.
import type {
  CodingOptions,
  HarnessId,
} from "../../../protocol/coding-agent/harness-id.ts";
import type { HarnessDetection } from "../../../protocol/coding-agent/harnesses.ts";

type PendingRequest =
  | { kind: "open"; session: string }
  | {
      kind: "input";
      session: string;
      text: string;
      call: string | null;
    }
  | { kind: "stop"; session: string };

export type CodingMemory = {
  detections: Map<HarnessId, HarnessDetection>;
  defaults: CodingOptions;
  requests: Map<string, PendingRequest>;
  request(pending: PendingRequest): string;
};

export function createCodingMemory(): CodingMemory {
  let counter = 0;
  const requests = new Map<string, PendingRequest>();
  return {
    detections: new Map(),
    defaults: {},
    requests,
    request(pending) {
      counter += 1;
      const id = `${pending.kind}_${pending.session}_${counter}`;
      requests.set(id, pending);
      return id;
    },
  };
}
