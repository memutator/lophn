// script step은 요청 접수 순서로 하나씩 소진한다. 순환하거나 'ok'로 넘기지 않는다.
import { type Incoming, matches, type MatchResult } from "./match.ts";
import type { Protocol, Script, Step } from "./types.ts";

export class StepQueue {
  #steps: Step[];
  #cursor = 0;

  constructor(script: Script) {
    this.#steps = [...script.steps];
  }

  next(
    request: Incoming,
    protocol: Protocol,
  ): { step: Step; result: MatchResult } | { exhausted: true } {
    const step = this.#steps[this.#cursor];
    if (!step) return { exhausted: true };
    const result: MatchResult = step.protocol === protocol
      ? matches(step.match, request)
      : { ok: false, detail: "protocol" };
    if (result.ok) this.#cursor += 1;
    return { step, result };
  }

  remaining(): string[] {
    return this.#steps.slice(this.#cursor).map((step) => step.id);
  }

  consumed(): number {
    return this.#cursor;
  }
}
