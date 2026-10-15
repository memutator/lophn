// 앱 root 안내 파일의 lophn 관리 구간 갱신이다. 갱신은 짝이 맞는
// 관리 구간 하나의 내부만 바꾸고 바깥 사람 내용을 바이트 그대로 둔다. marker 없음·중복·
// 불완전·짝 불일치는 무변경이고 복구 안내만 남긴다. 읽은 파일 hash와 현재 파일 hash가
// 다르면 덮지 않고 충돌로 끝낸다. 쓰기는 같은 폴더 temp·rename으로 원자 교체한다.
// 이 module은 순수 값과 파일 판정만 두고 실제 파일 눈은 인자로 받는다(architecture).
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";

export const GUIDE_BEGIN_MARKER = "<!-- begin lophn-managed -->";
export const GUIDE_END_MARKER = "<!-- end lophn-managed -->";

// 관리 구간 본문의 상한이다(Codex는 안내 예산 32 KiB를 바이트로 잘라 읽으므로(조사
// skills-and-guides), 마커·본문을 합친 안내 파일 전체가 이 안에 들어야 한다.
export const GUIDE_BYTES_MAX = 32 * 1024;

// 경계 오류다. 오류마다 파일이 바뀌지 않고 파일의 현재 상태 복구 안내만 남긴다.
export type RegionBoundaryFailure = {
  kind: "no_region" | "duplicate" | "unterminated" | "pair_mismatch";
  message: string;
};

// 위치 span이다. path는 안내 파일의 절대 위치다.
export type RegionPath = {
  begin: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
};

type Boundary =
  | { ok: true; span: RegionPath }
  | { ok: false; failure: RegionBoundaryFailure };

function countBytes(bytes: Uint8Array, needle: Uint8Array): number {
  let hits = 0;
  outer:
  for (let at = 0; at + needle.length <= bytes.length; at++) {
    for (let index = 0; index < needle.length; index++) {
      if (bytes[at + index] !== needle[index]) continue outer;
    }
    hits++;
    at += needle.length - 1;
  }
  return hits;
}

function encoder(): TextEncoder {
  return new TextEncoder();
}

// bytes에서 짝이 맞는 구간 하나의 위치를 찾는다. 없음·중복·불완전·짝 불일치는 무변경이다.
// 위치 탐색은 bytes 그대로다: 갱신이 사람의 bytes를 보존한다는 뜻이다.
export function guideRegionSpan(bytes: Uint8Array): Boundary {
  const beginNeedle = encoder().encode(GUIDE_BEGIN_MARKER);
  const endNeedle = encoder().encode(GUIDE_END_MARKER);
  const begins = countBytes(bytes, beginNeedle);
  const ends = countBytes(bytes, endNeedle);
  if (begins === 0 && ends === 0) {
    return {
      ok: false,
      failure: {
        kind: "no_region",
        message:
          "lophn 관리 구간이 없다. 기존 안내 파일에 구간은 lophn이 새로 만들지 않는다. 사람이 marker 쌍을 둔 뒤 다시 갱신한다",
      },
    };
  }
  if (begins > 1 || ends > 1) {
    return {
      ok: false,
      failure: {
        kind: "duplicate",
        message:
          "marker가 겹친다. 겹치는 marker는 사람이 정리한다. lophn은 파일을 바꾸지 않았다",
      },
    };
  }
  if (begins === 0 || ends === 0) {
    return {
      ok: false,
      failure: {
        kind: "unterminated",
        message: begins === 0
          ? "닫는 marker만 있다. 열리는 marker는 사람이 둔다. lophn은 파일을 바꾸지 않았다"
          : "열리는 marker만 있다. 닫는 marker는 사람이 둔다. lophn은 파일을 바꾸지 않았다",
      },
    };
  }
  const begin = firstHit(bytes, beginNeedle);
  const end = firstHit(bytes, endNeedle);
  if (end < begin) {
    return {
      ok: false,
      failure: {
        kind: "pair_mismatch",
        message:
          "marker 순서가 맞지 않다(닫는 marker가 열리는 marker보다 앞서 있다). 사람이 정리한다. lophn은 파일을 바꾸지 않았다",
      },
    };
  }
  return {
    ok: true,
    span: {
      begin,
      bodyStart: begin + beginNeedle.length,
      bodyEnd: end,
      end: end + endNeedle.length,
    },
  };
}

