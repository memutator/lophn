import { z } from "zod";
import { errorBodySchema } from "../base/errors.ts";

// core가 폰에 묻는 요청 길의 frame. 아직 remote channel의 `remoteClientFrameSchema`·`remoteServerFrameSchema`에는
// 들어 있지 않다(channel에 더하는 것은 core link 쪽 일이다).
//
// 칸 이름이 `capability`가 아니라 `kind`인 까닭: 폰이 하는 일은 한 갈래다. 위치(`location.get`)로 시작하고, 이어서
// 앱을 직접 모는 `drive.*`도 같은 길에 얹는다. 그래서 frame은 그대로 두고 kind만 더한다(`kinds.ts`의 `PHONE_KINDS`).
// 앱 쪽 이름 `capability`(grant 범위, SDK)는 앱에 열어 준 kind만 가리킨다(`apps/phone-request.ts`).
//
// bytes 규칙: frame은 JSON뿐이다. 응답이 bytes(예 screenshot)를 실으면 `value` 안의 `*_base64` 문자열 칸에 base64로 싣고,
// 원래 bytes는 `PHONE_RESPONSE_BYTES_MAX` 안이다. base64가 되어도(4/3배) frame 하나(`REMOTE_FRAME_MAX_BYTES`, 16 MiB)에 든다.
// kind 정의는 자기 상한을 이것 이하로 적는다.
//
// 규칙:
// - 폰은 답할 수 있는 kind를 `hello.capabilities`에 적는다. core는 거기 없는 kind를 묻지 않는다. 그래서 옛 폰은 `request`를
//   받지 않고, `REMOTE_PROTOCOL_VERSION`은 그대로다.
// - 폰은 받은 `request`마다 같은 `id`의 `response` 하나를 보낸다.
// - deadline이 지난 답과 모르는 `id`의 답은 core가 버린다.
// - 폰을 깨우지 않는다. 연결이 열려 있고 앱이 활성일 때만 답한다(아니면 `unavailable`).

export const PHONE_KIND_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const PHONE_KIND_MAX = 64;
export const phoneKindSchema = z
  .string()
  .max(PHONE_KIND_MAX)
  .regex(PHONE_KIND_PATTERN);

export const PHONE_RESPONSE_BYTES_MAX = 8 * 1024 * 1024;

const phoneFrameIdSchema = z.string().min(1).max(64);

// core → 폰. input은 kind의 입력(`PHONE_KINDS[kind].input`)이다. core가 보내기 전에 검사한다.
export const phoneRequestFrameSchema = z.strictObject({
  type: z.literal("request"),
  id: phoneFrameIdSchema,
  kind: phoneKindSchema,
  input: z.unknown(),
  deadline_ms: z.number().int().min(1000).max(60_000),
});
export type PhoneRequestFrame = z.infer<typeof phoneRequestFrameSchema>;

// 폰 → core. `result` frame과 같이 ok로 가른다.
export const phoneResponseFrameSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("response"),
    id: phoneFrameIdSchema,
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("response"),
    id: phoneFrameIdSchema,
    ok: z.literal(false),
    error: errorBodySchema.shape.error,
  }),
]);
export type PhoneResponseFrame = z.infer<typeof phoneResponseFrameSchema>;
