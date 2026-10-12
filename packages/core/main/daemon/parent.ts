import { err, ok, type Result } from "../../../base/mod.ts";
import type { Diagnostic, Frame, Route } from "../../../protocol/server/mod.ts";
import {
  coreToMainMessageSchema,
  mainToCoreMessageSchema,
} from "../../../protocol/server/mod.ts";
import type {
  RestoreOutcome,
  RestorePlan,
} from "../../storage/migration/mod.ts";
import type { CredentialRegistry } from "../../server/identity/mod.ts";
import {
  createFrameWriter,
  readFrames,
} from "../../supervision/responsiveness/mod.ts";
import type { CoreRuntime } from "./runtime.ts";

// Electron main이 물려 준 stdin/stdout. 창 닫기는 이 pipe로 오지 않는다.
export type ParentPipe = {
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
};

// 사람 token이 지니는 operation은 route 등록의 actor 상한에서 계산한다. 손으로 쓴
// 목록이 아니어서 새 route는 user를 허용하면 자동으로 들어가고, machine·app·worker
// 전용 route는 들어가지 않는다. status·health read는 route 이름과 별개로 늘 포함한다.
export function userOperations(
  routes: readonly Route[],
  // 팀이 공개 정책을 내놓은 event 이름. owner 정책이 사람에게 event를 보이려면 필요하다.
  events: readonly string[] = [],
): string[] {
  const names = new Set<string>([
    "platform/status",
    "platform/health",
    ...events,
  ]);
  for (const route of routes) {
    if (route.actors.includes("user")) names.add(route.name);
  }
  return [...names];
}

// user token은 여기서 한 번만 준다. 발급한 자격은 ledger에 적어 writer가 다시 검증한다.
export async function greet(
  parent: ParentPipe,
  registry: CredentialRegistry,
  runtime: CoreRuntime,
  port: number,
  epoch: string,
  issue: CredentialRegistry["issue"],
  routes: readonly Route[],
  events: readonly string[] = [],
): Promise<Result<void>> {
  const issued = await issue({
    actor: "user",
    principal: "user",
    scope: {
      operations: userOperations(routes, events),
      targets: {},
    },
    conditions: { process: "electron-main" },
  });
  if (!issued.ok) return issued;
  const current = registry.revalidate({
    credential_ref: issued.value.credential_ref,
  });
  if (!current.ok) return current;
  const recorded = await runtime.record(current.value);
  if (!recorded.ok) return recorded;
  const frame = coreToMainMessageSchema.safeParse({
    user_token: issued.value.token,
    api_port: port,
    core_epoch: epoch,
  });
  if (!frame.success) {
    return err({ code: "internal", message: "hello frame을 만들지 못했다" });
  }
  // hello는 부모가 읽기 전에 나간다. 버퍼에 쌓아 두고 백프레셔로 기동을 막지 않는다.
  const buffered: Uint8Array[] = [];
  const writer = createFrameWriter({
    write: (bytes) => {
      buffered.push(bytes.slice());
      return Promise.resolve(bytes.length);
    },
  });
  try {
    await writer.writeJson(frame.data);
    void flush(parent.stdout.getWriter(), buffered);
  } catch {
    return err({
      code: "unavailable",
      message: "부모 pipe에 hello를 쓰지 못했다",
    });
  }
  return ok(undefined);
}

// 백프레셔로 기동을 막지 않게 hello 이후의 흐름만 기다린다.
async function flush(
  out: WritableStreamDefaultWriter<Uint8Array>,
  buffered: Uint8Array[],
): Promise<void> {
  try {
    for (const bytes of buffered) {
      let rest = bytes;
      while (rest.length > 0) {
        const written = await out.write(rest);
        const count = typeof written === "number" ? written : rest.length;
        rest = rest.subarray(count);
      }
    }
  } catch {
    // 부모가 이미 닫았으면 hello는 전달되지 않는다. 종료 감시가 그 뒤를 본다.
  } finally {
    // 다음 쓰기(handle 등록 응답, 복원 뒤 새 core의 hello)가 같은 pipe를 쓸 수 있게 놓는다.
    out.releaseLock();
  }
}

// backup 복원 통로(platform/backup-and-migration#R13). `run`이 정지를 시작했으면(`stopped`) 이
// 감독 pipe의 읽기는 끝나고 새로 시작하는 core가 같은 pipe를 이어받는다.
export type ParentRestore = {
  plan(createdAt: string): Promise<
    Result<{
      plan: RestorePlan;
      binding: { target: string; content: string };
    }>
  >;
  run(request: {
    created_at: string;
    confirmation: string;
  }): Promise<Result<RestoreOutcome>>;
  stopped(): boolean;
};

export type ParentConfirmation = {
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  reply(message: unknown): Promise<void>;
  restore?: ParentRestore;
};

export type ShellViewLifetime = Extract<
  Diagnostic,
  { kind: "shell_view_lifetime" }
>;

// main의 안전 진단을 받는 곳. 기록 실패는 core를 멈추지 않는다.
export type ParentDiagnostics = {
  shellView(diagnostic: ShellViewLifetime): Promise<void>;
};

// view 수명 한 줄. schema가 고정한 field(구성 요소·관측 시각·view id·generation·개수)만 쓰고
// URL·query·token·경로는 payload에 들어올 자리가 없다(platform/diagnostics#R12, redaction R15).
export function shellViewLogLine(diagnostic: ShellViewLifetime): string {
  const payload = diagnostic.payload;
  return JSON.stringify({
    at: payload.observed_at,
    component: payload.component,
    kind: "diagnostic",
    code: "shell_view_lifetime",
    view_id: payload.view_id,
    generation: payload.generation,
    created: payload.created,
    hidden: payload.hidden,
    replaced: payload.replaced,
    disposed: payload.disposed,
    attached: payload.attached,
  });
}

