// A→B confirm=true 호출의 proof 발급(apps/connections#R3, apps/invocations#R7, R8).
// 연결 허락(app.call grant)은 사람의 approval을 대신하지 않는다. 사람이 허락한 approval이 적용돼
// 접수(`invocation.accept_confirm`)가 확정된 뒤에만, 그 접수의 proof를 core 서명 key로 서명해
// 호출한 앱에게 준다. 호출한 앱은 같은 입력과 함께 target의 direct 호출에 붙이고, target
// entrypoint가 서명·nonce·release·command·input_hash·caller·기한을 검증한다.
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type InvocationAcceptConfirmInput,
  invocationAcceptConfirmInputSchema,
  type InvocationAcceptConfirmOutput,
  type SignedConfirmProof,
} from "../../../protocol/apps/mod.ts";
import type { CoreSigner } from "../runtime/mod.ts";
import { inspectPair, type PairDeps, type PairSource } from "./prepare.ts";
import type { PathBook } from "./origin.ts";

// core가 이미 확정한 접수를 같은 접수 입력으로 다시 읽는다(accept_confirm의 같은 key 재전송).
// approval 적용 전이면 접수가 없어 오류여야 한다. 새 접수를 만들지 않는다.
export interface ConfirmAcceptances {
  find(
    input: InvocationAcceptConfirmInput,
  ): Promise<Result<InvocationAcceptConfirmOutput>>;
}

export type ConfirmProof = {
  invocation: string;
  proof: SignedConfirmProof;
};

export type ConfirmProofIssuer = {
  issue(request: {
    source: PairSource;
    accept: unknown;
  }): Promise<Result<ConfirmProof>>;
};

function refuse(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function createConfirmProofIssuer(
  deps: Pick<PairDeps, "process" | "facts"> & {
    signer: CoreSigner;
    paths: PathBook;
    accepted: ConfirmAcceptances;
  },
): ConfirmProofIssuer {
  return {
    async issue({ source, accept }) {
      const parsed = invocationAcceptConfirmInputSchema.safeParse(accept);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "confirm acceptance input is invalid",
        });
      }
      const input = parsed.data;
      // proof의 caller는 이 연결의 실제 부른 앱이다. 다른 앱·release·부모를 주장하지 못한다.
      const parent = deps.paths.parentOf(
        source.processNonce,
        input.caller.kind === "app" ? input.caller.parent_invocation : null,
      );
      const expected = {
        kind: "app",
        app: source.app,
        release: source.release,
        parent_invocation: parent,
      };
      if (canonicalize(input.caller) !== canonicalize(expected)) {
        return refuse("confirm caller is not the calling app");
      }
      // 지금도 허락된 앱 쌍·현재 프로세스일 때만 발급한다. 옛 허락·옛 프로세스의 접수는 쓰지 못한다.
      const found = await inspectPair(deps, {
        source,
        app: input.app,
        commands: [input.command],
      });
      if (!found.ok) return found;
      if (
        found.value.target.processNonce !== input.process_nonce ||
        found.value.target.release !== input.release
      ) {
        return err({
          code: "conflict",
          message: "confirm target is not the current process",
        });
      }
      const accepted = await deps.accepted.find(input);
      if (!accepted.ok) return accepted;
      const signed = await deps.signer.signConfirmProof(accepted.value.proof);
      return ok({ invocation: accepted.value.invocation, proof: signed });
    },
  };
}
