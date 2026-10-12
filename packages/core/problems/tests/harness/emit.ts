import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  TEST_OBSERVATION_FRAME_MAX_BYTES,
  TEST_OBSERVATION_SIDE_MAX_BYTES,
  type TestObservationFrame,
  testObservationFrameSchema,
} from "../../../../protocol/problems/mod.ts";

export type FrameInput = Omit<TestObservationFrame, "side" | "test_hash">;

export type Emitter = {
  emit(frame: FrameInput): Result<null>;
  // 지금까지 보낸 bytes. side 합 상한 안에서 센다.
  sent(): number;
};

const encoder = new TextEncoder();

// side와 고정 test hash는 harness가 붙인다. 앱 test code가 다른 side나 hash로
// frame을 만들 수 없다. frame당 65,536 bytes, side 합 1,048,576 bytes를 넘기는
// frame은 보내지 않고 거절한다(problems/tests#R19). write는 private IPC 쪽이다.
export function createEmitter(options: {
  side: TestObservationFrame["side"];
  test_hash: string;
  write: (bytes: Uint8Array) => void;
}): Emitter {
  let total = 0;
  return {
    emit(frame) {
      const full = {
        ...frame,
        side: options.side,
        test_hash: options.test_hash,
      };
      const parsed = testObservationFrameSchema.safeParse(full);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "관측 frame이 올바르지 않다",
        });
      }
      const bytes = encoder.encode(JSON.stringify(parsed.data));
      if (
        bytes.byteLength > TEST_OBSERVATION_FRAME_MAX_BYTES ||
        total + bytes.byteLength > TEST_OBSERVATION_SIDE_MAX_BYTES
      ) {
        return err({
          code: "invalid_input",
          message: "관측 frame이 한도를 넘는다",
        });
      }
      total += bytes.byteLength;
      options.write(bytes);
      return ok(null);
    },
    sent: () => total,
  };
}
