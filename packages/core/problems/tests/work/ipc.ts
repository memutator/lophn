import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  TEST_OBSERVATION_FRAME_MAX_BYTES,
  type TestObservationFrame,
  testObservationFrameSchema,
} from "../../../../protocol/problems/mod.ts";
import { RUNNER_LIMITS } from "./limits.ts";

const BAD = "관측 frame을 받지 않는다";

export type ObservationSide = TestObservationFrame["side"];

export type SideObservations = {
  frames: TestObservationFrame[];
  bytes: number;
  over: boolean;
};

export function emptySides(): Record<ObservationSide, SideObservations> {
  return {
    single: { frames: [], bytes: 0, over: false },
    before: { frames: [], bytes: 0, over: false },
    after: { frames: [], bytes: 0, over: false },
  };
}

// private IPC JSON. frame 65,536 bytes, side 합 1,048,576 bytes를 넘기면
// 그 side는 inconclusive다(problems/tests#R19). stdout 문자열은 여기 들어오지 않는다.
export function acceptFrame(
  sides: Record<ObservationSide, SideObservations>,
  bytes: Uint8Array,
): Result<TestObservationFrame> {
  if (bytes.byteLength > TEST_OBSERVATION_FRAME_MAX_BYTES) {
    return err({ code: "invalid_input", message: BAD });
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err({ code: "invalid_input", message: BAD });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({ code: "invalid_input", message: BAD });
  }
  const frame = testObservationFrameSchema.safeParse(parsed);
  if (!frame.success) return err({ code: "invalid_input", message: BAD });
  const side = sides[frame.data.side];
  const next = side.bytes + bytes.byteLength;
  if (next > RUNNER_LIMITS.side_bytes) {
    side.over = true;
    return err({ code: "invalid_input", message: BAD });
  }
  side.bytes = next;
  side.frames.push(frame.data);
  return ok(frame.data);
}

// side와 고정 test hash가 다르거나 frame이 없으면 inconclusive다.
export function sideVerdict(
  side: SideObservations,
  testHash: string,
): "ok" | "inconclusive" {
  if (side.over || side.frames.length === 0) return "inconclusive";
  if (side.frames.some((frame) => frame.test_hash !== testHash)) {
    return "inconclusive";
  }
  return "ok";
}
