// 보호 입력 창 IPC 등록. 창 열기는 일반 shell 창과 다른 기계의 창만, 표시·제출·취소는 그 보호 창만 부른다.
// 부모는 renderer가 보낸 값이 아니라 IPC를 보낸 창이다. 열린 보호 창은 한 번에 하나다. 값이 가는 core는 열기 요청의 `machine`이고,
// 없으면 보낸 창이 정한다: 다른 기계면 그 기계의 core다(이 컴퓨터 core의 `machines/call`). 다른 기계로 가는 창은 이 컴퓨터의
// browser로 치는 login 요청을 열지 못한다.
// 제출 입력(secret 값)은 log·오류에 넣지 않는다.
import {
  SECRET_INPUT_CANCEL_CHANNEL,
  SECRET_INPUT_DISPLAY_CHANNEL,
  SECRET_INPUT_FIT_CHANNEL,
  SECRET_INPUT_OPEN_CHANNEL,
  SECRET_INPUT_SUBMIT_CHANNEL,
  type SecretInputDisplay,
  type SecretInputOpenReply,
  secretInputFitSchema,
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
import {
  connectProviderKey,
  type ProviderKeyFailure,
  submitSecret,
} from "./submit.ts";
import type { ProviderConnectTarget } from "../../../protocol/lophn-agent/provider-inputs.ts";
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
  /**
   * 값이 갈 core. `machine`은 열기 요청이 고른 기계이고 없으면 보낸 창의 기계다. 준비 전에는 core가 null이다. 다른 기계면
   * 그 기계로 가는 core와 창에 보일 그 기계의 이름이다. 보낸 창이 열 수 없는 기계면(묶인 기계와 다르다) null이다.
   */
  coreOf(
    event: SecretInputIpcEvent,
    machine: string | undefined,
  ): {
    core: () => SecretInputCore | null;
    machine?: string;
  } | null;
  /** agent의 한 번 넣기가 ref 칸에 치는 통로(이 컴퓨터의 browser driver). */
  typeOnce?: OnceTyper;
  preload: string;
  packaged: boolean;
  headless?: HeadlessMode;
}

export type SecretInputCore = RequestCore & StatusCore;

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
  /** 열 때 정한 core. 부모 창이 닫혀도 값은 이 core로만 간다. */
  readonly core: () => SecretInputCore | null;
  /** 이 컴퓨터의 창에서 연 것만 browser로 친다. */
  readonly typeOnce: OnceTyper | undefined;
  readonly display: SecretInputDisplay;
  /** agent의 입력 요청이면 그 내용이다. 제출은 종류와 mode대로 끝난다. */
  readonly request: OpenRequest | undefined;
  /** 새 provider를 잇는 창이면 그 대상이다. 제출은 core가 id를 정해 잇는다. */
  readonly provider: ProviderConnectTarget | undefined;
  readonly opened: OpenedSecretInput;
  readonly done: (
    result: "stored" | "cancelled" | { failed: ProviderKeyFailure },
  ) => void;
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
    opening = true;
    try {
      const target = deps.coreOf(event, parsed.data.machine);
      if (target === null) {
        return { ok: false, code: "forbidden" } satisfies SecretInputOpenReply;
      }
      const core = target.core();
      if (core === null) {
        return {
          ok: false,
          code: "unavailable",
        } satisfies SecretInputOpenReply;
      }
      // 요청 card에서 온 열기는 origin·mode를 core의 열린 요청에서 읽는다(renderer가 보낸 글이 아니다).
      let request: OpenRequest | undefined;
      let provider: ProviderConnectTarget | undefined;
      let display: SecretInputDisplay;
      if ("provider" in parsed.data) {
        provider = parsed.data.provider;
        display = {
          name: "",
          purpose: "provider",
          subject: parsed.data.subject,
          configured: false,
        };
      } else if ("request" in parsed.data) {
        const read = await readRequest(core, parsed.data.request);
        if (!read.ok) {
          return {
            ok: false,
            code: "invalid_input",
          } satisfies SecretInputOpenReply;
        }
        request = read.value;
        // login은 이 컴퓨터의 browser 탭에 치고 이 컴퓨터의 login 목록에 둔다. 다른 기계의 창에는 열지 않는다.
        if (target.machine !== undefined && request.kind !== "secret") {
          return {
            ok: false,
            code: "forbidden",
          } satisfies SecretInputOpenReply;
        }
        display =
          request.kind === "secret"
            ? {
                // 이름과 대상은 core가 자리에서 읽은 값이다. 창은 설정 화면에서 연 것과 같은 한 칸이다.
                name: request.name,
                purpose:
                  "mcp" in request.slot
                    ? "mcp"
                    : "app" in request.slot
                      ? "app"
                      : "provider",
                subject: request.subject.slice(0, 80),
                configured: request.configured,
              }
            : {
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
      if (target.machine !== undefined) {
        display = { ...display, machine: target.machine };
      }
      return await new Promise<SecretInputOpenReply>((resolve) => {
        let finished = false;
        const shown: { opened?: OpenedSecretInput } = {};
        const done: Active["done"] = (result) => {
          if (finished) return;
          finished = true;
          active = null;
          resolve(
            typeof result === "object"
              ? { ok: false, code: result.failed }
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
          ...(deps.headless === undefined ? {} : { headless: deps.headless }),
          // 사람이 창을 닫으면 그만둔 것이다.
          onClosed: () => done("cancelled"),
          onCrashed: () => done({ failed: "unavailable" }),
        });
        shown.opened = opened;
        active = {
          contentsId: opened.window.webContents.id,
          core: target.core,
          typeOnce: target.machine === undefined ? deps.typeOnce : undefined,
          display,
          request,
          provider,
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
    const core = one.core();
    if (core === null || one.submitting) {
      return {
        ok: false,
        code: "unavailable",
      } satisfies SecretInputSubmitReply;
    }
    one.submitting = true;
    if (one.provider !== undefined && "value" in parsed.data) {
      const connected = await connectProviderKey(
        core,
        one.provider,
        parsed.data.value,
      );
      one.submitting = false;
      // 잇지 못한 것은 값을 다시 넣어 고칠 수 없다: 창을 닫고 연 화면이 code를 보인다.
      one.done(connected.ok ? "stored" : { failed: connected.code });
      return connected.ok
        ? ({ ok: true } satisfies SecretInputSubmitReply)
        : ({ ok: false, code: "unavailable" } satisfies SecretInputSubmitReply);
    }
    const reply =
      one.request !== undefined
        ? await submitRequest(core, one.typeOnce, one.request, parsed.data)
        : "value" in parsed.data && one.provider === undefined
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

  ipc.handle(SECRET_INPUT_FIT_CHANNEL, (event, input) => {
    const one = activeOf(event);
    if (one === null) return Promise.reject(new Error("forbidden"));
    const parsed = secretInputFitSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new Error("invalid_input"));
    one.opened.fit(parsed.data.height);
    return Promise.resolve({});
  });
}

export function removeSecretInputIpc(ipc: SecretInputIpc): void {
  for (const channel of [
    SECRET_INPUT_OPEN_CHANNEL,
    SECRET_INPUT_DISPLAY_CHANNEL,
    SECRET_INPUT_SUBMIT_CHANNEL,
    SECRET_INPUT_CANCEL_CHANNEL,
    SECRET_INPUT_FIT_CHANNEL,
  ])
    ipc.removeHandler(channel);
}
