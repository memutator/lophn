# ex-overfit

바꾼 글 component의 "더해진 줄"에 시나리오 고유의 것(앱 이름, project 이름, 사람 말에서 따온 구절)이 들어가면 경고를 낸다. 고침이 시나리오 하나에만 맞춰지는 것을 막는 세 번째 장치다(roadmap "특정 시나리오에 맞추지 않기" 3). 경고만 하고 막지 않는다. 순수 함수만 만든다(파일 읽기는 registry 읽기 한 곳).

- 단위: ex-overfit (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/overfit/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "특정 시나리오에 맞추지 않기"
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 시나리오 고유 단어 경고)
  - landed 코드(정본): `tests/eval/versions/registry.ts`(`readEntries`, `contentFiles`, `TEXT_KINDS`), `tests/eval/types.ts`(`Scenario`, `Step`, `Participant`, `CodingParticipant`, `HumanSpec`, `VersionRef`), `tests/eval/runner/discover.ts`(`discoverScenarios()`가 `Scenario`와 path를 돌려준다), 시나리오 본보기 `tests/eval/scenarios/calendar/calendar-mvp.scenario.ts`(`say` 없이 `deliver`와 `human.card`뿐이다)
  - 코드: `packages/protocol/lophn-agent/calls.ts`의 `NamedAgent`(`Participant`의 `place`가 `{ project }` 또는 `{ app }`, `name`이 Operator 이름)
- 계약:
  - 쓰는 것:
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `type OverfitWarning`(위).
    - main에 있는 것:
      - `tests/eval/types.ts`: `Scenario`(`id`, `n`, `steps`, `real`, `human?`), `Step`(`say`의 `to`·`text`와 `callApi`의 `app`만 본다. `untilIdle`, `deliver`는 보지 않는다), `Participant`(`place`가 `{ app }` 또는 `{ project }`, `name`), `CodingParticipant`(`role: "coding_agent"`, `place: { app }`뿐이고 `name`이 없다. `real`은 `(Participant | CodingParticipant)[]`다), `HumanSpec`(`card`), `VersionRef`(`{ kind, name, n }`), `RegistryEntry`.
      - `tests/eval/versions/mod.ts`: `readEntries(dir, kind, name): Promise<RegistryEntry[]>`(n 오름차순, 없으면 `[]`), `contentFiles(entry): Record<string, string>`(skill과 template은 `{경로: 글}`을 풀고, 나머지는 `{ "": content }`, content가 없으면 `{}`), `TEXT_KINDS`. registry 폴더는 `tests/eval/registry`.
      - `packages/base/mod.ts`: `Result`, `ok`, `err`.
  - 내놓는 것(ex-cli가 부른다), `tests/eval/experiment/overfit/mod.ts`:
    - `type ComponentChange = { from: VersionRef; to: VersionRef }`. ex-cli가 spec의 "바꾸는 것"을 이 쌍으로 풀어 넘긴다. `ComponentChange`는 `ExperimentSpec.change`와 같은 모양이라 ex-cli가 그대로 넘기면 된다(ex-spec의 `ExperimentSpec`은 import하지 않는다).
    - `type ChangedText = { change: ComponentChange; before: Record<string, string>; after: Record<string, string> }`. 두 map은 `contentFiles`의 결과(file 경로 → 글)다.
    - `loadChangedText(registryDir: string, change: ComponentChange): Promise<Result<ChangedText | null>>`. 두 버전이 registry에 없으면 `err({ code: "not_found" })`. `change.to.kind`가 글 component가 아니면(`TEXT_KINDS`에 없음: tool, assembly, runtime 등 내용이 registry에 없는 종류) `ok(null)`이다. ex-cli는 `null`이면 "내용을 못 봐서 경고를 못 낸다" 한 줄만 찍는다.
    - `OverfitWarning`: 이 task가 정의하지 않는다. ex-spec이 `tests/eval/experiment/spec/`에 정의하고(`ExperimentResult.overfit?`가 쓴다) 이 task는 거기서 import해 다시 내보낸다. 모양은 `{ scenario: string; component: string; file: string; kind: "name" | "phrase"; term: string; line: string }`이다. `scenario`는 `id@n`, `component`는 `kind:name@a→@b` 글, `line`은 더해진 줄(160자까지). ex-spec이 이 칸 그대로 옮긴다.
    - `findOverfit(changed: ChangedText, scenarios: Scenario[], extraNames?: Record<string, string[]>): OverfitWarning[]`. `extraNames`는 시나리오 id → 추가로 피할 이름(재료의 `manifest.ids` 키 가운데 app, project, operator, context 이름)이다. ex-cli가 시나리오의 `world` 재료를 읽어 넘기고, 이 task는 재료를 읽지 않는다.
    - `formatWarnings(warnings: OverfitWarning[]): string[]`. stdout에 찍을 줄. 예: `경고: 가계부 (이름) 가 instruction:lophn@3→@4 의 prompt.md 에 더해졌다. 시나리오 L4-app@1: "...줄..."`.

## 할 일

근거: roadmap "특정 시나리오에 맞추지 않기"는 "바꾼 글에 시나리오에만 있는 것(앱 이름 "가계부", 사람 말 조각)이 들어가면 runner가 경고한다"고만 정한다. "구절"의 기준은 아래처럼 가장 단순하게 정한다.

1. `text.ts`:
   - `normalize(text)`: NFC로 바꾸고 소문자로, 글자·숫자가 아닌 것을 공백으로, 공백을 한 칸으로 줄이고 앞뒤를 뗀다(`\p{L}\p{N}`만 남긴다).
   - `addedLines(before: string, after: string): string[]`: 줄을 trim하고 빈 줄을 뺀 뒤, `before`에 있는 줄(같은 글 줄의 개수만큼)을 `after`에서 한 번씩 지운 나머지를 `after` 순서로 돌려준다. 줄 단위 multiset 차이다. 고친 줄은 새 줄이라 더해진 줄에 든다. LCS 같은 diff 알고리즘을 쓰지 않는다.
