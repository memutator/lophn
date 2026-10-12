// 사람 파일 읽기와 상태(file-tracking#R9). project 파일의 상태는 관측 loop의 메모리고,
// working copy의 상태는 읽을 때 사본과 metadata로 계산한다. 읽기 실패를 부재로 꾸미지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import type {
  FileStatus,
  FileTarget,
} from "../../../../protocol/projects/mod.ts";
import {
  coreFileReadSchema,
  coreFileWatchSchema,
  coreFileWindowSchema,
  type FileReadReply,
} from "../file-ipc.ts";
import { PREPARATION_OPS } from "../ipc.ts";
import {
  fileStatusView,
  type StatusObservation,
  type StatusRecorder,
} from "../status.ts";
import { parseWorkingCopyMeta } from "../working-copy.ts";
import { type Locator, notAvailable } from "./files-locate.ts";
import type { PreparationPool } from "./pool.ts";

export type StatusHandlerDeps = {
  pool: Pick<PreparationPool, "request">;
  status: StatusRecorder;
  locator: Locator;
  // core에 byte chunk frame을 보낸다(파일 창). 보내지 못하면 던진다.
  sendBytes(channel: number, bytes: Uint8Array): Promise<void>;
  nowIso(): string;
  // `files.watch`가 변화를 기다리는 한도와 간격.
  watchWaitMs?: number;
  watchPollMs?: number;
};

export type StatusHandlers = {
  // 파일의 헤더(hash·크기·identity). 바이트는 `window`가 창 단위 byte frame으로 보낸다.
  read(payload: unknown): Promise<Result<unknown, LophnError>>;
  // 헤더의 identity가 그대로인 파일의 한 창을 읽어 core가 정한 channel의 byte frame으로
  // 보내고 보낸 길이를 답한다. 응답은 바이트보다 늦게 간다.
  window(payload: unknown): Promise<Result<unknown, LophnError>>;
  watch(payload: unknown): Promise<Result<unknown, LophnError>>;
  // `/v1/files/status`가 묻는 관측. project 파일은 관측 loop의 메모리, working copy는 사본이다.
  observation(
    target: FileTarget,
  ): Promise<Result<StatusObservation | undefined, LophnError>>;
};

export function createStatusHandlers(deps: StatusHandlerDeps): StatusHandlers {
  async function readReply(
    target: FileTarget,
  ): Promise<Result<FileReadReply, LophnError>> {
    const located = await deps.locator.locate(target);
    if (!located.ok) return located;
    const answered = await deps.pool.request({
      op: PREPARATION_OPS.readFile,
      payload: { location: located.value.location },
      priority: "human",
    });
    if (!answered.ok) return answered;
    return ok(answered.value as FileReadReply);
  }

  async function observation(
    target: FileTarget,
  ): Promise<Result<StatusObservation | undefined, LophnError>> {
    if (target.kind !== "working_copy") return ok(deps.status.get(target));
    const reply = await readReply(target);
    if (!reply.ok) return reply;
    if (!reply.value.exists) return ok(undefined);
    const meta = parseWorkingCopyMeta(reply.value.meta);
    return ok({
      tracked: true,
      missing: false,
      // metadata가 없거나 깨졌으면 무엇과 비교할지 모른다. 판 대기로 꾸미지 않는다.
      unverified: meta === undefined,
      validationFailed: false,
      observedHash: reply.value.hash,
      latestHash: meta?.confirmed_hash ?? null,
      observedAt: deps.nowIso(),
      comparedVersion: meta?.base_version ?? null,
      projectRevision: null,
      details: meta === undefined ? "working copy metadata is missing" : null,
    });
  }

  function cursorOf(status: FileStatus): string {
    // 관측 시각은 넣지 않는다: 같은 내용을 다시 관측했다고 변화는 아니다.
    return `${status.state}|${status.observed_hash ?? ""}|${
      status.compared_version ?? ""
    }`;
  }

  return {
    observation,
    async read(payload) {
      const parsed = coreFileReadSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const reply = await readReply(parsed.data.target);
      if (!reply.ok) return reply;
      if (!reply.value.exists) {
        return err({ code: "not_found", message: "file is missing" });
      }
      return ok({
        hash: reply.value.hash,
        size_bytes: reply.value.size,
        identity: reply.value.identity,
      });
    },
    async window(payload) {
      const parsed = coreFileWindowSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const located = await deps.locator.locate(parsed.data.target);
      if (!located.ok) return located;
      const answered = await deps.pool.request({
        op: PREPARATION_OPS.readWindow,
        payload: (_channel, replyChannel) => ({
          location: located.value.location,
          identity: parsed.data.identity,
          offset: parsed.data.offset,
          length: parsed.data.length,
          channel: replyChannel,
        }),
        replyBytes: true,
        priority: "human",
      });
      if (!answered.ok) return answered;
      const { bytes } = answered.value as { bytes: Uint8Array };
      try {
        await deps.sendBytes(parsed.data.channel, bytes);
      } catch {
        return err({
          code: "unavailable",
          message: "file bytes were not sent",
        });
      }
      return ok({ bytes: bytes.length });
    },
    async watch(payload) {
      const parsed = coreFileWatchSchema.safeParse(payload);
      if (!parsed.success) return notAvailable();
      const located = await deps.locator.locate(parsed.data.target);
      if (!located.ok) return located;
      const deadline = Date.now() + (deps.watchWaitMs ?? 10_000);
      const pollMs = deps.watchPollMs ?? 250;
      while (true) {
        const observed = await observation(parsed.data.target);
        if (!observed.ok) return observed;
        const status = fileStatusView(parsed.data.target, observed.value);
        const cursor = cursorOf(status);
        // 처음 묻거나 달라졌으면 바로 답한다. 같으면 바뀔 때까지(기한까지) 기다린다.
        if (parsed.data.cursor !== cursor || Date.now() >= deadline) {
          return ok({ status, next_cursor: cursor });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
  };
}
