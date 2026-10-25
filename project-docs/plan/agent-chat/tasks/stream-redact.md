# stream-redact

live 글에 아직 다 오지 않은 secret의 앞부분이 나가지 않게 하는 core 함수를 만든다. `redactSettled(text, known)`(`packages/core/lophn-agent/run-loop/runtime-redaction.ts`)은 한 model 호출에서 쌓인 날 글 전체를 지금의 redaction(알려진 secret 값과 credential 규칙)으로 가리고, 끝에 아직 다 오지 않았을 수 있는 secret이 시작하는 자리(`hold_from`)부터는 뗀 글을 낸다. `stream-core`의 core `live-turns.ts`가 child가 보낸 날 글에 이것을 걸어 `ModelOutputStreamed`를 낸다.

정한 것(planner): live 글의 redaction은 core가 한다(README "정한 것"). child가 redact pipe에 "이 끝이 secret의 앞부분인가"를 물을 수 있으면 글을 골라 거듭 물어 secret 값을 한 글자씩 알아낼 수 있다. 그래서 붙잡을 자리는 값을 아는 core 안에서만 쓰고, 감독 pipe(`redact_request`·`redact_response`)와 child 쪽(`redact-link.ts`)은 바꾸지 않는다. 상수로 붙잡으면(`stream-core` 초안의 256자) 그보다 긴 값(OAuth token, JWT)의 앞부분이 나가므로 자리를 정확히 정한다.