2. `terms.ts`: `scenarioTerms(scenario: Scenario, extraNames: string[] = []): { names: string[]; phrases: string[] }`.
   - `names`: `scenario.steps`의 `say`의 `to`, `callApi`의 `app`, `scenario.real`의 각 참가자에서 `place.app`, `place.project`, `name`을 모으고 `extraNames`를 더한다. `CodingParticipant`는 `name`이 없고 `place.app`만 있다(`isCodingAgent`로 가르거나 칸이 있는 것만 읽는다. 없는 칸을 읽어 던지지 않는다). trim하고, 길이가 2 미만인 것을 빼고, 중복을 없앤다.
   - `phrases`: `say`의 `text`와 `scenario.human?.card`(요구 카드. calendar 시나리오처럼 `say` 없이 `deliver`로 시작하는 시나리오에서 사람 말은 카드와 재료의 call 본문에 있다)마다 `normalize` 해서 공백으로 쪼갠 token의 연속 3개 창을 만든다. 창을 한 칸 공백으로 이은 글이 구절이다. 공백을 뺀 글자 수가 6 미만인 창은 버리고, 창이 모두 ASCII면 글자 수 12 미만도 버린다(영어는 단어가 짧아 우연히 겹치기 쉽다). 중복을 없앤다.
3. `find.ts`: `findOverfit`.
   - file마다(`before`와 `after` 키의 합집합) `addedLines`를 구한다.
   - 시나리오마다 `scenarioTerms(s, extraNames?.[s.id] ?? [])`. 이름은 줄 안에 있는지 본다: 이름이 전부 ASCII이면 소문자로 바꾼 줄에서 앞뒤가 영문·숫자가 아닌 경계로 맞는 것만(`tax`가 `taxonomy`에 걸리지 않게), 아니면 NFC 글에 `includes`로. 구절은 `normalize(줄)`에 `includes`로 본다.
   - 걸린 term은 그 file의 글 전체에서 센 횟수가 `after`가 `before`보다 많을 때만 경고로 낸다(같은 이름이 옛 글에 이미 여러 번 있던 것은 이번 고침이 더한 것이 아니다). 센 방법은 위 매치 방법과 같고 글 전체에 건다.
   - `(scenario, file, term)`마다 경고는 하나다(처음 걸린 줄).
4. `load.ts`: `loadChangedText`. 두 버전의 entry를 `readEntries`에서 `n`으로 찾고 `contentFiles`로 푼다.
5. `format.ts`: `formatWarnings`. `mod.ts`가 위 "내놓는 것"을 모두 내보낸다.
6. test(아래).

## 정한 것

- **경고만 한다.** 채택을 막지 않는다. 이유: roadmap이 "경고"라고 했고, 막는 것은 guard와 미리 써 둔 같은 규칙의 case 둘이 한다. 이 장치는 사람이 고침을 다시 보게 하는 것이다.
- **구절 기준은 연속 3 token, 글자 수 6 이상(ASCII 창은 12 이상)이다.** 이유: 가장 단순하고, 한국어 어절 3개(`월별 지출 합계`)와 영어 단어 3개(`monthly spending total`)가 모두 걸리고, `i want to` 같은 우연은 걸리지 않는다. 틀리면 숫자만 고친다.
- **이름은 시나리오 파일과 참가자에서만 뽑고, 재료 이름은 호출하는 쪽이 `extraNames`로 넘긴다.** 이유: 시나리오는 재료 안의 이름을 쓰지 않고 참가자의 place 이름으로만 가리킨다(eval-base README "재료 안의 이름"). 재료를 읽는 일은 ex-cli의 몫이라 이 task가 순수하게 남는다.
- **setup 안에서 만든 글(예: `openTicket`의 goal)과 `deliver`가 보내는 재료의 call 본문은 보지 않는다.** 앞의 것은 코드 안에 있어 정적으로 읽을 수 없고, 뒤의 것은 재료를 읽는 일이 ex-cli의 몫이다. 사람 말 구절은 `say`의 글과 요구 카드만 쓴다.
- 내용이 registry에 없는 component(tool, assembly, runtime)는 보지 못한다. git diff를 읽는 길은 만들지 않는다. 이유: 글 component(instruction, skill, guide, template)가 시나리오 고유 단어가 스며드는 곳이고, 코드 component는 `deno task check`와 리뷰가 본다.

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`는 check에서 돈다. test는 순수하다(파일, 네트워크, core 없음).
- 위험 test(1개, `overfit_test.ts`): "더해진 줄에 시나리오의 앱 이름이나 사람 말 구절이 들어가면 경고가 나고, 같은 이름이 옛 글에 이미 있던 만큼이면 경고가 나지 않으며, `tax`가 `taxonomy`에 걸리지 않는다." (손으로 만든 `ChangedText`와 `Scenario` 표 하나. `real`에 `CodingParticipant`가, `human.card`가 든 시나리오도 하나 넣어 `name` 없는 참가자에서 던지지 않고 카드의 구절이 걸리는 것을 본다.)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `contentFiles`나 `readEntries` 모양이 위와 달라 막히는 곳
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: tool, assembly, runtime의 내용은 보지 못한다. ex-cli가 `extraNames`(재료 이름)를 넘기지 않으면 재료 안의 이름(project `tax`의 title 세무 등)은 걸리지 않는다. `deliver`로 보내는 call 본문의 구절도 걸리지 않는다.
