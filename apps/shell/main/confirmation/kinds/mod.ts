// 종류별 정본 read·제출을 coordinator 통로(CanonPort·SubmitPort·DeferredPort)로 묶는다.
// 표시와 제출은 같은 정본에서만 만들고, renderer가 보낸 본문은 이유 글·secret 값 말고는 쓰지 않는다.
import type {
  Canonical,
  CanonPort,
  DeferredPort,
  SubmitPort,
} from "../coordinator.ts";
import type { LiveHandle } from "../handle.ts";
import type { ConfirmationIntent } from "../types.ts";
import { appDecisions } from "./app-decisions.ts";
import { GRANT, readApproval, submitApproval } from "./approval.ts";
import {
  CONNECTION_CONCERN,
  CONNECTION_REVOKE,
  readConnectionRevoke,
  submitConnectionRevoke,
} from "./connection-revoke.ts";
import { failed, type KindCore, record, type Sent } from "./core.ts";
import { readOptionAction, submitOptionAction } from "./option-action.ts";
import {
  newRevertId,
  readRevert,
  REVERT_CONCERN,
  REVERT_RUN,
  revertState,
  submitRevert,
} from "./revert.ts";
import { createSecretSubmitter, readSecretInput } from "./secret-input.ts";

export type { KindCore } from "./core.ts";

export interface KindsOptions {
  /** 준비된 core session. 준비 전에는 null이다. */
  core(): KindCore | null;
  clock: { now(): number };
  random(bytes: Uint8Array): Uint8Array;
}

const NOT_READY = failed("unavailable", "core가 준비되지 않았다");

export function createKinds(options: KindsOptions): {
  canon: CanonPort;
  submit: SubmitPort;
  deferred: DeferredPort;
  /** 창이 닫히면 그 창의 고정 revert id와 preview를 버린다. */
  closed(windowId: string): void;
} {
  const reverts = revertState(() =>
    newRevertId(options.clock.now(), options.random)
  );
  // 결과를 모르면 같은 handle·같은 결정으로 다시 보내 receipt만 받는다(idempotency).
  const apps = appDecisions(() => options.clock.now(), options.random);
  const sentWith = new Map<string, { decision: string; input: unknown }>();

  const canon: CanonPort = {
    read(intent: ConfirmationIntent, windowId: string) {
      const core = options.core();
      if (core === null) return Promise.resolve(NOT_READY);
      switch (intent.kind) {
        case "approval_request":
          return readApproval(core, intent.approval);
        case "question_option_action":
          return readOptionAction(core, intent.question, intent.option_key);
        case "owner_decision": {
          const run = intent.targets?.[0];
          if (
            intent.concern === CONNECTION_CONCERN &&
            intent.decision === CONNECTION_REVOKE && run !== undefined &&
            intent.targets?.length === 1
          ) {
            return readConnectionRevoke(core, run);
          }
          if (
            intent.concern === REVERT_CONCERN &&
            intent.decision === REVERT_RUN && run !== undefined &&
            intent.targets?.length === 1
          ) {
            return readRevert(core, reverts, windowId, run);
          }
          return apps.read(core, intent, windowId);
        }
        case "secret_input":
          return readSecretInput(core, intent);
      }
    },
  };

  const send = async (
    handle: LiveHandle,
    decision: string,
    commandInput: unknown,
    canonical: Canonical | null,
  ): Promise<Sent> => {
    const core = options.core();
    if (core === null) return Promise.resolve({ ok: false, unknown: true });
    const request = canonical?.request;
    if (request?.kind === "approval_request") {
      const sent = await submitApproval(core, {
        handle,
        decision,
        approval: request.approval,
        createdSeq: request.created_seq,
        bindingHash: request.binding_hash,
        commandInput,
      });
      if (!sent.ok || decision !== GRANT) return sent;
      return await apps.apply(core, request.approval) ?? sent;
    }
    if (request?.kind === "question_option_action") {
      return submitOptionAction(core, {
        handle,
        question: request.question,
        optionKey: request.option_key,
        createdSeq: request.created_seq,
        bindingHash: request.binding_hash,
      });
    }
    if (
      request?.kind === "owner_decision" &&
      request.concern === REVERT_CONCERN &&
      decision === REVERT_RUN && request.input.kind === "inline"
    ) {
      return submitRevert(core, reverts, {
        handle,
        content: record(canonical?.content),
      });
    }
    if (
      request?.kind === "owner_decision" &&
      request.concern === CONNECTION_CONCERN &&
      decision === CONNECTION_REVOKE && request.input.kind === "inline"
    ) {
      return submitConnectionRevoke(core, {
        handle,
        content: record(canonical?.content),
      });
    }
    return Promise.resolve({
      ok: false,
      unknown: false,
      error: { code: "forbidden", message: "허용되지 않은 결정이다" },
    });
  };

  return {
    canon,
    submit: {
      submit({ handle, decision, commandInput, canonical }) {
        sentWith.set(handle.ref, { decision, input: commandInput });
        return send(handle, decision, commandInput, canonical);
      },
      async receipt(handle, canonical) {
        const last = sentWith.get(handle.ref);
        if (last === undefined) return undefined;
        const found = await send(handle, last.decision, last.input, canonical);
        return found.ok ? found.value : undefined;
      },
    },
    deferred: createSecretSubmitter(
      { // 준비 전이면 값을 보내지 않는다.
        internal: (...args) =>
          options.core()?.internal(...args) ?? Promise.resolve(NOT_READY),
        upload: (...args) =>
          options.core()?.upload(...args) ?? Promise.resolve(NOT_READY),
      },
      options.clock,
    ),
    closed(windowId) {
      reverts.forget(windowId);
      apps.forget(windowId);
    },
  };
}
