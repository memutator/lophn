# bare-assembly

bare session의 turn이 정의 본문과 고른 tool만 model에 보낸다. 상한(place 종류 목록, credential)은 그대로다.

- 단위: bare (wave 2)
- 선행: bare-definition.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{prepare,input-text}.ts`(+test), `packages/core/lophn-agent/session/history.ts`
  - `packages/core/lophn-agent/prompt-assembly/{turn-prompt,basis,skill-list}.ts`(+test)
  - `packages/core/lophn-agent/tools/lophn/**`
  - `packages/core/lophn-agent/agents/resolve.ts`(MCP 고른 것만)
  - `packages/core/main/agent-tools_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 층, tool 목록, cache), `project-docs/architecture/approval.md`
  - 제품 결정: 계획 README 정한 것 1~5
- 계약:
  - 쓰는 것: `bare-definition`의 `ResolvedAgent.runtime`·`picks`
  - 내놓는 것: 없음

## 할 일

1. system: bare면 `prepare.ts`(`material` l.371, `build` l.576)가 place_kind(`PRODUCT_INSTRUCTIONS`, place 지침), 지침 층, skill 목록, place 정보 글을 만들지 않고 정의 본문 하나를 system으로 둔다. `place_kind_missing`(l.209)을 bare에서 오류로 보지 않는다. cache 표시는 그 block에.
2. `placeData`는 그대로 돌린다(file 범위).
3. tool: (고른 내장 tool ∩ `placeToolNames(kind)`) + `lophn` tool(고른 명령이 있을 때만, 그 명령만: `describeLophn`, `commandTools` `prepare.ts` l.493, help) + 고른 할당 앱 command + 고른 MCP. 상한 밖 이름은 보이지도 돌지도 않는다.
4. 경계 글: `untrusted` 결과를 내는 웹 tool을 골랐으면 `lophn-untrusted` 한 줄을 system 끝에 붙인다. 받은 call 글(`input-text.ts` l.155의 "`lophn call reply`로 답하라")은 bare면 "마지막 응답이 답이다"로 바꾸고, 받은 turn과 이력 재생이 같은 함수를 쓴다.
5. notice: bare는 tool이 바뀐 notice만 받는다. basis에서 agent 목록·지침을 뺀다.
6. 첫 요청 bytes를 home·project·app에서 lophn과 bare 예 하나씩 재서 보고에 적는다(test가 아니다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "place 종류 목록 밖을 고른 bare(home의 `shell.run`, project의 `app.create`)는 그 tool을 보지도 부르지도 못하고 credential 작업은 `placeOperations(kind)`와 같다"(`agent-tools_test.ts`를 넓힌다)
  - "bare `result` call의 받은 turn 글과 이력 재생 글이 같은 bytes다"(`input-text_test.ts`를 넓힌다)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 잰 bytes를 "정한 것"에 적는다.