- 단위: stream (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/base/redaction/{registry,patterns,mod}.ts`
  - `packages/core/storage/ledger/{known-secrets,reader-worker}.ts`
  - `packages/core/secrets/secret-store.ts`
  - `packages/core/lophn-agent/run-loop/runtime-redaction.ts`
  - `packages/core/lophn-agent/run-loop/runtime-redaction_test.ts` (새 file)
  - `packages/core/apps/permissions/secret-value_test.ts` (가짜 matcher에 한 줄)
  - `packages/core/apps/oauth/service_test.ts` (가짜 matcher에 한 줄)
- 읽을 것:
  - 계획:
    - `project-docs/plan/agent-chat/README.md`의 "정한 것" 뼈대 검토 "live 글의 redaction은 core가 한다"와 "위험 test" 셋째 줄
    - `tasks/stream-core.md` 할 일 3(`createLiveTurns`의 `output`이 이 함수를 부른다)
    - `tasks/chat-protocol.md` 내놓는 것의 `ModelOutputStreamed`와 감독 pipe `model_output`
  - architecture: `project-docs/architecture/event.md` 51줄(Bus는 core 안에 하나이고 agent runtime은 child process라 감독 pipe로 core와 말한다)
  - boundary·module:
    - `project-docs/boundary-catalog.yaml`의 element `run-loop`, `secrets`, `storage`, `base`. interface `child-supervision-protocol`은 바꾸지 않는다.
    - `project-docs/module-catalog.yaml`의 `packages/base`, `packages/core/lophn-agent`, `packages/core/secrets`, `packages/core/storage`
  - skill: `.claude/skills/write-test/SKILL.md`
  - 코드:
    - core 쪽:
      - `packages/core/lophn-agent/run-loop/runtime-redaction.ts`(`spansOf`: 제품 redactor와 같은 규칙, `answerRedactRequest`: 고치지 않는다)
      - `packages/core/storage/ledger/known-secrets.ts`(`KnownSecretMatch`)
      - `packages/core/secrets/secret-store.ts` 125줄(core의 matcher. `packages/core/main/daemon/wiring/secrets.ts` 49줄이 `ctx.knownSecrets`로 준다)
      - `packages/core/storage/ledger/reader-worker.ts` 34줄(reader의 matcher)
    - base:
      - `packages/base/redaction/registry.ts`(`match`, `boundedIndex`: 1·2자 값은 단어 경계에서만 맞춘다)
      - `packages/base/redaction/patterns.ts`(`CREDENTIAL_PATTERNS`, `PATTERN_SOURCE`, `matchCredential`)
      - `packages/base/redaction/stream.ts`(같은 process 안에서 꼬리를 붙잡는 본보기. 가장 긴 값 길이만큼 붙잡는다)
      - `packages/base/redaction/product-redactor.ts`(완성된 글만 지운다. 고치지 않는다), `packages/base/redaction/model.ts`(`REDACTION_REPLACEMENT`)
    - test 본보기: `packages/base/redaction/product-redactor_test.ts`(가짜 matcher), `packages/core/apps/runtime/observations/log-file_test.ts`(진짜 registry)
- 계약:
  - 쓰는 것: `KnownSecretMatch`, `matchCredential`, `REDACTION_REPLACEMENT`. 감독 pipe(`redact_request`·`redact_response`, `packages/protocol/supervision/supervision.ts`)는 바꾸지 않는다.
  - 내놓는 것:
    - `redactSettled(text: string, known: KnownSecretMatch | undefined): string | null`(`packages/core/lophn-agent/run-loop/runtime-redaction.ts`). core 안에서만 쓴다.
      - `text`(한 model 호출에서 쌓인 날 글 전체)를 `spansOf`와 같은 규칙으로 지워(span마다 `REDACTION_REPLACEMENT`) 붙잡는 자리 앞까지만 낸 글이다. 붙잡을 것이 없으면 전체를 지운 글이다.
      - `known`이 없거나 `ready`가 아니면 null이다(fail-closed).
      - 붙잡는 자리(`hold_from`)는 `text`의 UTF-16 index다. 그 자리부터 끝까지가 아직 다 오지 않은 secret의 시작일 수 있는 가장 작은 자리이고, 둘 중 하나에 걸린다.
        - (a) 끝 글이 알려진 값의 앞부분이다(값 전체도 넣는다).
        - (b) 끝 글이 credential 규칙의 match로 이어질 수 있는 앞부분이거나, 끝에 닿아 더 길어질 수 있는 match다.
        - 어느 span 안에도 떨어지지 않는다. 떨어지면 그 span의 시작이다.
      - 지키는 것: 붙잡은 자리 앞의 글은 뒤에 글이 더 와도 바뀌지 않는다(바뀔 수 있는 끝을 붙잡는 것이 이 함수의 일이다). `stream-core`는 앞서 낸 길이 뒤로 늘어난 부분만 낸다.
    - `KnownSecretMatch.prefixFrom(text: string): number | undefined`(`packages/core/storage/ledger/known-secrets.ts`). base `KnownSecretRegistry`에도 같은 이름으로 둔다.
    - `credentialPrefixFrom(text: string): number | undefined`(`packages/base/redaction/mod.ts`).
    - `answerRedactRequest`와 child의 `redact`(`run-loop/redact-link.ts`)는 그대로다. 붙잡는 자리는 child에 가지 않는다.

## 할 일

정한 것(살 단계):
- **함수는 `runtime-redaction.ts`에 둔다.** 제품 redactor와 같은 규칙의 `spansOf`가 거기 있고, core가 child에서 온 글의 안전화를 정하는 자리다. `product-redactor.ts`는 base라 core `KnownSecretMatch` 대신 자기 type을 쓰고, 그 동기 redactor 모양(`TextRedactor`)을 바꿔야 한다.
- **window가 없다.** core 안이라 pipe 상한(`REDACT_UNITS_MAX`)이 없고 쌓인 글 전체를 한 번에 본다. child의 window 경계(`REDACT_OVERLAP`) 규칙은 여기에 오지 않는다.
- **알려진 값은 앞부분과 값 전체를 붙잡는다.**
  - 1·2자 값은 다음 글자가 단어 경계일 때만 match다(`registry.ts`의 `boundedIndex`). 그래서 끝에 닿은 값 전체도 다음 글자에 따라 지울지가 바뀐다.
  - 값 전체를 붙잡는 비용은 그 값의 `REDACTION_REPLACEMENT`가 다음 batch까지 늦는 것뿐이다.
  - 더 긴 값의 앞부분인 값은 (a)가 이미 잡는다.
- **붙잡는 자리는 span 안에 떨어지지 않는다.** 알려진 값 B의 앞부분이 완성된 값 A의 가운데서 시작할 수 있다. 그 자리에서 자르면 A의 앞부분이 지워지지 않은 채 낸 글에 남는다. 그래서 그 span의 시작으로 내린다.
- **pattern 쪽은 `patterns.ts`의 규칙 항목 옆에 둔다.**
  - `product-redactor.ts`는 완성된 글을 지우는 동기 redactor라 붙잡을 일이 없다.
  - 규칙(`CREDENTIAL_PATTERNS`)과 "이어질 수 있는가"가 한 항목에 있어야 규칙을 바꿀 때 같이 바뀐다.
- **pattern 쪽은 넓게 잡아도 된다.** 넓으면 더 붙잡을 뿐이고 다음 batch에 풀린다. 좁으면 secret 앞부분이 live 글에 나간다. 지금 규칙 중 `MIN_CREDENTIAL_LENGTH`(24자)로 덮이지 않는 것이 있다. JWT는 최소 29자이고 첫 조각이 길면 수백 자 동안 match가 아니다. PEM은 몸 전체가 footer를 기다린다. 그래서 길이가 아니라 "이어질 수 있는가"로 본다.
- **글 길이에 한 번 훑는 비용이다.** `stream-core`가 batch(약 50ms)마다 쌓인 글 전체에 부른다. 값 쪽은 값마다 끝 (값 길이)자만 보고, pattern 쪽은 끝에서 거꾸로 규칙마다 "그 뒤 글"이 끝까지 이어지는 묶음을 찾는다. 자리마다 남은 글을 slice하지 않는다.

1. `packages/base/redaction/registry.ts` (근거: element `base`, 위 정한 것 "알려진 값은 앞부분과 값 전체")
   - `KnownSecretRegistry`에 `prefixFrom(text: string): number | undefined`를 더한다. `text.slice(i)`가 어떤 값의 앞부분(1자 이상, 값 전체 포함)인 가장 작은 i다.
   - 값마다 `text`의 끝 (값 길이)자 안에서 값의 첫 글자와 같은 자리만 보고 글자를 비교한다. 자리마다 새 문자열을 만들지 않는다.
   - 주석에 값 전체도 넣는 이유를 적는다.
2. `packages/base/redaction/patterns.ts`, `packages/base/redaction/mod.ts` (근거: 위 정한 것 "pattern 쪽")
   - `export function credentialPrefixFrom(text: string): number | undefined`. `text.slice(i)`가 어느 규칙의 match로 이어질 수 있는 앞부분이거나 끝에 닿아 더 길어질 수 있는 match인 가장 작은 i다.
   - `CREDENTIAL_PATTERNS` 항목마다 고정 prefix 묶음과 "그 뒤 글"을 둔다. 자리 i는 `text.slice(i)`가 고정 prefix의 앞부분이면 걸린다. 고정 prefix로 시작하고 그 뒤 글이 끝까지 아래에 맞아도 걸린다.

     | 규칙 | 고정 prefix | 그 뒤 글 |
     |---|---|---|
     | openai | `sk-` | `[A-Za-z0-9]*` |
     | anthropic | `sk-ant-` | `[A-Za-z0-9_-]*` |
     | github | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` | `[A-Za-z0-9]*` |
     | aws | `AKIA` | `[0-9A-Z]{0,16}` |
     | slack | `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-` | `[A-Za-z0-9-]*` |
     | jwt | `eyJ` | `[A-Za-z0-9_.-]*` (`.`의 개수와 조각 길이는 따지지 않는다) |
     | pem | header 여섯: `-----BEGIN PRIVATE KEY-----`, 그리고 그 사이에 `RSA `·`EC `·`OPENSSH `·`DSA `·`ENCRYPTED `가 든 것 | 완성된 END footer(`-----END (…)?PRIVATE KEY-----`)가 아직 없는 글 |

   - 주석에 "넓게 잡아도 된다, 좁으면 앞부분이 나간다"를 적는다.
   - `PATTERN_SOURCE`(revision hash)에는 넣지 않는다. 지우는 규칙이 아니라 지우는 결과가 같다.
   - `mod.ts`의 `patterns.ts` export 줄에 `credentialPrefixFrom`을 더한다.
3. `KnownSecretMatch` (근거: element `storage`, `secrets`)
   - `packages/core/storage/ledger/known-secrets.ts`: `prefixFrom(text: string): number | undefined`를 더한다. 주석: 끝 글이 알려진 값의 앞부분인 가장 이른 자리이고, 값·길이·개수는 내지 않는다.
   - 구현은 registry에 넘긴다.
     - `packages/core/secrets/secret-store.ts`의 `known`(125줄): `prefixFrom: (text) => coreKnown.prefixFrom(text)`.
     - `packages/core/storage/ledger/reader-worker.ts`의 `matcher`(34줄): 같은 한 줄. reader port(`KNOWN_SECRETS`)도 같은 type을 약속한다.
   - 가짜 matcher 둘에 `prefixFrom: () => undefined`를 더한다: `packages/core/apps/permissions/secret-value_test.ts` 56줄, `packages/core/apps/oauth/service_test.ts` 90줄.
   - 고치지 않는 것: `product-redactor.ts`는 자기 `KnownSecretMatch` type(`match`, `ready`)을 쓴다. `packages/core/main/daemon/wiring/lophn-agent-session.ts`의 감싼 matcher도 그 type이다.
4. `packages/core/lophn-agent/run-loop/runtime-redaction.ts` (근거: element `run-loop`, 위 정한 것)
   - `holdFrom(text: string, known: KnownSecretMatch, spans: Span[]): number | null`.
     - `known.prefixFrom(text)`와 `credentialPrefixFrom(text)` 중 작은 것이다. 둘 다 없으면 null이다.
     - 그 자리를 품은 span(`index < hold < index + length`)이 있으면 그 span의 `index`로 내린다. `spansOf`의 span은 겹치지 않고 앞에서부터라 한 번 훑으면 된다.
   - `export function redactSettled(text: string, known: KnownSecretMatch | undefined): string | null`.
     - `known`이 없거나 `!known.ready`이면 null이다.
     - `spansOf(text, known)`와 `holdFrom`을 구한다. hold가 null이면 `text.length`다.
     - `text.slice(0, hold)`에 끝이 hold 이하인 span만 `REDACTION_REPLACEMENT`로 바꿔 낸다. hold에서 시작하는 span은 넣지 않는다.
   - `spansOf`와 `answerRedactRequest`는 그대로다.
   - 머리 주석(9-12줄)에 더한다: core가 child가 보낸 쓰는 중인 model 글을 화면에 내기 전에 같은 규칙으로 가리고, 아직 다 오지 않았을 수 있는 secret의 시작부터는 붙잡는다(`redactSettled`). 붙잡는 자리는 core 안에서만 쓰고 child에 답하지 않는다. 답하면 child가 글을 골라 거듭 물어 값을 앞에서부터 한 자씩 맞춰 볼 수 있다.
5. 위험 test `packages/core/lophn-agent/run-loop/runtime-redaction_test.ts` (새 file. 근거: README "위험 test"의 secret 경계, `write-test`. 순수 함수만 쓰고 subprocess도 timer도 없다)
   - `Deno.test("글 끝에 걸친 secret의 앞부분은 redactSettled가 내지 않는다", …)` 하나다.
   - 준비는 한 번 한다. `createKnownSecretRegistry()`에 값 셋을 넣는다.
     - 300자가 넘는 opaque 값 L(지금 상수 256보다 길다)
     - 값 A
     - A의 끝 몇 자로 시작하는 값 B
     - matcher는 `{ ready: true, match, prefixFrom }`로 registry에 넘긴다.
   - 표 하나(text → 기대 결과). 줄마다 `redactSettled(text, matcher)`를 부른다. `*`는 `REDACTION_REPLACEMENT`다.
     - 앞글 + L의 앞 절반 → 앞글
     - 앞글 + L 전체 → 앞글
     - 앞글 + L + `" 뒤글."` → 앞글 + `*` + `" 뒤글."`(완성된 값)
     - 앞글 + `sk-ant-api03-` + 5자 → 앞글
     - 앞글 + `eyJ` + 400자 + `.` + 5자(긴 JWT) → 앞글
     - 앞글 + PEM header + footer 없는 몸 500자 → 앞글
     - 앞글 + `ghp_` + 30자(끝에 닿은 완성된 match) → 앞글
     - 앞글 + `ghp_` + 30자 + `" 뒤글."` → 앞글 + `*` + `" 뒤글."`(완성된 key)
     - 앞글 + A + B의 앞부분(B가 A 안에서 시작한다) → 앞글
     - 끝이 `.`인 보통 글 → 그대로
     - matcher가 `ready: false`이면 → null
   - 앞글과 "그대로" 줄의 끝 글자는 고정 prefix의 첫 글자(`s`, `e`, `g`, `A`, `x`, `-`)가 아니어야 한다. 그 글자로 끝나면 그 글자부터 붙잡힌다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "글 끝에 걸친 secret의 앞부분은 redactSettled가 내지 않는다"(`runtime-redaction_test.ts`). `deno test --no-check packages/core/lophn-agent/run-loop/runtime-redaction_test.ts`로 돌린다.
- 남지 않음: 지우는 이름이 없다. `grep -n "prefixFrom" packages/core/secrets/secret-store.ts packages/core/storage/ledger/reader-worker.ts`가 각 file에 한 줄 이상이다. 감독 pipe와 child(`redact-link.ts`)는 소유 밖이라 고치지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없을 것이다(`base/redaction/mod.ts`는 이 task 소유다). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 이 task 뒤에도 남는 것: `stream-core`가 `live-turns.ts`에서 부르기 전에는 `redactSettled`를 아무도 쓰지 않는다.
