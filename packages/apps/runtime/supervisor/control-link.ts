// core ↔ supervisor 제어. platform pipe의 길이 prefix frame 위다.
// core 연결 EOF면 supervisor가 새 호출을 닫고 자식을 끝낸다.
import { z } from "zod";
import { encodeFrame, FrameDecoder } from "../../../contracts/platform/mod.ts";
import type { Supervisor } from "./supervisor.ts";
import { LIMIT_KEYS } from "../../permissions/mod.ts";
import type { DesiredApp } from "./supervisor.ts";

export type ControlReader = {
  read(buffer: Uint8Array): Promise<number | null>;
};

// 부모 → supervisor 제어 메시지. credential은 hello 한 번으로만 온다.
export type ControlMessage =
  | { type: "hello"; credential: string; verify_key: string }
  | { type: "reconcile"; desired: DesiredApp }
  | { type: "stop" };

const desiredSchema = z.strictObject({
  app: z.string().min(1),
  release: z.string().min(1),
  bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
  runEnabled: z.boolean(),
  archived: z.boolean(),
  commands: z.array(z.string().min(1)),
  dataSchema: z.number().int().nonnegative(),
  flags: z.strictObject({
    args: z.array(z.string()),
    limits: z.array(z.enum(LIMIT_KEYS)),
  }),
  entry: z.string().min(1),
  importMap: z.string().min(1),
  dataPath: z.string().min(1),
});

function parse(payload: unknown): ControlMessage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = payload as Record<string, unknown>;
  if (value.type === "hello") {
    if (
      typeof value.credential !== "string" ||
      typeof value.verify_key !== "string"
    ) {
      return undefined;
    }
    return {
      type: "hello",
      credential: value.credential,
      verify_key: value.verify_key,
    };
  }
  if (value.type === "reconcile") {
    const desired = desiredSchema.safeParse(value.desired);
    if (!desired.success) return undefined;
    return { type: "reconcile", desired: desired.data };
  }
  if (value.type === "stop") return { type: "stop" };
  return undefined;
}

export type ControlLink = {
  credential: () => string | undefined;
  verifyKey: () => string | undefined;
  closed: Promise<void>;
};

// stdin을 읽어 supervisor에 반영한다. EOF면 coreClosed를 부른다.
export function attachControlLink(
  supervisor: Supervisor,
  input: ControlReader,
  onHello?: (hello: { credential: string; verifyKey: string }) => void,
): ControlLink {
  let credential: string | undefined;
  let verifyKey: string | undefined;
  let greeted = false;
  const frames = new FrameDecoder();
  const closed = (async () => {
    const buffer = new Uint8Array(64 * 1024);
    try {
      while (true) {
        const count = await input.read(buffer);
        if (count === null) break;
        for (const frame of frames.push(buffer.subarray(0, count))) {
          if (frame.kind !== "json") continue;
          const message = parse(frame.payload);
          if (!message) continue;
          if (message.type === "hello") {
            // credential은 한 번만 온다. 두 번째 hello는 protocol 위반이다.
            if (greeted) throw new Error("second hello");
            greeted = true;
            credential = message.credential;
            verifyKey = message.verify_key;
            onHello?.({ credential, verifyKey });
          } else if (message.type === "reconcile") {
            await supervisor.reconcile(message.desired);
          } else {
            await supervisor.stop();
          }
        }
      }
    } catch {
      // frame 오류·protocol 위반도 core가 끊긴 것과 같이 자식을 끝낸다.
    }
    await supervisor.coreClosed();
  })();
  return {
    credential: () => credential,
    verifyKey: () => verifyKey,
    closed,
  };
}

export function encodeControl(message: ControlMessage): Uint8Array {
  return encodeFrame({ kind: "json", channel: 0, payload: message });
}
