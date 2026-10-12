// broker `/_lophn/broker/apps/confirm/{request,poll}`의 apps 쪽 구현(apps/connections#R3).
// 호출한 앱 자식 연결의 신원으로 confirm=true command의 approval을 요청하고 결과를 poll로 받는다.
// 소켓을 오래 잡지 않도록 poll의 기다림은 짧게 제한한다. 본문은 신원·입력 지문을 주장하지 못한다.
import { err, type Result } from "../../../base/mod.ts";
import {
  APPS_CONFIRM_POLL_WAIT_MAX_MS,
  brokerAppsConfirmPollInputSchema,
  brokerAppsConfirmPollOutputSchema,
  brokerAppsConfirmRequestInputSchema,
  brokerAppsConfirmRequestOutputSchema,
} from "../../../protocol/apps/mod.ts";
import type { z } from "zod";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

type RequestOutput = z.infer<typeof brokerAppsConfirmRequestOutputSchema>;
type PollOutput = z.infer<typeof brokerAppsConfirmPollOutputSchema>;

// confirm 준비 서비스(core 쪽 apps/connections)의 포트다.
export interface AppPairConfirmer {
  request(request: {
    source: BrokerChild;
    app: string;
    command: string;
    input?: unknown;
    target_release: string;
    target_process_nonce: string;
    parent_invocation: string | null;
  }): Promise<Result<RequestOutput>>;
  poll(request: {
    source: BrokerChild;
    approval: string;
    wait_ms: number;
  }): Promise<Result<PollOutput>>;
}

export type AppsConfirmService = {
  request(child: BrokerChild, body: unknown): Promise<Result<RequestOutput>>;
  poll(child: BrokerChild, body: unknown): Promise<Result<PollOutput>>;
};

function internal(): Result<never> {
  return err({
    code: "internal",
    message: "prepared confirm does not match its contract",
  });
}

function mismatch(): Result<never> {
  return err({
    code: "unauthorized",
    message: "confirm does not match the child connection",
  });
}

function sameChild(
  input: { process_nonce: string; mode: string },
  child: BrokerChild,
): boolean {
  return input.process_nonce === child.processNonce &&
    input.mode === child.mode;
}

export function createAppsConfirmService(deps: {
  confirmer: AppPairConfirmer;
}): AppsConfirmService {
  return {
    async request(child, body) {
      const parsed = brokerAppsConfirmRequestInputSchema.safeParse(body);
      if (!parsed.success) return invalid("apps confirm input is invalid");
      const input = parsed.data;
      if (!sameChild(input, child)) return mismatch();
      const requested = await deps.confirmer.request({
        source: child,
        app: input.app,
        command: input.command,
        ...(input.input === undefined ? {} : { input: input.input }),
        target_release: input.target_release,
        target_process_nonce: input.target_process_nonce,
        parent_invocation: input.parent_invocation,
      });
      if (!requested.ok) return requested;
      const output = brokerAppsConfirmRequestOutputSchema.safeParse(
        requested.value,
      );
      return output.success ? { ok: true, value: output.data } : internal();
    },
    async poll(child, body) {
      const parsed = brokerAppsConfirmPollInputSchema.safeParse(body);
      if (!parsed.success) return invalid("apps confirm poll input is invalid");
      const input = parsed.data;
      if (!sameChild(input, child)) return mismatch();
      const polled = await deps.confirmer.poll({
        source: child,
        approval: input.approval,
        wait_ms: Math.min(input.wait_ms ?? 0, APPS_CONFIRM_POLL_WAIT_MAX_MS),
      });
      if (!polled.ok) return polled;
      const output = brokerAppsConfirmPollOutputSchema.safeParse(polled.value);
      return output.success ? { ok: true, value: output.data } : internal();
    },
  };
}
