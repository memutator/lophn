// stdout/stderr를 frame stream으로 읽는 decoder와 log 줄의 byte 상한.
// frame codec은 contracts/platform supervision 정본을 따른다(contracts#T6).
// redaction은 조립이 주입한다(최상위 경계는 contracts만 거친다).
import { FrameDecoder, type Frame } from "../../../contracts/platform/mod.ts";

// bytes frame의 최대 크기도 decoding 결과 줄의 상한다. STREAM_CHUNK_MAX_BYTES가
// 이미 frame 상한이므로 같은 값을 쓴다.
export const STREAM_MAX_BYTES = 1024 * 1024;

// 알려진 secret registry의 모양. 구현은 platform/redaction이 조립에 준다.
export type SecretRegistry = {
  // 줄바꿈 없는 chunk의 보류 길이 판정에 쓴다.
  readonly maxLength: number;
};

// stream 줄 redaction. registry와 credential pattern은 조립이 묶어 준다.
export type LineRedactor = {
  push(chunk: string): string;
  finish(): string;
};

export type StreamOutcome =
  | { kind: "lines"; data: string }
  | { kind: "bytes"; data: Uint8Array }
  | { kind: "end" }
  | { kind: "abort" };

export type StreamDecoderDeps = {
  // 알려진 secret registry와 credential pattern이 묶인 줄 redactor.
  redactor: LineRedactor;
  // 초과 부분은 생략 표시하되 redaction 전에 잘라 안전성을 모르면 원문을 버린다.
  maxBytes?: number;
};

export type StreamDecoder = {
  // decoded frame을 줄 데이터·bytes·end·abort로 나눈다. frame 순서를 유지한다.
  decode(frame: Frame): StreamOutcome | undefined;
  // 줄바꿈으로 끝나지 않은 꼬리. 종료 확인 때만 부른다.
  finish(): string | undefined;
  // bytes 프레임과 동일한 byte 상한을 부분 chunk에도 적용한다. 초과 부분은
  // 생략 표시하고 redaction 전에 잘라 안전성을 모르면 버린다.
  readBytes(data: Uint8Array, cap: number): { text: string; truncated: boolean };
};

// ... 언제 어떤 결과가 나오는지 계약 설명이다.
// - json frame: control이므로 decoder 밖 문제다. undefined를 돌려준다.
// - end frame: stream의 끝. finish()로 꼬리를 마무리한다.
// - abort frame: stream의 실패.
export function createStreamDecoder(
  deps: StreamDecoderDeps,
): StreamDecoder {
  const incoming = new FrameDecoder();
  const redactor = deps.redactor;
  const maxBytes = deps.maxBytes ?? STREAM_MAX_BYTES;
  let ended = false;

  function decode(frame: Frame): StreamOutcome | undefined {
    if (frame.kind === "json") return undefined;
    if (frame.kind === "bytes") {
      return { kind: "bytes", data: frame.payload };
    }
    if (frame.kind === "end") {
      if (ended) return undefined;
      ended = true;
      return { kind: "end" };
    }
    return { kind: "abort" };
  }

  function streamText(text: string): string {
    const cleaned = redactor.push(text);
    if (ended) return redactor.finish();
    return cleaned;
  }

  return {
    decode(frame) {
      return decode(frame);
    },
    finish() {
      if (ended) return undefined;
      return redactor.finish();
    },
    readBytes(data, cap) {
      const safeCap = Math.min(Math.max(cap, 1), maxBytes);
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const full = decoder.decode(data);
      if (full.length <= safeCap) {
        return { text: streamText(full), truncated: false };
      }
      const head = full.slice(0, safeCap);
      const steppedBack = head.codePointAt(head.length - 1) !== undefined &&
        /[\uD800-\uDBFF]/.test(head[head.length - 1]) &&
        !/[\uDC00-\uDFFF]/.test(head[head.length] ?? "");
      const text = steppedBack ? head.slice(0, -1) : head;
      return { text: streamText(text), truncated: true };
    },
  };
}
