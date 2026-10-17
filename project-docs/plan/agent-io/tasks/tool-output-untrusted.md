# tool-output-untrusted

`wrapUntrusted`를 `prompt-assembly/input-tags.ts` 것 하나만 남기고, `run-loop/untrusted.ts`의 같은 이름 함수를 지운다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다.

- 단위: tool-output (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/untrusted.ts`
  - `packages/core/lophn-agent/run-loop/mod.ts`
  - `packages/core/lophn-agent/run-loop/history.ts`(import 한 줄만. 이 file은 `tool-output-image`가 이어서 고친다)
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "`wrapUntrusted`가 둘이다"(정한 것: 줄인다)
  - architecture: `project-docs/architecture/agent-definition.md`의 "감싸는 결과는 web 검색과 web 읽기뿐이다", "Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-tools`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `prompt-assembly/input-tags.ts`의 `wrapUntrusted(source, text)`(`prompt-assembly/mod.ts`가 `export *`로 내보낸다. web tool `tools/web/fetch.ts`, `search.ts`가 이미 쓴다), `run-loop/untrusted.ts`의 `untrustedSource(tool)`
  - 내놓는 것: `run-loop`에는 `wrapUntrusted`가 없다. `run-loop/mod.ts`는 `untrustedSource`만 내보낸다. 감싸는 모양은 `renderTag("untrusted", { source }, text)` 하나다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 할 일

근거: 이슈 "`wrapUntrusted`가 둘이다". 한쪽만 고치면 web 결과를 감싸는 모양이 둘로 갈라지고 닫는 tag를 흉내 내지 못하게 하는 방어(prompt injection 경계)가 한쪽에서 빠질 수 있다. architecture는 감싸는 결과를 web 검색·읽기로 고정한다.

1. `run-loop/untrusted.ts`에서 `wrapUntrusted`를 지운다. 그 함수만 쓰던 import(`INPUT_TAGS`, `escapeBody`)도 지운다. `untrustedSource`와 그 import(`toWireToolName`, `UNTRUSTED_SOURCES`, `UntrustedSource`)는 남긴다. 파일 머리 주석에서 "감싸는 글 안의 `<lophn-…`를 무력화한다"는 줄은 `wrapUntrusted`가 간 곳(`prompt-assembly/input-tags.ts`)의 일이므로 `untrustedSource`가 하는 일(어떤 tool 결과가 바깥 글인가)만 남긴다. 주석은 "왜"만 쓴다.
2. `run-loop/history.ts`는 `wrapUntrusted`를 `../prompt-assembly/mod.ts`에서 import한다(이 file이 `HistoryPart`를 이미 거기서 import한다. 새 import 줄을 더하지 말고 그 줄에 합친다). `untrustedSource`는 `./untrusted.ts`에서 계속 import한다.
3. `run-loop/mod.ts` 39번 줄 근처의 `export { untrustedSource, wrapUntrusted } from "./untrusted.ts";`를 `untrustedSource`만 내보내게 한다. `wrapUntrusted`를 `run-loop/mod.ts`에서 가져다 쓰는 곳이 없음은 확인했다(`grep -rn wrapUntrusted packages tools`: web tool 둘, `history.ts`, `input-tags_test.ts`가 전부). 바뀐 뒤에도 같은 grep을 다시 돌려 확인한다.
4. 기존 test `run-loop/untrusted_test.ts`("web 결과의 닫는 tag는 무력화되고 파일·shell 결과는 감싸지지 않는다")는 `historyResultParts`로 보므로 고치지 않고 그대로 통과해야 한다. `input-tags_test.ts`도 그대로다. 새 test는 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (감싸는 모양과 tag 무력화는 `untrusted_test.ts`와 `input-tags_test.ts`가 이미 본다. 한 동작은 한 층에서만 본다)
- 남지 않음: `grep -n "wrapUntrusted" packages/core/lophn-agent/run-loop/untrusted.ts packages/core/lophn-agent/run-loop/mod.ts`가 0줄이다. `grep -rn "function wrapUntrusted" packages`가 `prompt-assembly/input-tags.ts` 한 줄뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`prompt-assembly/mod.ts`는 이미 `export *`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `run-loop/input-text.ts`의 `escapeBody`는 다른 곳이 쓰므로 남는지만 적는다
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
