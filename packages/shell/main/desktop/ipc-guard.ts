// 매 IPC마다 sender·frame·URL·입력을 검사한다. 페이지가 적은 신원은 쓰지 않는다.
import type { ZodType } from "zod";

// shell은 packages/base를 import하지 않는다. 경계 오류 모양만 여기서 맞춘다.
export type IpcError = {
  code: "invalid_input" | "forbidden";
  message: string;
};

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

function err(error: IpcError): IpcResult<never> {
  return { ok: false, error };
}

/** 직렬화한 입력의 상한. 이보다 크면 내용을 보기 전에 거절한다. */
export const MAX_IPC_BYTES = 64 * 1024;

export interface CallerFrame {
  /** subframe이면 부모가 있다. main frame만 통과한다. */
  parent: CallerFrame | null;
  url: string;
}

export interface CallerContents {
  id: number;
  isDestroyed(): boolean;
  mainFrame: CallerFrame | null;
}

export interface IpcEvent {
  sender: CallerContents;
  senderFrame: CallerFrame | null;
}

export interface RegisteredContents {
  contents: CallerContents;
  /** 이 webContents가 있을 수 있는 주소. scheme·host·path를 각각 비교한다. */
  origin: { scheme: string; host: string; path: string };
}

export class ContentsRegistry {
  readonly #entries = new Map<number, RegisteredContents>();

  register(entry: RegisteredContents): void {
    this.#entries.set(entry.contents.id, entry);
  }

  unregister(id: number): void {
    this.#entries.delete(id);
  }

  find(id: number): RegisteredContents | undefined {
    return this.#entries.get(id);
  }
}

function fail(code: IpcError["code"], message: string): IpcError {
  return { code, message };
}

function matchesOrigin(
  url: string,
  origin: RegisteredContents["origin"],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === `${origin.scheme}:` &&
    parsed.host === origin.host &&
    parsed.pathname === origin.path;
}

/** sender가 registry의 살아 있는 main frame이고 등록된 주소인지. */
export function checkCaller(
  registry: ContentsRegistry,
  event: IpcEvent,
): IpcResult<RegisteredContents> {
  const entry = registry.find(event.sender.id);
  if (!entry || entry.contents !== event.sender || event.sender.isDestroyed()) {
    return err(
      fail("forbidden", "sender is not a live registered webContents"),
    );
  }
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null || frame !== event.sender.mainFrame) {
    return err(fail("forbidden", "sender is not the main frame"));
  }
  if (!matchesOrigin(frame.url, entry.origin)) {
    return err(fail("forbidden", "sender url does not match its registration"));
  }
  return ok(entry);
}

/**
 * 입력을 schema로 검사한다. 직렬화가 상한을 넘거나 모르는 필드·잘못된 값이면
 * invalid_input이다. schema는 Zod `strict()`로 만든다.
 */
export function checkInput<T>(
  schema: ZodType<T>,
  input: unknown,
): IpcResult<T> {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return err(fail("invalid_input", "input is not serializable"));
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > MAX_IPC_BYTES
  ) {
    return err(fail("invalid_input", "input exceeds 64 KiB"));
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return err(fail("invalid_input", "input does not match schema"));
  }
  return ok(parsed.data);
}

/** caller 검사 뒤에 입력 검사. 둘 다 통과해야 값을 돌려준다. */
export function guardIpc<T>(
  registry: ContentsRegistry,
  event: IpcEvent,
  schema: ZodType<T>,
  input: unknown,
): IpcResult<T> {
  const caller = checkCaller(registry, event);
  if (!caller.ok) return caller;
  return checkInput(schema, input);
}
