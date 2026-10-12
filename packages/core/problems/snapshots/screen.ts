// snapshot의 화면 증거(snapshots#R15, feedback#R5, R6, R10; plan problems T15).
// 화면 자료는 사람이 선택한 당시의 안전한 상태와 PNG뿐이다. 이 모듈은 이미 한도를
// 검사한 자료를 blob으로 준비하고, 없는 항목마다 공백 아닌 이유 하나를 고정한다.
// PNG는 가리지 않는다(D32): 사람이 미리보기에서 본 그대로 저장한다.
import type {
  MissingReason,
  ScreenEvidence,
} from "../../../protocol/problems/mod.ts";
import {
  bytesStream,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "./prepare.ts";

// shell이 버튼 시점에 정한, 이미지를 얻을 수 없는 분류. 다른 창은 대상이 아니다.
export const SCREEN_CAPTURE_BLOCKS = [
  "hidden",
  "protected_window",
  "capture_failed",
] as const;
export type ScreenCaptureBlock = (typeof SCREEN_CAPTURE_BLOCKS)[number];

export const SCREEN_REASONS = {
  noScreen: "화면 없음: 보고에 연결된 앱 view가 없다",
  stateNotSelected: "사람이 화면 상태를 선택하지 않았다",
  screenshotNotSelected: "사람이 화면 이미지를 선택하지 않았다",
  hidden: "앱 view가 가려진 동안이라 이미지를 캡처하지 않았다",
  protectedWindow:
    "보호된 결정 창이나 lophn dialog가 떠 있어 이미지를 캡처하지 않았다",
  captureFailed: "화면 이미지를 얻지 못했다",
  detailOff: "진단 상세 수집이 꺼져 있어 새 화면 자료를 모으지 않았다",
  settingUnknown:
    "진단 상세 수집 설정을 읽지 못해 새 화면 자료를 모으지 않았다",
  stateUnavailable: "화면 상태를 얻지 못했다",
  redaction: "redaction을 통과하지 못해 화면 상태를 제외했다",
  hashMismatch: "선택한 이미지가 미리본 최종 이미지와 달라 저장하지 않았다",
  stateStorage: "화면 상태 blob 저장에 실패했다",
  screenshotStorage: "화면 이미지 blob 저장에 실패했다",
} as const;

export type ScreenEvidenceInput = {
  // 버튼 시점 app view. null이면 화면이 없다(automation·화면 없는 호출).
  view: { name: string; observed_at: string } | null;
  // view는 있으나 이미지를 얻을 수 없었던 이유. null이면 캡처 가능했다.
  block: ScreenCaptureBlock | null;
  selection: { screen: boolean; screenshot: boolean };
  // redaction을 통과하고 한도를 지킨 상태 JSON. 제외는 redaction 실패, 없음은 상태를 못 얻은 것이다.
  state: { text: string } | { excluded: true } | { unavailable: true };
  // 최종 hash 검사를 지난 PNG. null이면 얻지 못했거나 hash가 맞지 않았다.
  screenshot: { bytes: Uint8Array } | { mismatch: true } | null;
};

export type ScreenCollectionDeps = {
  // 진단 상세 수집 설정. 꺼져 있으면 새 화면 자료를 모으지 않는다(snapshots#R7).
  // null은 설정을 읽지 못한 것이다.
  detailCollection: boolean | null;
  blobPrepare: SnapshotBlobPrepare;
  principal: string;
};

export type ScreenCollection = {
  screen: ScreenEvidence | null;
  screen_missing_reason: MissingReason | null;
  state_prepared: PreparedSnapshotBlob | null;
  screenshot_prepared: PreparedSnapshotBlob | null;
};

const reason = (text: string): MissingReason => ({ reason: text });

const BLOCK_REASONS: Record<ScreenCaptureBlock, string> = {
  hidden: SCREEN_REASONS.hidden,
  protected_window: SCREEN_REASONS.protectedWindow,
  capture_failed: SCREEN_REASONS.captureFailed,
};

// 저장 실패는 그 항목만 제외하고 이유를 고정한다. 글은 계속 접수한다(snapshots#R5).
async function prepare(
  deps: ScreenCollectionDeps,
  purpose: "feedback_state" | "feedback_screenshot",
  bytes: Uint8Array,
): Promise<PreparedSnapshotBlob | null> {
  try {
    const prepared = await deps.blobPrepare.prepare(
      { principal: deps.principal, purpose, expectedHash: undefined },
      bytesStream(bytes),
    );
    return prepared.ok ? prepared.value : null;
  } catch {
    return null;
  }
}

export async function collectScreenEvidence(
  input: ScreenEvidenceInput,
  deps: ScreenCollectionDeps,
): Promise<ScreenCollection> {
  const absent = (text: string): ScreenCollection => ({
    screen: null,
    screen_missing_reason: reason(text),
    state_prepared: null,
    screenshot_prepared: null,
  });
  if (input.view === null) return absent(SCREEN_REASONS.noScreen);
  const base = { name: input.view.name, observed_at: input.view.observed_at };
  const off = deps.detailCollection === true
    ? null
    : deps.detailCollection === false
    ? SCREEN_REASONS.detailOff
    : SCREEN_REASONS.settingUnknown;
  if (off !== null) {
    return {
      screen: {
        ...base,
        state: null,
        state_missing_reason: reason(off),
        screenshot: null,
        screenshot_missing_reason: reason(off),
      },
      screen_missing_reason: null,
      state_prepared: null,
      screenshot_prepared: null,
    };
  }
  let statePrepared: PreparedSnapshotBlob | null = null;
  let stateReason: string | null = null;
  if (!input.selection.screen) {
    stateReason = SCREEN_REASONS.stateNotSelected;
  } else if ("unavailable" in input.state) {
    stateReason = SCREEN_REASONS.stateUnavailable;
  } else if ("excluded" in input.state) {
    stateReason = SCREEN_REASONS.redaction;
  } else {
    statePrepared = await prepare(
      deps,
      "feedback_state",
      new TextEncoder().encode(input.state.text),
    );
    if (statePrepared === null) stateReason = SCREEN_REASONS.stateStorage;
  }
  let shotPrepared: PreparedSnapshotBlob | null = null;
  let shotReason: string | null = null;
  if (!input.selection.screenshot) {
    shotReason = SCREEN_REASONS.screenshotNotSelected;
  } else if (input.block !== null) {
    shotReason = BLOCK_REASONS[input.block];
  } else if (input.screenshot === null) {
    shotReason = SCREEN_REASONS.captureFailed;
  } else if ("mismatch" in input.screenshot) {
    shotReason = SCREEN_REASONS.hashMismatch;
  } else {
    shotPrepared = await prepare(
      deps,
      "feedback_screenshot",
      input.screenshot.bytes,
    );
    if (shotPrepared === null) shotReason = SCREEN_REASONS.screenshotStorage;
  }
  return {
    screen: {
      ...base,
      state: statePrepared?.hash ?? null,
      state_missing_reason: statePrepared === null
        ? reason(stateReason!)
        : null,
      screenshot: shotPrepared?.hash ?? null,
      screenshot_missing_reason: shotPrepared === null
        ? reason(shotReason!)
        : null,
    },
    screen_missing_reason: null,
    state_prepared: statePrepared,
    screenshot_prepared: shotPrepared,
  };
}
