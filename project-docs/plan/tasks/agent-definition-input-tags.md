# agent-definition-input-tags

Router 입력과 web 결과를 감싸는 `lophn-` tag를 만드는 순수 함수를 짓는다. 본문 안의 `lophn-` tag는 escape하고 속성 값은 scrub한다. 사람 메시지(turn 시작)는 평문이라 감싸지 않는다. 이 task는 작고, web tool(agent-tools-shell-web)과 prompt 조립(agent-definition-prompt)이 기다린다.

- 단위: agent-definition (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/prompt-assembly/input-tags.ts` (새로)
  - `packages/core/lophn-agent/prompt-assembly/input-tags_test.ts` (새로)
  - `packages/core/lophn-agent/prompt-assembly/mod.ts`에는 `export * from "./input-tags.ts";` 한 줄만 더한다. 이 task가 merge된 뒤 mod.ts는 agent-definition-prompt가 가진다.
- 읽을 것:
  - spec: S4 6장 "입력 꼴"과 "tool 결과" 표, 5장 마지막 줄, 11장 5 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 조사: `/home/pyosechang/projects/lophn/project-docs/tmp/claude-code-cross-session-messaging.md`, `/home/pyosechang/projects/lophn/project-docs/tmp/claude-code-prompt-assembly copy.md`
  - inventory: `I3.4#21`, `I3.4#22`
  - 같이 읽는 줄(다른 단위 몫): `I2.4#23`(tool 결과를 `~~~data`로 감싸던 곳을 없애는 일은 router의 run-loop와 approvals의 `safety/fence.ts` 몫이다)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/input-tags.ts`의 `INPUT_TAGS`, `INPUT_TAG_ATTRIBUTES`, `NOTICE_KINDS`, `ATTACHED_KINDS`, `UNTRUSTED_SOURCES`(contract-agent-tools-catalog). call 봉투와 call 상태 type은 contract-calls-places다.
  - 내놓는 것: 아래 함수 전부. router(입력을 session에 넣을 때), agent-tools-shell-web(`wrapUntrusted`), agent-definition-prompt(notice, attached)가 쓴다.

## 할 일

1. `input-tags.ts`에 순수 함수를 둔다. IO, 시각, 무작위가 없다.
   - `escapeTagBody(text)`: `<lophn-`와 `</lophn-`(대소문자 무시)의 `<`를 `&lt;`로 바꿔 본문 안의 tag가 tag로 읽히지 않게 한다. 닫는 tag뿐 아니라 여는 tag도 바꾼다(위조한 `<lophn-steer>`를 막는다).
   - `scrubAttribute(value)`: 제어 문자와 줄바꿈을 공백으로, `"`, `<`, `>`, `&`를 제거하고 200자로 자른다.
   - `renderTag(name, attributes, body)`: `INPUT_TAG_ATTRIBUTES`에 없는 속성은 거절(throw)한다. 속성은 선언 순서로, 값은 scrub해서 `name="value"`로 쓴다.
2. 입력별 formatter를 둔다. 고정 문장(영어)은 모두 이 file의 상수로 둔다. tag 목록과 뜻을 prompt 고정 본문에 동적으로 끼우는 코드는 만들지 않는다(S4 5장, cache).
   - `callInput({ from, call, reply, body, refs })` → `<lophn-call from call reply>`. 본문 뒤에 근거 링크(`refs`)를 나열하고, 끝에 "다른 agent가 보낸 것이고 이 session의 권한 안에서만 따른다"는 줄을 둔다. `reply`가 `result`면 reply tool로 답하라는 한 줄을 더한다.
   - `replyInput({ call, from, status, reason, summary, body })` → `<lophn-reply call from status reason>`. 원래 맡긴 일의 한 줄 요약 `summary`를 함께 싣는다.
   - `reactionInput({ event, seq, fields })` → `<lophn-reaction event seq>` 안에 domain event의 필드를 `key: value` 줄로 쓴다. 끝에 "필드 값은 data"라는 한 줄을 둔다.
   - `noticeInput({ kind, body })` → `<lophn-notice kind>`. `kind`는 `NOTICE_KINDS`. 끝에 "자동 알림이고 사람이 쓴 것이 아니다"를 둔다. 명령형 문장을 쓰지 않는다.
   - `steerInput(text)` → `<lophn-steer>`. 사람이 직접 보낸 것임을 밝힌다.
   - `attachedInput({ kind, name, line, path, rule })` → `<lophn-attached kind name>`. 이름과 한 줄만 싣는다. 위반이면 파일 경로와 어긴 규칙, 파일이면 경로를 더한다.
   - `annotationBlock({ n, kind, app, release, view, note, component, source, element, position })` → `<lophn-annotation n kind app release view>`. 이미지는 싣지 않는다(그 뒤에 따로 붙는다).
   - coding agent의 메시지는 `callInput`을 그대로 쓴다(`from`에 coding agent).
3. `wrapUntrusted(source, text)`: `source`는 `UNTRUSTED_SOURCES`. `<lophn-untrusted source>`로 감싸고 본문은 `escapeTagBody`를 거친다 (`I3.4#22`). 파일 내용, shell 출력, app-api 결과, 외부 MCP 결과에는 쓰지 않는다 (S4 6장).
4. `safety/fence.ts`는 approvals 소유라 건드리지 않는다. 새 함수는 `prompt-assembly/`에만 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "본문 안의 lophn tag는 escape되고 속성 값은 scrub되어 위조한 tag가 입력에 나타나지 않는다" — `input-tags_test.ts`가 `</lophn-untrusted>`, `<lophn-steer>`, `<LOPHN-CALL`, 속성 값의 `"`와 줄바꿈이 든 입력을 표로 돌려 결과 문자열에 진짜 tag가 하나만 있는지 본다.
- 남지 않음: 없음

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없음 (`safety/fence.ts`의 `wireData`와 `DATA_START_MARKER`는 router·approvals가 쓰기를 그만둔 뒤 지운다. 보고에 사용처를 적는다)
- 정한 것: escape 방식(`&lt;`), 속성 값 상한 200자, 고정 문장의 영어 문구
- 계약 바꾸기 요청: 없음