// needle이 처음 나타나는 bytes 위치다. countBytes가 짝을 좁혔으니 있다.
function firstHit(bytes: Uint8Array, needle: Uint8Array): number {
  outer:
  for (let at = 0; at + needle.length <= bytes.length; at++) {
    for (let index = 0; index < needle.length; index++) {
      if (bytes[at + index] !== needle[index]) continue outer;
    }
    return at;
  }
  return -1;
}

// 실제 파일 눈이다. fixture가 끼운다. read와 rename의 사이 사람 동시 편집은(교체 직전 hash
// 비교, temp + 재확인 + rename) readBytes가 rename 앞에 한 번 더 읽게 막는다.
export type ManagedFilesPort = {
  readBytes(path: string): Promise<Result<Uint8Array | null>>;
  // temp 이름을 같은 폴더에 쓰고 rename한다. 폴더 grant 없이 같은 폴더 temp뿐이다
  // (조사 Orca). 대상이 아직 있는지 확인한 뒤 rename한다.
  writeBytesAtomic(path: string, bytes: Uint8Array): Promise<Result<null>>;
};

export type RegionInputs = {
  // 갱신할 본문이다. 사람 몫 바깥 구간은 그대로 둔다.
  guide: string;
  // 관리 파일의 위치다(앱 root 안 절대 위치).
  guidePath: string;
};

// 무변경 충돌 안내다. 읽어 둔 hash가 현재 일치하지 않아 파일을 바꾸지 않았다.
function staleMessage(): string {
  return "안내 파일을 읽은 뒤 사람 동시 편집이 생겼다. 파일을 다시 읽고 같은 갱신을 다시 접수한다. lophn은 파일을 바꾸지 않았다";
}

export type RegionUpdateInputs = RegionInputs & {
  // 읽었던 파일 bytes다. 이후 사람 편집이 생겼는지 반응한다.
  guideOriginalBytes: Uint8Array;
};

// 갱신이다. 짝이 맞는 관리 구간 하나의 내부만 바꾸고 바깥 bytes를 그대로 둔다. 경계 오류·
// 동시 편집은 파일이 바뀌지 않고 안내만 남긴다.
export async function updateGuideRegion(
  input: RegionUpdateInputs,
  port: ManagedFilesPort,
): Promise<Result<null, RegionBoundaryFailure>> {
  // 교체 직전 현재 파일이다.
  const current = await port.readBytes(input.guidePath);
  if (!current.ok) {
    return err({
      kind: "no_region",
      message: "안내 파일을 읽지 못했다. 파일을 사람이 확인한다",
    });
  }
  if (current.value === null) {
    return err({
      kind: "no_region",
      message:
        "안내 파일이 없다. 파일은 lophn이 새로 만들지 않는다. 사람이 template으로 앱 root를 준비한다",
    });
  }
  const bytes = current.value;
  // 원본 hash와 현재 hash가 다르면 동시 편집이다.
  const originalHash = await sha256Hex(input.guideOriginalBytes);
  const currentHash = await sha256Hex(bytes);
  if (originalHash !== currentHash) {
    return err({
      kind: "duplicate",
      message: staleMessage(),
    });
  }
  const span = guideRegionSpan(bytes);
  if (!span.ok) return err(span.failure);
  // 본문은 앞뒤 newline 하나씩으로 감싼다(region.ts의 관례와 같다).
  const guide = encoder().encode(`\n${input.guide}\n`);
  // 안내 본문은 마커·본문까지 합쳐 상한 안에 들도록 둔다.
  const whole = new Uint8Array(
    bytes.length - (span.span.bodyEnd - span.span.bodyStart) +
      guide.length,
  );
  whole.set(bytes.subarray(0, span.span.bodyStart), 0);
  whole.set(guide, span.span.bodyStart);
  whole.set(
    bytes.subarray(span.span.bodyEnd),
    span.span.bodyStart + guide.length,
  );
  const wrote = await port.writeBytesAtomic(input.guidePath, whole);
  return wrote.ok ? ok(null) : err({
    kind: "no_region",
    message: "안내 파일을 쓰지 못했다. 파일 권한을 사람이 확인한다",
  });
}
