// SSE frame parser. 실제 network는 transport가 읽고 여기는 chunk bytes를
// frame으로만 자른다. 완성 줄만 디코딩하므로 UTF-8 멀티바이트가 chunk 경계에서 잘려도
// 이어 붙는다. 프레임은 \n·\r\n으로 자르고, line·event·전체 크기 상한은 bytes로 센다.
// 상한을 넘으면 더 받지 않고, 잘린 꼬리는 finish에서 pending으로 남기며 모르는
// event는 caller가 무시한다.

export type SseFrame = {
  event: string;
  data: string;
};

export type SseOver = {
  kind: "line" | "event" | "total";
  limit: number;
};

export type SsePush =
  | { ok: true; frames: SseFrame[] }
  | { ok: false; over: SseOver };

export type SseParser = {
  push(chunk: Uint8Array): SsePush;
  // 잘린 꼬리는 버린다. 내보내지 않은 event가 있었다는 표시만 남긴다.
  finish(): { pending: boolean };
};

// lophn 값은 요구·조사 문서에 숫자가 없다(docs/research/provider-adapters.md).
// 정규 event가 넘지 않는 상한으로 두고, 넘으면 실패가 맞다.
export const SSE_LINE_MAX_BYTES = 262_144;
export const SSE_EVENT_MAX_BYTES = 2_097_152;
export const SSE_TOTAL_MAX_BYTES = 67_108_864;

const NEWLINE = 0x0a;

export function createSseParser(
  options: {
    lineMaxBytes?: number;
    eventMaxBytes?: number;
    totalMaxBytes?: number;
  } = {},
): SseParser {
  const lineMax = options.lineMaxBytes ?? SSE_LINE_MAX_BYTES;
  const eventMax = options.eventMaxBytes ?? SSE_EVENT_MAX_BYTES;
  const totalMax = options.totalMaxBytes ?? SSE_TOTAL_MAX_BYTES;
  const decoder = new TextDecoder();
  // 아직 \n을 만나지 못한 원시 bytes. 완성 줄만 디코딩하므로 UTF-8 경계가 끊기지 않는다.
  let raw: Uint8Array = new Uint8Array(0);
  // 현재 미완성 줄의 byte 수.
  let lineBytes = 0;
  // 지금 모으고 있는 event의 data byte 수.
  let eventBytes = 0;
  let totalBytes = 0;
  let eventName = "";
  const dataLines: string[] = [];

  function dispatch(): SseFrame | undefined {
    const data = dataLines.join("\n");
    const event = eventName;
    eventName = "";
    dataLines.length = 0;
    eventBytes = 0;
    // data 없는 event는 dispatch하지 않는다(SSE 규격). event 이름 없는 data는
    // message event로 내보낸다.
    if (!data) return undefined;
    return { event: event || "message", data };
  }

  function handleLine(line: string, length: number): SseOver | undefined {
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    if (colon < 0) return undefined;
    const name = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "event") {
      eventBytes += length;
      if (eventBytes > eventMax) return { kind: "event", limit: eventMax };
      eventName = value;
      return undefined;
    }
    if (name === "data") {
      dataLines.push(value);
      // event 상한은 data value 합계이다. 넘으면 그 event를 버리고 표시한다.
      eventBytes += value.length;
      if (eventBytes > eventMax) return { kind: "event", limit: eventMax };
    }
    return undefined;
  }

  return {
    push(chunk) {
      totalBytes += chunk.length;
      if (totalBytes > totalMax) {
        return { ok: false, over: { kind: "total", limit: totalMax } };
      }
      // 원시 bytes를 이어 붙인다. \n(0x0a)은 UTF-8 연속 byte 가운데 나오지 않는다.
      const joined = new Uint8Array(raw.length + chunk.length);
      joined.set(raw);
      joined.set(chunk, raw.length);
      raw = joined;
      const frames: SseFrame[] = [];
      let start = 0;
      for (let index = 0; index < raw.length; index++) {
        if (raw[index] !== NEWLINE) continue;
        const slice = raw.subarray(start, index);
        start = index + 1;
        const length = slice.byteLength;
        lineBytes += length + 1;
        if (lineBytes > lineMax) {
          return { ok: false, over: { kind: "line", limit: lineMax } };
        }
        lineBytes = 0;
        const line = decoder.decode(slice).replace(/\r$/, "");
        if (line === "") {
          const frame = dispatch();
          if (frame) frames.push(frame);
          continue;
        }
        const over = handleLine(line, length);
        if (over) return { ok: false, over };
      }
      // 미완성 꼬리를 남긴다.
      raw = raw.subarray(start).slice();
      lineBytes = raw.byteLength;
      if (lineBytes > lineMax) {
        return { ok: false, over: { kind: "line", limit: lineMax } };
      }
      return { ok: true, frames };
    },
    finish() {
      const pending = raw.byteLength > 0;
      // SSE 규격: 마지막 줄 뒤 빈 줄 없이 끝나면 pending event를 버린다. 잘린
      // event는 성공으로 내지 않는다. caller가 pending을 보고 단절로 분류한다.
      raw = new Uint8Array(0);
      dataLines.length = 0;
      eventName = "";
      lineBytes = 0;
      eventBytes = 0;
      return { pending };
    },
  };
}
