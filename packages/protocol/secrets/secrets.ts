import { z } from "zod";
import { authenticatedContextSchema } from "../server/identity.ts";

// 용도는 core가 `secrets.json` 이름의 앞머리로 정한다(core/secrets/file-attach.ts). 앱 secret은 앱 grant가 판정한다.
const SECRET_PURPOSES = [
  "app_secret",
  "provider_credential",
  "external_mcp_credential",
] as const;
export type SecretPurpose = (typeof SECRET_PURPOSES)[number];

// 이름은 `secrets.json`의 key다. 앞머리(`provider.`, `mcp.`, `mcp-oauth.`, `login.`)가 이름 공간이다.
// `app-oauth.`는 앱 OAuth의 갱신 token·meta·client이고 어디로도 보내지 않는다.
export const secretNameSchema = z.string().regex(/^[A-Za-z0-9_.:-]+$/);

// 일반 caller의 credential을 빌려 secret 경계를 넓히지 않는다.
export const secretAdapterContextSchema = authenticatedContextSchema.refine(
  (context) =>
    context.actor === "machine" &&
    context.conditions.process !== undefined &&
    context.conditions.task !== undefined,
  { message: "secret adapter requires a machine process and task" },
);
export const secretDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("https"),
    origin: z.url().refine(
      (value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.origin === value &&
          url.username === "" &&
          url.password === ""
        );
      },
      { message: "destination must be a fixed HTTPS origin" },
    ),
  }),
  // 같은 기계의 loopback 목적지(127.0.0.1, ::1, localhost)의 HTTP origin이다. 값이 이 기계 밖으로
  // 나가지 않는 로컬 model 서버(Ollama·LM Studio·llama.cpp)에 쓴다. HTTPS 목적지와 같은 취급이
  // 아니다: kind가 달라 서로 대신하지 못한다.
  z.strictObject({
    kind: z.literal("loopback_http"),
    origin: z.url().refine(
      (value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          url.protocol === "http:" &&
          url.origin === value &&
          url.username === "" &&
          url.password === "" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
        );
      },
      { message: "destination must be a fixed loopback HTTP origin" },
    ),
  }),
]);
export type SecretDestination = z.infer<typeof secretDestinationSchema>;

// URL이 credential을 받을 수 있는 고정 목적지. HTTPS origin이거나 같은 기계의 loopback HTTP origin이고 그 밖
// (LAN·공개 주소의 HTTP, userinfo가 든 주소, 모르는 형식)은 없다. provider endpoint와 MCP 서버 URL이 같이 쓴다.
export function secretDestinationOf(
  endpoint: string,
): SecretDestination | undefined {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.protocol === "https:") return { kind: "https", origin: url.origin };
  if (
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
  ) {
    return { kind: "loopback_http", origin: url.origin };
  }
  return undefined;
}

// 원값은 JSON payload가 아니라 callback 메모리 인자다. pipe schema에는 없다.
export type SecretValue = Uint8Array | string;

export type SecretSendOutput = { sent: boolean };

// 공개 HTTP route가 아니다. supervision worker envelope의 op로만 부른다.
export const SECRET_SEND_OP = "secret.send";

// 보호 입력 창이 `secrets/put`으로 올리는 값의 상한이다.
export const SECRET_INPUT_MAX_BYTES = 64 * 1024;
