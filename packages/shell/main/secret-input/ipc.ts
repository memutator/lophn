// 보호 입력 창 IPC 등록. 창 열기는 일반 shell 창만, 표시·제출·취소는 그 보호 창만 부른다.
// 부모는 renderer가 보낸 값이 아니라 IPC를 보낸 창이다. 열린 보호 창은 한 번에 하나다.
// 제출 입력(secret 값)은 log·오류에 넣지 않는다.
import {
  SECRET_INPUT_CANCEL_CHANNEL,
  SECRET_INPUT_DISPLAY_CHANNEL,
  SECRET_INPUT_OPEN_CHANNEL,
  SECRET_INPUT_SUBMIT_CHANNEL,
  type SecretInputDisplay,
  type SecretInputOpenReply,
  secretInputOpenSchema,
  type SecretInputSubmitReply,
  secretInputSubmitSchema,
} from "../../ipc/secret-input.ts";
import {
  type OnceTyper,
  type OpenRequest,
  readRequest,
  type RequestCore,
  submitRequest,
} from "./request.ts";
import { submitSecret } from "./submit.ts";
import {
  type OpenedSecretInput,
  openSecretInputWindow,
  type ParentWindow,
  type SecretInputHost,
} from "./window.ts";
import type { HeadlessMode } from "../desktop/headless.ts";

export interface SecretInputIpcEvent {
  readonly sender: { readonly id: number };
}

interface SecretInputIpc {
  handle(
    channel: string,
    listener: (event: SecretInputIpcEvent, input: unknown) => Promise<unknown>,
  ): void;
  removeHandler(channel: string): void;
}

interface SecretInputDeps {
  host: SecretInputHost;
  /** IPC를 보낸 webContents가 일반 shell 창 본문이면 그 창. 아니면 undefined다. */
  parentOf(event: SecretInputIpcEvent): ParentWindow | undefined;
  /** 준비된 core. 준비 전에는 null이다. */
  core(): (RequestCore & StatusCore) | null;
  /** agent의 한 번 넣기가 ref 칸에 치는 통로(browser driver). */
  typeOnce?: OnceTyper;
  preload: string;
  packaged: boolean;
  headless?: HeadlessMode;
}

/** 설정 여부만 읽는다. 값은 읽지 못한다. */
interface StatusCore {
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<
    { ok: true; value: unknown } | { ok: false; error: { code: string } }
  >;
}

interface Active {
  readonly contentsId: number;
  readonly display: SecretInputDisplay;
  /** agent의 login 요청이면 그 내용이다. 제출은 mode대로 끝난다. */
  readonly request: OpenRequest | undefined;
  readonly opened: OpenedSecretInput;
  readonly done: (result: "stored" | "cancelled" | "unavailable") => void;
  submitting: boolean;
}

async function isConfigured(core: StatusCore, name: string): Promise<boolean> {
  const got = await core.internal("memory", "secrets", "status", {
    names: [name],
  });
  if (!got.ok) return false;
  const secrets = (got.value as { secrets?: unknown }).secrets;
  return (
    Array.isArray(secrets) &&
    secrets.some(
      (one) =>
        (one as { name?: unknown; configured?: unknown }).name === name &&
        (one as { configured?: unknown }).configured === true,
    )
  );
}

