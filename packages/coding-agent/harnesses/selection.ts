// 기본 harness 선택이다(coding-agent/harnesses#R5, T36). 기본 harness는 사람이 고르는 nullable
// 값이고 이 module은 그 값을 쓰지 않는다. 비었을 때 연결 설치가 확인된 실행 가능 후보가 하나면
// 그 후보를 제안하고 여럿이면 사람이 고르게 하며, 저장한 선택이 사라지거나 실행 불가가 되어도
// 다른 제품으로 자동 교체하지 않고 다시 고르는 행동을 안내한다. 후보가 없으면 연결 안내뿐이다.
// 순수 함수라 감지·설치 관측은 호출자가 읽어 준다. 이름 순서나 감지 순서로 고르지 않는다.
import {
  type HarnessCandidate,
  type HarnessDetection,
  type HarnessId,
  type HarnessSuggestion,
  harnessSuggestionSchema,
} from "../../contracts/coding-agent/mod.ts";

// 제품 하나의 관측이다. runnable은 실행 파일을 찾고 version을 확인했다는 사실이다(존재만으로
// 실행 가능이라 하지 않는다, R3). connected는 이 컴퓨터에서 연결 설치를 확인했다는 사실이다.
export type SelectionEntry = {
  harness: HarnessId;
  enabled: boolean;
  runnable: boolean;
  connected: boolean;
  candidates: readonly HarnessCandidate[];
};

// 감지 결과에서 실행 가능 여부를 낸다. 실행 파일을 찾고 version이 verified일 때만이다.
export function runnableOf(detection: HarnessDetection): boolean {
  return detection.discovery === "detected" &&
    detection.version.result === "verified";
}

export type DefaultHarnessState =
  // 저장한 선택이 실행 가능하다.
  | "chosen"
  // 저장한 선택이 있으나 지금은 실행할 수 없다. 다른 제품으로 바꾸지 않는다.
  | "chosen_unavailable"
  // 비었고 후보가 하나다. 제안일 뿐 저장하지 않는다.
  | "suggest"
  // 비었고 후보가 여럿이다. 사람이 고른다.
  | "choose"
  // 비었고 후보가 없다. 연결 안내만 보인다.
  | "connect";

export type DefaultHarnessDecision = {
  state: DefaultHarnessState;
  // 지금 쓰는 기본 harness다. 저장한 선택이 실행 가능할 때만 있다.
  harness: HarnessId | null;
  // C-harness의 제안 JSON이다. 후보 하나일 때만 suggested_harness가 있다.
  suggestion: HarnessSuggestion;
  // choose일 때 사람이 고를 제품이다.
  choices: readonly HarnessId[];
  next: string;
};

function suggestionOf(
  harness: HarnessId | null,
  candidates: readonly HarnessCandidate[],
  reason: string,
): HarnessSuggestion {
  return harnessSuggestionSchema.parse({
    suggested_harness: harness,
    candidates: harness === null ? [] : candidates,
    reason: harness === null ? reason : null,
  });
}

export function decideDefaultHarness(input: {
  // 사람이 고른 저장 선택이다. 없으면 null이다.
  saved: HarnessId | null;
  entries: readonly SelectionEntry[];
}): DefaultHarnessDecision {
  const { saved } = input;
  if (saved !== null) {
    const entry = input.entries.find((item) => item.harness === saved);
    if (entry !== undefined && entry.enabled && entry.runnable) {
      return {
        state: "chosen",
        harness: saved,
        suggestion: suggestionOf(null, [], "저장한 기본 harness가 있다"),
        choices: [],
        next: "",
      };
    }
    // 저장 선택은 그대로 두고 다른 제품으로 바꾸지 않는다. 사람이 다시 고른다.
    return {
      state: "chosen_unavailable",
      harness: null,
      suggestion: suggestionOf(
        null,
        [],
        "저장한 기본 harness를 지금 실행할 수 없다. 다른 제품으로 바꾸지 않았다",
      ),
      choices: [],
      next:
        "기본 harness를 다시 고르거나 `lophn harness refresh`로 다시 감지한다",
    };
  }
  const ready = input.entries.filter((entry) =>
    entry.enabled && entry.runnable && entry.connected
  );
  if (ready.length === 1) {
    const only = ready[0];
    return {
      state: "suggest",
      harness: null,
      suggestion: suggestionOf(only.harness, only.candidates, ""),
      choices: [],
      next: `${only.harness}를 기본 harness로 고를지 사람이 정한다`,
    };
  }
  if (ready.length > 1) {
    return {
      state: "choose",
      harness: null,
      suggestion: suggestionOf(
        null,
        [],
        "연결된 실행 가능 제품이 여럿이라 사람이 고른다",
      ),
      choices: ready.map((entry) => entry.harness),
      next: "기본 harness를 사람이 고른다",
    };
  }
  return {
    state: "connect",
    harness: null,
    suggestion: suggestionOf(
      null,
      [],
      "연결 설치가 확인된 실행 가능 제품이 없다",
    ),
    choices: [],
    next: "harness를 골라 연결한다(`lophn connection install`)",
  };
}
