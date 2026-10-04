import { REDACTION_REPLACEMENT } from "../../contracts/platform/mod.ts";
import { matchCredential, MIN_CREDENTIAL_LENGTH } from "./patterns.ts";
import type { KnownSecretRegistry } from "./registry.ts";

// stream은 알려진 값의 최장 길이만큼 보류하고 검사한 prefix만 내보낸다(R5).
// 보류는 아직 값이 끝나지 않았을 수 있는 꼬리다. 이미 끝난 값은 지운다.

export type RedactionStream = {
  push(chunk: string): string;
  finish(): string;
  readonly held: number;
};

type Hit = { index: number; length: number };

function earliest(
  known: Hit | undefined,
  credential: Hit | undefined,
): Hit | undefined {
  if (!known) return credential;
  if (!credential) return known;
  if (known.index !== credential.index) {
    return known.index < credential.index ? known : credential;
  }
  return known.length >= credential.length ? known : credential;
}

export function createRedactionStream(
  registry: KnownSecretRegistry,
): RedactionStream {
  let pending = "";

  function holdLength(): number {
    return Math.max(registry.maxLength, MIN_CREDENTIAL_LENGTH);
  }

  function release(flush: boolean): string {
    let out = "";
    const hold = flush ? 0 : holdLength();
    while (pending.length > hold) {
      const window = pending.slice(0, pending.length - hold);
      const hit = earliest(registry.match(window), matchCredential(window));
      if (hit) {
        out += window.slice(0, hit.index) + REDACTION_REPLACEMENT;
        pending = pending.slice(hit.index + hit.length);
        continue;
      }
      // window 직후 보류와 이어진 값은 그 시작부터 남긴다.
      const spanning = earliest(
        registry.match(pending),
        matchCredential(pending),
      );
      if (spanning && spanning.index < window.length) {
        out += pending.slice(0, spanning.index);
        pending = pending.slice(spanning.index);
        break;
      }
      out += window;
      pending = pending.slice(window.length);
      break;
    }
    return out;
  }

  return {
    push(chunk) {
      pending += chunk;
      return release(false);
    },
    finish() {
      const out = release(true);
      pending = "";
      return out;
    },
    get held() {
      return pending.length;
    },
  };
}
