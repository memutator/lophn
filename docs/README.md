---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# lophn 문서

lophn 문서는 **concern** 단위로 나눈다. concern 목록은 [concerns.yaml](concerns.yaml) 하나에 있고, 모든 문서는 머리의 metadata로 자기가 다루는 concern을 가리킨다. 문서 종류가 늘어도 "이 concern에 관한 문서 전부"를 concern id 하나로 모을 수 있다.

검사: `node tools/check-docs.ts` (빠진 문서까지 보려면 `--coverage`)

## concern

- id는 경로다: `lophn-agent/harness/provider`. 트리로 짠다.
- concern마다 `summary`(맡는 것), `excludes`(맡지 않는 것과 그것을 맡는 concern), `entities`(정의하는 domain model entity)를 적는다.
- 사실 하나는 concern 하나에만 둔다. 다른 concern의 것은 concern id로 가리키기만 한다.
- 화면에 "무엇을 보여 주고 지켜야 하나"는 그 concern이, 화면의 모양과 배치는 `shell`이 맡는다.
- id는 바꾸지 않는다. 옮기거나 합칠 때는 옛 id에 `moved_to:`를 단다.
- 새 concern이 필요하면 concerns.yaml에 먼저 넣고 나서 문서를 쓴다.

## 문서 종류

| type | 무엇 | 경로 | concerns |
|---|---|---|---|
| `guide` | 문서를 쓰는 법, 묶음의 안내 | 각 폴더의 `README.md` | 다루는 범위 |
| `intent` | 이 concern을 왜 만들고 무엇을 약속하나(약속 하나에 생각 하나, 사람이 알아듣는 말) | `docs/intent/<concern id>.md` (트리의 어느 노드든) | 하나 |
| `domain-model` | lophn이 무엇을 기억하나: entity의 필드·제약, 상태와 전이, 관계, ledger 표, command, event, 정책 | `docs/domain-model/<concern id>.md` | 하나 |
| `requirements` | 어떻게 만들든 지켜야 하는 것 | `docs/requirements/<concern id>.md` | 하나 |
| `spec` | 동작의 구체(모양, 순서, 값, 오류) | `docs/spec/<concern id>.md` | 하나 |
| `architecture` | 프로세스, 저장, 경계, contract | `docs/architecture/<concern id>.md` | 하나 |
| `flow` | 여러 concern을 가로지르는 사용 흐름 | `docs/flows/<이름>.md` | 지나는 concern 모두 |

모든 문서의 첫 줄부터:

```yaml
---
type: requirements
concerns: [lophn-agent/harness/provider]
---
```

다른 문서를 가리킬 때는 concern id와 항목 번호로 적는다: `lophn-agent/harness/provider#R3`.

## 말

개발자가 평소 쓰는 말을 그대로 쓴다. 영어 단어를 그대로 쓰거나 굳은 음차를 쓴다. 뜻을 옮긴 번역어를 만들지 않는다.

| 쓰는 말 | 쓰지 않는 말 |
|---|---|
| ledger | 장부 |
| redaction | 가림 |
| 테스트, test result, test runner | 시험, 시험 결과, 시험 실행기 |
| snapshot | 그때 기록 |
| blob store, derived store | 내용 저장소, 파생 저장소 |
| release, blueprint | 앱 버전, 설계도 |
| invocation, automation, activation | 앱 실행 기록, 자동 작업, 활성화 |
| run, 세션 | 실행, 대화 |
| assignment, handoff, claim | 배치, 넘김, 맡음 |
| provider, judgment model, organizing model | 모델 연결, 판단 모델, 정리 모델 |
| confirmation window, acceptance check | 확인 창(보호 화면), 확인 조건 |
| watch, revert | 지켜봄, 되돌리기 |
| approval request, notification | 승인 요청, 알림 |

문서, 앱, 사람, 질문, 역할, 문제, 피드백처럼 원래 쓰는 말은 그대로 쓴다.

## requirements 쓰는 법

```markdown
---
type: requirements
concerns: [lophn-agent/harness/provider]
---
# lophn-agent/harness/provider

맡는 것 한 문단(concerns.yaml의 summary를 풀어 쓴다).

## 요구

**[R1]** 요구 한 문장.
- 이유: 왜 필요한가. 제품 가치, 이전 lophn에서 겪은 문제, 참고한 harness.
- 확인: 무엇을 해 보면 지켜졌다고 할 수 있나.
- 의도: 이 요구가 지키는 intent의 약속(예: lophn-agent/harness#I2).

## 열린 질문

## 버린 것

이전 요구 가운데 옮기지 않은 것과 그 이유.
```

1. **구체적으로 쓴다.** 읽고 나서 정반대의 두 설계가 모두 맞다면 너무 추상적이다.
2. **이름을 쓴다.** 지원하는 제품·계정·형식·OS·표준·프로토콜은 이름으로 적는다(ChatGPT OAuth, xAI, Anthropic Messages, OAuth device code, MCP stdio, Markdown, macOS).
3. **값을 쓴다.** 의미 있는 값은 숫자로 적는다(만료 60초 전 갱신, device code는 최대 15분 기다림).
4. **코드 식별자는 쓰지 않는다.** 표, 필드, 함수, ID 접두사, 파일 경로, event 이름은 domain model과 spec의 몫이다.
5. **요구 하나에 문장 하나.** 이유와 확인을 붙인다.
6. **다른 concern의 것은 쓰지 않고 가리킨다.** `apps/permissions#R4`처럼 적는다.
7. **정하지 않은 것은 열린 질문에 둔다.** 문서의 `## 열린 질문`에는 `<concern id>#Q<n>` 한 줄만 적고, 선택지와 추천은 [open-issues.md](../open-issues.md)에 모은다. 큰 결정은 거기의 H 번호로 가리킨다.
8. **말없이 버리지 않는다.** 이전 lophn 요구를 옮기지 않으면 "버린 것"에 이유와 함께 적는다.

## intent 쓰는 법

```markdown
---
type: intent
concerns: [lophn-agent/harness]
---
# lophn-agent/harness

## 왜
이 concern이 없으면 누가 어떤 곤란을 겪나. 두세 문장.

## 무엇을 약속하나

- **[I1]** 약속 한 줄. 사람이 알아듣는 말로, 밖에서 확인할 수 있게.
- **[I2]** …(필요한 만큼, 12개 이하)

## 하지 않는 것

## 잘되고 있다는 신호
```

1. **사람이 검수하는 문서다.** 한 화면 안에 들어가게 쓴다. 약속 하나에 생각 하나만 담고 한 줄로 쓴다. 곁가지는 requirements의 몫이다. 숫자와 제품 이름은 requirements의 몫이지만, 약속의 핵심이면 쓴다.
2. **트리의 어느 노드에도 둘 수 있다.** 요구는 가장 가까운 조상 노드의 intent 약속에 연결한다.
3. **requirements는 intent를 넘지 않는다.** 어느 약속에도 연결되지 않는 요구는 범위를 넘었거나 intent에 약속이 빠진 것이다. 요구가 하나도 없는 약속은 requirements가 빠뜨린 것이다.
4. **intent는 사람만 고친다.** agent가 intent와 맞지 않는 것을 찾으면 intent를 고치지 않고 [open-issues.md](../open-issues.md)에 올린다.
5. **intent가 requirements보다 위다.** intent가 바뀌어 기존 요구와 부딪히면 그 요구를 intent에 맞게 고친다. 번호는 유지하고, 고친 사실은 [open-issues.md](../open-issues.md)에 남긴다.