// `<데이터 root>/logs/shell-view.jsonl`에 덧붙인다. 다른 core 진단 파일과 같은 자리다.
export function shellViewLog(dataRoot: string): ParentDiagnostics {
  return {
    async shellView(diagnostic) {
      try {
        const directory = `${dataRoot}/logs`;
        try {
          await Deno.mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        }
        await Deno.writeTextFile(
          `${directory}/shell-view.jsonl`,
          shellViewLogLine(diagnostic) + "\n",
          { append: true },
        );
      } catch {
        // 기록하지 못해도 core와 main 통로는 그대로 간다.
      }
    },
  };
}

// pipe EOF나 main의 명시 종료가 core 종료를 시작한다(install-and-update R12).
// confirmation 등록은 이 비공개 통로에서만 받고 writer의 registry로 넘긴다.
export function watchParent(
  parent: ParentPipe,
  shutdown: () => Promise<void>,
  confirmation?: ParentConfirmation,
  diagnostics?: ParentDiagnostics,
): Promise<void> {
  return (async () => {
    const reader = parent.stdin.getReader();
    try {
      for await (const frame of readFrames({ read: streamReader(reader) })) {
        if (await handleParent(frame, shutdown, confirmation, diagnostics)) {
          // 복원으로 멈춘 core다. 새로 시작하는 core가 같은 pipe를 읽을 수 있게 놓는다.
          reader.releaseLock();
          return;
        }
      }
    } catch {
      // frame이 아닌 바이트는 protocol 위반이다. 종료로 다룬다.
    }
    await confirmation?.confirmation({ action: "clear" });
    await shutdown();
  })();
}

async function handleParent(
  frame: Frame,
  shutdown: () => Promise<void>,
  confirmation: ParentConfirmation | undefined,
  diagnostics: ParentDiagnostics | undefined,
): Promise<boolean> {
  if (frame.kind !== "json") return false;
  const message = mainToCoreMessageSchema.safeParse(frame.payload);
  if (!message.success) return false;
  if (message.data.type === "stop") {
    await confirmation?.confirmation({ action: "clear" });
    await shutdown();
    return true;
  }
  if (message.data.type === "diagnostic") {
    // main이 보내는 진단은 view 수명뿐이다. 다른 종류는 이 통로에서 받지 않고 무시한다.
    if (message.data.kind === "shell_view_lifetime") {
      await diagnostics?.shellView(message.data);
    }
    return false;
  }
  if (message.data.type === "restore_plan_request") {
    const restore = confirmation?.restore;
    if (!restore) return false;
    const planned = await restore.plan(message.data.created_at);
    await confirmation!.reply(
      planned.ok
        ? {
          type: "restore_plan",
          created_at: message.data.created_at,
          through_seq: planned.value.plan.manifest.through_seq,
          current_through_seq: planned.value.plan.current_through_seq,
          lost: planned.value.plan.lost,
          target: planned.value.binding.target,
          content_hash: planned.value.binding.content,
        }
        : {
          type: "restore_failed",
          stage: "plan",
          created_at: message.data.created_at,
          code: planned.error.code,
          message: planned.error.message,
          restarted: false,
        },
    );
    return false;
  }
  if (message.data.type === "restore_request") {
    const restore = confirmation?.restore;
    if (!restore) return false;
    const restored = await restore.run({
      created_at: message.data.created_at,
      confirmation: message.data.confirmation,
    });
    // 확인을 거쳐 정지했으면 성공이든 실패든 core는 이미 멈췄다. 이 pipe는 다시 시작하는 core가
    // 이어받는다.
    const restarted = restore.stopped();
    await confirmation!.reply(
      restored.ok
        ? {
          type: "restore_result",
          created_at: message.data.created_at,
          restored_through_seq: restored.value.restored_through_seq,
          previous_through_seq: restored.value.previous_through_seq,
        }
        : {
          type: "restore_failed",
          stage: "restore",
          created_at: message.data.created_at,
          code: restored.error.code,
          message: restored.error.message,
          restarted,
        },
    );
    return restarted;
  }
  if (message.data.type !== "confirmation_handle_register" || !confirmation) {
    return false;
  }
  const issued = await confirmation.confirmation({
    action: "issue",
    request: message.data,
  });
  if (!issued.ok) return false;
  const registered = issued.value as {
    confirmation: string;
    expires_at: string;
  };
  const reply = coreToMainMessageSchema.safeParse({
    type: "confirmation_handle_registered",
    confirmation: registered.confirmation,
    expires_at: registered.expires_at,
  });
  if (reply.success) await confirmation.reply(reply.data);
  return false;
}

export async function writeParent(
  parent: ParentPipe,
  message: unknown,
): Promise<void> {
  const buffered: Uint8Array[] = [];
  const writer = createFrameWriter({
    write: (bytes) => {
      buffered.push(bytes.slice());
      return Promise.resolve(bytes.length);
    },
  });
  await writer.writeJson(message);
  await flush(parent.stdout.getWriter(), buffered);
}

function streamReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): (buffer: Uint8Array) => Promise<number | null> {
  let pending: Uint8Array | undefined;
  return async (buffer) => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
}