export function registerSecretInputIpc(
  ipc: SecretInputIpc,
  deps: SecretInputDeps,
): void {
  let active: Active | null = null;
  // 열기를 받고 창을 만들기 전까지도 두 번째 열기를 막는다.
  let opening = false;

  ipc.handle(SECRET_INPUT_OPEN_CHANNEL, async (event, input) => {
    const parent = deps.parentOf(event);
    if (parent === undefined) {
      return { ok: false, code: "forbidden" } satisfies SecretInputOpenReply;
    }
    const parsed = secretInputOpenSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid_input",
      } satisfies SecretInputOpenReply;
    }
    if (active !== null || opening) {
      return { ok: false, code: "conflict" } satisfies SecretInputOpenReply;
    }
    const core = deps.core();
    if (core === null) {
      return {
        ok: false,
        code: "unavailable",
      } satisfies SecretInputOpenReply;
    }
    opening = true;
    try {
      // 요청 card에서 온 열기는 origin·mode를 core의 열린 요청에서 읽는다(renderer가 보낸 글이 아니다).
      let request: OpenRequest | undefined;
      let display: SecretInputDisplay;
      if ("request" in parsed.data) {
        const read = await readRequest(core, parsed.data.request);
        if (!read.ok) {
          return {
            ok: false,
            code: "invalid_input",
          } satisfies SecretInputOpenReply;
        }
        request = read.value;
        display = {
          name: "",
          purpose: "login",
          subject: request.origin,
          configured: false,
          request: { mode: request.mode, label: request.label },
        };
      } else {
        display = {
          ...parsed.data,
          configured: await isConfigured(core, parsed.data.name),
        };
      }
      return await new Promise<SecretInputOpenReply>((resolve) => {
        let finished = false;
        const shown: { opened?: OpenedSecretInput } = {};
        const done: Active["done"] = (result) => {
          if (finished) return;
          finished = true;
          active = null;
          resolve(
            result === "unavailable"
              ? { ok: false, code: "unavailable" }
              : { ok: true, result },
          );
          const window = shown.opened?.window;
          if (window !== undefined && !window.isDestroyed()) window.close();
        };
        const opened = openSecretInputWindow({
          host: deps.host,
          parent,
          preload: deps.preload,
          packaged: deps.packaged,
          // save 창은 칸이 넷이라 더 길다.
          tall: request?.mode === "save",
          ...(deps.headless === undefined ? {} : { headless: deps.headless }),
          // 사람이 창을 닫으면 그만둔 것이다.
          onClosed: () => done("cancelled"),
          onCrashed: () => done("unavailable"),
        });
        shown.opened = opened;
        active = {
          contentsId: opened.window.webContents.id,
          display,
          request,
          opened,
          done,
          submitting: false,
        };
      });
    } finally {
      opening = false;
    }
  });

  const activeOf = (event: SecretInputIpcEvent) =>
    active !== null && active.contentsId === event.sender.id ? active : null;

  ipc.handle(SECRET_INPUT_DISPLAY_CHANNEL, (event) => {
    const one = activeOf(event);
    // 보호 창이 아닌 호출은 거절한다(invoke가 실패로 끝난다).
    if (one === null) return Promise.reject(new Error("forbidden"));
    return Promise.resolve(one.display);
  });

  ipc.handle(SECRET_INPUT_SUBMIT_CHANNEL, async (event, input) => {
    const one = activeOf(event);
    if (one === null) return Promise.reject(new Error("forbidden"));
    const parsed = secretInputSubmitSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid_input",
      } satisfies SecretInputSubmitReply;
    }
    const core = deps.core();
    if (core === null || one.submitting) {
      return {
        ok: false,
        code: "unavailable",
      } satisfies SecretInputSubmitReply;
    }
    one.submitting = true;
    const reply =
      one.request !== undefined
        ? await submitRequest(core, deps.typeOnce, one.request, parsed.data)
        : "value" in parsed.data
          ? await submitSecret(core, {
              name: one.display.name,
              value: parsed.data.value,
            })
          : ({ ok: false, code: "invalid_input" } as const);
    one.submitting = false;
    if (reply.ok) one.done("stored");
    return reply;
  });

  ipc.handle(SECRET_INPUT_CANCEL_CHANNEL, (event) => {
    const one = activeOf(event);
    if (one === null) return Promise.reject(new Error("forbidden"));
    one.done("cancelled");
    return Promise.resolve({});
  });
}

export function removeSecretInputIpc(ipc: SecretInputIpc): void {
  for (const channel of [
    SECRET_INPUT_OPEN_CHANNEL,
    SECRET_INPUT_DISPLAY_CHANNEL,
    SECRET_INPUT_SUBMIT_CHANNEL,
    SECRET_INPUT_CANCEL_CHANNEL,
  ])
    ipc.removeHandler(channel);
}
