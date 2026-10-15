// 예외 지문과 묶기 key 준비.
// 지문은 오류 이름과 상위 최대 3개 앱 frame의 상대 path·function canonical JSON
// 전체 SHA-256이다. line·column·오류 message·업무 값·절대 path·SDK·runtime
// frame을 빼고 사람이 읽을 원래 위치는 ErrorEvidence에 남긴다. 앱 frame 0개는
// 지문 대신 원래 Report ID를 discriminator로 쓴다.
import type { GroupKey } from "../../../protocol/problems/mod.ts";
import { canonicalize, sha256Hex } from "../../../base/mod.ts";

const FINGERPRINT_FRAMES = 3;

// 지문에 들어가는 frame 모양. SourceFrame(코드 위치 원본 포함)보다 좁다.
export type FingerprintFrame = {
  path: string;
  function: string | null;
};

// runtime·SDK frame 판정. URL scheme 모양(node:internal/…)·절대 path·drive
// letter는 앱 frame이 아니므로 지문에서 뺀다.
export function isAppFrame(path: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  if (/^[\\/]/.test(path)) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (path.includes("\\") || path.includes("\u0000")) return false;
  return path.length > 0;
}

// 오류 이름 + 상위 3개 앱 frame의 상대 path·function만 남긴 지문 입력.
// 여기서 줄·열·message·업무 값은 이미 빠져 있다.
function fingerprintInput(
  name: string,
  frames: readonly FingerprintFrame[],
): unknown {
  return {
    name,
    frames: frames.slice(0, FINGERPRINT_FRAMES).map((frame) => ({
      path: frame.path,
      function: frame.function,
    })),
  };
}

// 예외 지문 SHA-256. 앱 frame이 0개면 null을 돌려주고 호출자는 원래
// Report ID를 discriminator로 쓴다.
export async function exceptionFingerprint(
  name: string,
  frames: readonly FingerprintFrame[],
): Promise<string | null> {
  const appFrames = frames.filter((frame) => isAppFrame(frame.path));
  if (appFrames.length === 0) return null;
  return await sha256Hex(canonicalize(fingerprintInput(name, appFrames)));
}

// 예외 묶기 key. 지문이 있으면 그 값, 없으면 원래 Report ID다.
export async function exceptionGroupKey(
  name: string,
  frames: readonly FingerprintFrame[],
  reportId: string,
): Promise<GroupKey> {
  const fingerprint = await exceptionFingerprint(name, frames);
  return {
    kind: "exception",
    code: "_exception",
    discriminator: fingerprint ?? reportId,
  };
}

// 잘못된 보고 묶기 key. 안전하게 남길
// 수 있는 잘못된 code(식별자 모양의 짧은 소문자 문자열)는 그 값을
// discriminator로 쓰고, 안전하지 않으면 원래 Report ID로 나눈다.
const SAFE_WRONG_CODE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export function invalidReportGroupKey(
  rawCode: string | undefined,
  reportId: string,
): GroupKey {
  const safe = rawCode !== undefined && rawCode.length > 0 &&
    SAFE_WRONG_CODE.test(rawCode);
  return {
    kind: "invalid_report",
    code: "_invalid_report",
    discriminator: safe ? rawCode! : reportId,
  };
}
