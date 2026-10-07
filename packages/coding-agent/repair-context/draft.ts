// 절 초안. 줄 한도를 지키고 없음·범위 거절·가림·잘림을 절의 availability와 reason에 남긴다
// (repair-context#R3, R18). 내용도 누락 사실도 없으면 절을 내지 않는다.
import type {
  EvidenceKind,
  RepairContextSection,
  RepairEvidenceRead,
  RepairEvidenceSource as EvidenceSource,
  SectionKind,
} from "../../contracts/coding-agent/mod.ts";
import { fitLines } from "./text.ts";

type Reasons = {
  truncated: string[];
  forbidden: string[];
  redacted: string[];
  missing: string[];
};

export class Draft {
  readonly lines: string[] = [];
  readonly sources: EvidenceSource[] = [];
  readonly more: RepairEvidenceRead[] = [];
  readonly reasons: Reasons = {
    truncated: [],
    forbidden: [],
    redacted: [],
    missing: [],
  };

  readonly kind: SectionKind;
  readonly problem: string | null;
  // 이 절이 쓸 수 있는 줄 수. 줄 한도는 절 내용 전체에 적용한다.
  readonly cap: number;

  constructor(kind: SectionKind, problem: string | null, cap: number) {
    this.kind = kind;
    this.problem = problem;
    this.cap = cap;
  }

  line(text: string): this {
    this.lines.push(text);
    return this;
  }

  extend(lines: readonly string[]): this {
    this.lines.push(...lines);
    return this;
  }

  source(source: EvidenceSource): this {
    const key = JSON.stringify(source);
    if (!this.sources.some((item) => JSON.stringify(item) === key)) {
      this.sources.push(source);
    }
    return this;
  }

  // 잘림이다. 실제 추가 읽기를 함께 남긴다.
  truncated(reason: string, more?: RepairEvidenceRead): this {
    this.reasons.truncated.push(reason);
    if (more !== undefined) this.addMore(more);
    return this;
  }

  addMore(more: RepairEvidenceRead): this {
    const key = JSON.stringify(more);
    if (!this.more.some((item) => JSON.stringify(item) === key)) {
      this.more.push(more);
    }
    return this;
  }

  missing(reason: string): this {
    this.reasons.missing.push(reason);
    return this;
  }

  forbidden(reason: string): this {
    this.reasons.forbidden.push(reason);
    return this;
  }

  redacted(reason: string): this {
    this.reasons.redacted.push(reason);
    return this;
  }

  hasReason(): boolean {
    return Object.values(this.reasons).some((list) => list.length > 0);
  }

  finish(fallback: {
    source: EvidenceSource;
    more: { kind: EvidenceKind; source: string; problem: string };
  }): RepairContextSection | null {
    if (this.lines.length === 0 && !this.hasReason()) return null;
    const reasonLines = [
      ...this.reasons.forbidden,
      ...this.reasons.redacted,
      ...this.reasons.missing,
    ].map((reason) => `missing: ${reason}`);
    const body = this.lines.length === 0 ? reasonLines : this.lines;
    const fitted = fitLines(
      body,
      Math.max(1, this.cap),
      (count) => `... ${count}줄 생략(한도 ${this.cap}줄)`,
    );
    if (fitted.omitted > 0) {
      this.reasons.truncated.push(
        `${fitted.omitted}줄을 줄 한도(${this.cap})로 생략했다`,
      );
    }
    if (this.reasons.truncated.length > 0 && this.more.length === 0) {
      this.addMore({ ...fallback.more, cursor: null });
    }
    const availability = this.reasons.truncated.length > 0
      ? "truncated"
      : this.reasons.forbidden.length > 0
      ? "forbidden"
      : this.reasons.redacted.length > 0
      ? "redacted"
      : this.reasons.missing.length > 0
      ? "missing"
      : "available";
    const reasonText = [
      ...this.reasons.truncated.map((reason) => `truncated: ${reason}`),
      ...this.reasons.forbidden.map((reason) => `forbidden: ${reason}`),
      ...this.reasons.redacted.map((reason) => `redacted: ${reason}`),
      ...this.reasons.missing.map((reason) => `missing: ${reason}`),
    ].join("; ");
    if (this.sources.length === 0) this.source(fallback.source);
    return {
      kind: this.kind,
      problem: this.problem,
      content: fitted.lines.join("\n"),
      sources: this.sources,
      availability,
      reason: availability === "available" ? null : reasonText,
      more: availability === "truncated" ? this.more : null,
    };
  }
}
