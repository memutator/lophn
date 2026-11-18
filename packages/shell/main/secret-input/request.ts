// agent의 입력 요청(card)을 보호 창에서 끝낸다.
// - login save는 login metadata와 값(password·TOTP)을 저장하고, once는 값을 core에 "알려진 값"으로만 올린 뒤 ref 칸에 바로 친다.
// - secret은 값을 core `input_request/answer_secret`으로 올린다. core가 자리에서 정한 이름에 넣고 새 provider 자리면 잇고
//   요청을 끝낸다.
// 값은 agent 결과(`done`)에 싣지 않는다.
// 값, core 오류 원문, OS 오류 원문은 log·오류·IPC 결과 어디에도 넣지 않는다.
import { ERROR_CODES } from "../../../base/mod.ts";
import {
  type SecretInputSubmit,
  type SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";
import {
  inputRequestViewSchema,
  type LoginRequestView,
  type SecretRequestView,
} from "../../../protocol/lophn-agent/input-request.ts";
import { loginSecretName } from "../../../protocol/secrets/logins.ts";
import { answerSecret, type SecretCore, submitSecret } from "./submit.ts";

type CoreReply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string } };

/** 요청을 읽고 끝내는 main 안 core 통로. renderer allowlist를 거치지 않는다. */
export interface RequestCore extends SecretCore {
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CoreReply>;
}

/** 한 번 넣기가 ref 칸에 치는 통로(browser driver의 typeOnce). 오류가 있으면 치지 않았거나 치다 멈춘 것이다. */
export type OnceTyper = (input: {
  tab: string;
  view: "browser" | "preview" | "artifact";
  ref: string;
  origin: string;
  value: string;
}) => Promise<{ error: { code: string; message: string } } | object>;

export type RequestTarget = { session: string; tool_call: string };
type OpenLogin = RequestTarget & Omit<LoginRequestView, "group">;
type OpenSecret = RequestTarget & Omit<SecretRequestView, "group">;
export type OpenRequest = OpenLogin | OpenSecret;

/** 열린 요청을 core에서 읽는다. login의 origin은 요청 때 shell main이 잰 값이고 secret의 이름·목적지는 core가 자리에서 읽은 값이다. */
export async function readRequest(
  core: RequestCore,
  target: RequestTarget,
): Promise<{ ok: true; value: OpenRequest } | { ok: false }> {
  const read = await core
    .internal("memory", "input_request", "read", target)
    .catch(() => null);
  if (read === null || !read.ok) return { ok: false };
  const parsed = inputRequestViewSchema.safeParse(read.value);
  // sign_in 요청은 보호 창이 아니라 card의 로그인 흐름이 끝낸다.
  if (!parsed.success || parsed.data.kind === "sign_in") return { ok: false };
  const { group: _group, ...view } = parsed.data;
  return { ok: true, value: { ...target, ...view } as OpenRequest };
}

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

async function done(
  core: RequestCore,
  target: RequestTarget,
  result: unknown,
): Promise<void> {
  // 요청이 이미 풀렸으면(turn 끝, Cancel) 실패한다. 할 일이 없다.
  await core
    .internal("memory", "input_request", "done", {
      session: target.session,
      tool_call: target.tool_call,
      result,
    })
    .catch(() => null);
}

async function saveLogin(
  core: RequestCore,
  request: OpenLogin,
  login: Extract<SecretInputSubmit, { login: unknown }>["login"],
): Promise<SecretInputSubmitReply> {
  const saved = await core
    .internal("memory", "logins", "save", {
      label: login.label,
      origin: request.origin,
      username: login.username,
    })
    .catch(() => null);
  if (saved === null || !saved.ok) {
    return saved?.ok === false && saved.error.code === "invalid_input"
      ? { ok: false, code: "invalid_input" }
      : UNAVAILABLE;
  }
  const { id } = saved.value as { id: string };
  const values: [string, string][] = [
    [loginSecretName(id, "password"), login.password],
    ...(login.totp === undefined
      ? []
      : ([[loginSecretName(id, "totp"), login.totp]] as [string, string][])),
  ];
  for (const [name, value] of values) {
    const put = await submitSecret(core, { name, value });
    if (!put.ok) {
      // 값이 빠진 login을 남기지 않는다. 지우기가 실패해도 사람이 Settings에서 지울 수 있다.
      await core
        .internal("memory", "logins", "delete", { id })
        .catch(() => null);
      return put;
    }
  }
  await done(core, request, { login: id });
  return { ok: true };
}

async function typeOnce(
  core: RequestCore,
  typer: OnceTyper,
  request: OpenLogin,
  value: string,
): Promise<SecretInputSubmitReply> {
  // 값을 알려진 값으로 올린 뒤에 친다: 친 뒤 snapshot이나 결과에 값이 비쳐도 지워진다. 파일에는 쓰지 않는다.
  const held = await core
    .internal("memory", "input_request", "hold", {
      session: request.session,
      tool_call: request.tool_call,
      value,
    })
    .catch(() => null);
  if (held === null || !held.ok) return UNAVAILABLE;
  const typed = await typer({
    tab: request.tab,
    view: request.view,
    ref: request.ref,
    origin: request.origin,
    value,
  }).catch(() => null);
  if (typed !== null && "error" in typed) {
    await done(core, request, {
      error: {
        code: (ERROR_CODES as readonly string[]).includes(typed.error.code)
          ? typed.error.code
          : "internal",
        message: typed.error.message.slice(0, 500),
      },
    });
    return { ok: true };
  }
  if (typed === null) {
    await done(core, request, {
      error: { code: "unavailable", message: "typing the value failed" },
    });
    return { ok: true };
  }
  await done(core, request, { filled: true });
  return { ok: true };
}

/** 보호 창의 제출을 요청 종류와 mode대로 끝낸다. 맞지 않는 모양은 invalid_input이다. */
export async function submitRequest(
  core: RequestCore,
  typer: OnceTyper | undefined,
  request: OpenRequest,
  input: SecretInputSubmit,
): Promise<SecretInputSubmitReply> {
  try {
    if (request.kind === "secret") {
      return "value" in input
        ? await answerSecret(core, request, input.value)
        : { ok: false, code: "invalid_input" };
    }
    if (request.mode === "save") {
      return "login" in input
        ? await saveLogin(core, request, input.login)
        : { ok: false, code: "invalid_input" };
    }
    if (!("value" in input)) return { ok: false, code: "invalid_input" };
    return typer === undefined
      ? UNAVAILABLE
      : await typeOnce(core, typer, request, input.value);
  } catch {
    return UNAVAILABLE;
  }
}
