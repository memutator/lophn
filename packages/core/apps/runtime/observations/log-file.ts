// 앱마다 file로 남기는 app log의 쓰기 쪽(계약은 protocol/apps/app-log.ts). 쓰는 쪽은 app supervisor 하나다.
// 줄 redaction은 조립이 주입한다(최상위 경계는 contracts만 거친다).
import {
  APP_LOG_FILE_MAX_BYTES,
  APP_LOG_TEXT_MAX_CHARS,
} from "../../../../protocol/apps/app-log.ts";
import {
  appLogFile,
  appLogFolder,
  appLogPreviousFile,
} from "../../../../protocol/apps/app-storage.ts";
import {
  type ByteSource,
  createStreamDecoder,
  drain,
} from "./stream-decoder.ts";

// SDK가 invocation 문맥에서 찍는 표시다. 알 수 없는 id를 만들어 붙이지 않는다. id 모양이 아니면
// 표시가 아니라 보통 글이다(appLogLineSchema가 읽을 때 거절하지 않도록 id 꼴을 맞춘다).
const INVOCATION_MARK = /^\[inv=(inv_[0-7][0-9a-hjkmnp-tv-z]{25})\] ?/;

export type AppLogFile = {
  // stdout·stderr를 줄로 읽어 쓴다. 끝나면 resolve한다.
  attach(source: ByteSource): Promise<void>;
  // 표시 없이 invocation을 아는 줄(예외, 화면 오류)을 쓴다.
  append(entry: { invocation: string | null; text: string }): void;
};

export function createAppLogFile(deps: {
  dataRoot: string;
  app: string;
  // 알려진 secret registry와 credential pattern을 적용한 줄 redaction.
  redact: (line: string) => string;
  // `At` 꼴 시각.
  now: () => string;
}): AppLogFile {
  const file = appLogFile(deps.dataRoot, deps.app);
  const encoder = new TextEncoder();
  // file은 supervisor가 다시 떠도 남으므로 처음 쓸 때 지금 크기를 읽는다. 그 뒤는 메모리로 센다.
  let size: number | undefined;

  function write(invocation: string | null, raw: string): void {
    // redaction을 먼저 하고 그 뒤에 자른다. 자른 줄에 secret 일부가 남지 않는다.
    const text = deps.redact(raw).slice(0, APP_LOG_TEXT_MAX_CHARS);
    const line = JSON.stringify({ at: deps.now(), invocation, text }) + "\n";
    const bytes = encoder.encode(line).length;
    // 쓰기 실패는 supervisor를 멈추지 않는다. 다음 줄에서 다시 시도한다.
    try {
      if (size === undefined) {
        Deno.mkdirSync(appLogFolder(deps.dataRoot, deps.app), {
          recursive: true,
        });
        try {
          size = Deno.statSync(file).size;
        } catch (thrown) {
          if (!(thrown instanceof Deno.errors.NotFound)) throw thrown;
          size = 0;
        }
      }
      if (size > 0 && size + bytes > APP_LOG_FILE_MAX_BYTES) {
        Deno.renameSync(file, appLogPreviousFile(deps.dataRoot, deps.app));
        size = 0;
      }
      Deno.writeTextFileSync(file, line, { append: true });
      size += bytes;
    } catch {
      size = undefined;
    }
  }

  return {
    attach(source) {
      const decoder = createStreamDecoder({
        onLine(raw) {
          const mark = INVOCATION_MARK.exec(raw);
          write(mark?.[1] ?? null, mark ? raw.slice(mark[0].length) : raw);
        },
        // 16 KiB를 넘어 버린 줄은 redaction 전에 자를 수 없어 남길 안전한 글이 없다.
        onDropped() {},
      });
      return drain(source, decoder);
    },
    append(entry) {
      write(entry.invocation, entry.text);
    },
  };
}
