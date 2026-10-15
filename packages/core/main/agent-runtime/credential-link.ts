import { err, ok } from "../../../base/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
} from "../../../protocol/supervision/mod.ts";
import type { AgentCredentialIssuer } from "../../lophn-agent/run-loop/mod.ts";

// run마다 받는 agent credential의 감독 pipe 연결(lophn-agent/harness/run-loop). 발급은 core의
// 인증 경계가 하고 runtime은 StartRun이 확정된 run에 대해 요청만 보낸다. token은 이 응답으로만
// 오고 log·오류에 남기지 않는다.

export type CredentialLink = {
  // run-loop의 `createRunCredentials`가 쓰는 발급 port다.
  issuer: AgentCredentialIssuer;
  // 감독 pipe에서 받은 parent message. 이 link의 응답이면 true다.
  onParent(message: ParentMessage): boolean;
};

export function createCredentialLink(options: {
  send(message: ChildMessage): Promise<void>;
  // 응답을 기다리는 기한. 지나면 발급 실패다.
  timeoutMs?: number;
}): CredentialLink {
  const pending = new Map<
    string,
    {
      resolve(value: { credential: string; credential_ref: string }): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // 끝낼 run을 알려면 어느 assignment의 것인지 기억한다.
  const held = new Map<string, string>();
  let sequence = 0;
  const timeoutMs = options.timeoutMs ?? 10_000;

  function end(run: string): boolean {
    if (!held.delete(run)) return false;
    void options.send({ type: "agent_credential_end", run }).catch(() => {});
    return true;
  }

  return {
    issuer: {
      async issue(input) {
        const run = input.conditions.run;
        const assignment = input.conditions.assignment;
        if (run === undefined || assignment === undefined) {
          return err({
            code: "invalid_input",
            message: "credential needs a run and an assignment",
          });
        }
        const id = `agent-credential-${++sequence}`;
        const answered = new Promise<
          { credential: string; credential_ref: string } | null
        >((resolve) => {
          const timer = setTimeout(() => {
            if (pending.delete(id)) resolve(null);
          }, timeoutMs);
          pending.set(id, { resolve, timer });
        });
        try {
          await options.send({
            type: "agent_credential_request",
            request_id: id,
            run,
            assignment,
            operations: [...input.scope.operations],
            scope: {},
          });
        } catch {
          clearTimeout(pending.get(id)?.timer);
          pending.delete(id);
          return err({
            code: "unavailable",
            message: "supervision pipe is closed",
          });
        }
        const issued = await answered;
        if (issued === null) {
          return err({
            code: "unavailable",
            message: "agent credential was not issued",
          });
        }
        held.set(run, assignment);
        return ok({
          token: issued.credential,
          credential_ref: issued.credential_ref,
        });
      },
      endBy(condition, value) {
        if (condition === "run") return end(value) ? 1 : 0;
        let ended = 0;
        for (const [run, owner] of [...held]) {
          if (owner === value && end(run)) ended += 1;
        }
        return ended;
      },
    },
    onParent(message) {
      if (message.type !== "agent_credential_response") return false;
      const waiting = pending.get(message.request_id);
      if (waiting === undefined) return true;
      pending.delete(message.request_id);
      clearTimeout(waiting.timer);
      waiting.resolve({
        credential: message.credential,
        credential_ref: message.credential_ref,
      });
      return true;
    },
  };
}
