// 화면에서 얻은 bundle 위치를 release의 source map으로 앱 source 위치로 푼다. map은 source map v3의
// mappings(VLQ)를 직접 읽는다. 못 풀면 null이다(source만 비우고 component와 element·rect는 그대로 보낸다).
import type { Result } from "../../../base/mod.ts";
import type {
  AnnotationBundlePosition,
  AnnotationSource,
} from "../../../protocol/apps/annotation.ts";
import type { ReleaseSourceMaps } from "./ports.ts";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// mappings 한 줄을 생성 열 오름차순 segment로 푼다. 원래 위치가 없는 segment(필드 1개)는 건너뛴다.
type Segment = { column: number; source: number; line: number };

function decodeLine(
  text: string,
  state: { source: number; line: number },
): Segment[] | null {
  const segments: Segment[] = [];
  let column = 0;
  for (const part of text.split(",")) {
    if (part === "") continue;
    const fields: number[] = [];
    let value = 0;
    let shift = 0;
    for (const char of part) {
      const digit = BASE64.indexOf(char);
      if (digit < 0) return null;
      value += (digit & 31) * 2 ** shift;
      if (digit & 32) {
        shift += 5;
        continue;
      }
      fields.push(value % 2 === 1 ? -(value - 1) / 2 : value / 2);
      value = 0;
      shift = 0;
    }
    if (shift !== 0 || fields.length === 0) return null;
    column += fields[0]!;
    if (fields.length < 4) continue;
    state.source += fields[1]!;
    state.line += fields[2]!;
    segments.push({ column, source: state.source, line: state.line });
  }
  return segments;
}

// 앞의 scheme과 `../`, `./`를 걷어 앱 source 기준 상대 경로로 만든다.
function relativeSource(path: string): string {
  return path.replace(/^(?:webpack|file):\/\/\/?/, "").replace(
    /^(?:\.{1,2}\/|\/)+/,
    "",
  );
}

// line과 column은 stack trace처럼 1부터다. 그 생성 위치 앞쪽에서 가장 가까운 segment의 원래 위치를 준다.
function resolveSource(
  sourceMapJson: string,
  line: number,
  column: number,
): AnnotationSource | null {
  let map: { sources?: unknown; mappings?: unknown };
  try {
    map = JSON.parse(sourceMapJson);
  } catch {
    return null;
  }
  if (!Array.isArray(map.sources) || typeof map.mappings !== "string") {
    return null;
  }
  const lines = map.mappings.split(";");
  const state = { source: 0, line: 0 };
  let found: Segment | undefined;
  for (let index = 0; index < Math.min(lines.length, line); index++) {
    const segments = decodeLine(lines[index]!, state);
    if (segments === null) return null;
    if (index === line - 1) {
      found = segments.findLast((segment) => segment.column <= column - 1);
    }
  }
  const file = found === undefined ? undefined : map.sources[found.source];
  if (found === undefined || typeof file !== "string") return null;
  const path = relativeSource(file);
  return path === "" ? null : { file: path, line: found.line + 1 };
}

// 요청 안에서 같은 release·file의 map은 한 번만 읽는다. 위치가 없거나 map이 없거나 못 풀면 null이다.
export async function resolveAll(
  maps: ReleaseSourceMaps | undefined,
  app: string,
  items: readonly {
    release: string;
    bundle_position: AnnotationBundlePosition | null;
  }[],
): Promise<(AnnotationSource | null)[]> {
  const read = new Map<string, Promise<Result<string | null>>>();
  const resolved: (AnnotationSource | null)[] = [];
  for (const item of items) {
    const position = item.bundle_position;
    if (maps === undefined || position === null) {
      resolved.push(null);
      continue;
    }
    const key = `${item.release}\0${position.file}`;
    if (!read.has(key)) {
      read.set(key, maps.sourceMap(app, item.release, position.file));
    }
    const body = await read.get(key)!;
    resolved.push(
      body.ok && body.value !== null
        ? resolveSource(body.value, position.line, position.column)
        : null,
    );
  }
  return resolved;
}
