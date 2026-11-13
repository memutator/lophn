# 당시 요청

메인 session `ses_01m74tjyb2vgjrjyfsvfdwqyg4`(lophn project, Opus 5.5)이 받은 사람 말과, 페이지마다 team session에 준 brief(그 session의 첫 메시지)다. 새 skill로 다시 만들 때 같은 brief를 쓴다.

## 사람이 한 말

- 2026-11-11 08:11 UTC: 현재 이 프로젝트의 맥락을 어떻게 관리하는 지 분석하고 그에 따라 필요한 아티팩트 제안 좀 해줘
- 2026-11-11 08:17 UTC: .claude/skills 에서 추가 맥락 조사 좀 해봐
- 2026-11-11 08:40 UTC: 너가 근데 삭제된 project-docs에 대해서 어떻게 알아
- 2026-11-11 08:45 UTC: 한 번 일단 다 만들어봐 
- 2026-11-11 08:45 UTC: 그 뭐냐 병렬 세션으로 만들어봐

## team session에 준 brief

### context-health

session: `ses_01m74wjsk9bnevnd4defq3h8eq` (맥락 건강 결과 페이지 만들기)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 만들어라: 이름 `context-health`, 제목 "맥락 건강". 먼저 skill `write-artifact`를 읽고 그대로 따른다.

목적: agent들이 읽는 맥락(AGENTS.md, .claude/skills, project-docs 문서·catalog)이 코드와 어긋나 낡은 맥락으로 일할 위험을 사람이 한눈에 판단한다. 맨 위에 요약(문제 몇 건, 영역별), 그 아래 묶음별 목록.

묶음(저장소 /home/pyosechang/projects/lophn, 읽기만. 저장소 파일을 고치지 않는다):
1. 코드보다 뒤처진 조각: 저장소 root에서 `node tools/context-review.ts --range HEAD~30..HEAD` 를 돌린 "다시 볼 조각" 목록(지금 30개쯤). 조각을 kind(지침, skill, 문서, catalog, tool)별로 묶어 보인다.
2. 낡은 참조: 확인된 예 — project-docs/plan/README.md가 끝남 기준을 `deno task check`라 씀(저장소는 npm), .claude/skills/harness-gui/SKILL.md가 없어진 perf-stream-lag worktree를 가리킴, .claude/settings.local.json의 자동 허용이 없어진 tests/eval·deno task eval을 가리키고 실제 provider 비용($50까지) 허락 줄이 남음. 비슷한 것을 skill·AGENTS.md·plan 문서에서 path 존재 검사로 더 찾는다.
3. 막는 장치가 이어지지 않은 실수: project-docs/issues 중 kind: mistake 이고 status: open(5건). 각 `prevent`가 실제로 반영됐는지 확인(예: 본보기 대조 문장은 planner-persona·orchestrate에 없음, SDK pin 검사는 tools/check-deps.ts에 없음, terminal 문장은 architecture/terminal-agent.md에 반영됨).
4. 끝났는데 남은 plan: project-docs/plan/*/status.md 에서 모두 merged인데 폴더가 남은 것(browser-vault).
5. 너무 커진 문서: architecture/*.md 중 큰 것(agent-definition 111KB, workspace-layout 105KB 등)과 skill 중 큰 것(harness-gui reference 33KB, orchestrate 26KB).
6. 다른 harness가 못 받는 맥락: .claude/skills는 Claude Code만 읽는다. 이 lophn project Skills 폴더는 비어 있다.

방식: 새로 고침은 요청할 때. 폴더에 collect.mjs를 두어 위 검사를 다시 돌려 data/latest.json(수집 시각 포함)을 쓰고, 탭 머리 status에 수집 시각을 보인다. 화면 글은 한국어(개발자 영어 단어는 그대로). raw log나 명령은 펼치지 않고 문서 이름 정도만 보인다. 다 만들면 tab open --artifact로 열어 screenshot과 logs로 확인한다.

끝나면 call reply로 짧게: 묶음별 건수, 가장 위험한 것 셋, 확실하지 않은 것.
```

### decisions

session: `ses_01m74wjsktbth23sc71zydf19n` (결정 대기함 페이지 만들기)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 만들어라: 이름 `decisions`, 제목 "결정 대기함". 먼저 skill `write-artifact`를 읽고 그대로 따른다.

목적: 사람(CTO·PM)이 지금 정해야 할 것을 한 화면에서 보고 판단한다. 맨 위에 몇 건이 기다리는지, 그 아래 한 줄씩: 무엇을 정해야 하나, 왜 막혀 있나, agent의 추천(있으면), 어디서 나왔나(사람 말로: "이슈", "정책 제안", "계획 확인", "메모").

재료(저장소 /home/pyosechang/projects/lophn, 읽기만. 저장소의 파일을 고치지 않는다):
- project-docs/issues/*.yaml 중 status: open 이고 `decide:` 칸이 있는 것(지금 4건쯤). title, decide, fix의 추천.
- project-docs/products/AGENT.md 의 "(제안)" 이 붙은 줄(12줄쯤): 사람이 아직 확인하지 않은 정책.
- project-docs/plan/*/README.md 의 "사람이 정할 것", "남은 것" 절. 예: ui-overhaul은 main에 올리기 전 사람이 Electron에서 직접 확인할 목록이 있다. browser-vault는 task가 다 merged인데 폴더가 남아 있다(닫을지).
- root의 issue.md: 아직 이슈로 올리지 않은 harness GUI 메모.
- project-docs/products/roadmap/*.md 의 "정할 것" 절이 있으면 그것도.

방식: 새로 고침은 요청할 때(refresh on request). 폴더에 collect.mjs를 두어 저장소를 읽고 data/latest.json(수집 시각 포함)을 쓰게 하고, 탭 머리 status에 수집 시각을 보인다. 화면 글은 한국어(개발자 영어 단어는 그대로). path, id, 명령은 화면에 펼치지 않는다. 다 만들면 tab open --artifact 로 열어 screenshot과 logs로 확인한다.

끝나면 call reply로 짧게: 몇 건을 보였는지, 그중 가장 급한 것 셋, 확실하지 않은 것.
```

### decision-log

session: `ses_01m74wjsm84f0t4sh286dpq3ek` (결정 기록 페이지 만들기)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 만들어라: 이름 `decision-log`, 제목 "내가 정한 것". 먼저 skill `write-artifact`를 읽고 그대로 따른다.

목적: 사람이 "이거 전에 정했었나?"에 바로 답을 찾는다. 사람이 정한 결정만 주제별로, 새것부터. agent가 정한 것은 접어 두거나 따로 거른다. 검색 칸 하나.

재료(저장소 /home/pyosechang/projects/lophn, 읽기만. 저장소 파일을 고치지 않는다):
- project-docs/products/change-log/<x.y>/*.yaml 의 `decisions` 칸(by: person 약 412줄, by: agent 약 872줄). 항목의 title, version으로 언제인지(판보다 git log 날짜가 사람에게 낫다), modules로 주제를 잡는다.
- project-docs/issues/*.yaml 의 `decided` 칸.
- project-docs/products/roadmap/*.md 의 "정한 것 (사람)" 절.
- .claude/skills/*/SKILL.md 안의 사람 말 인용 "(사람: ...)"(7군데쯤)과 ui-design의 "모든 화면의 규칙 (사람이 wireframe 리뷰에서 정함)", harness-gui의 "기준은 사람이 정했다" 같은 줄: 사람의 작업 방식·취향 결정.
- project-docs/products/AGENT.md 에서 "(제안)" 이 없는 줄은 정한 정책이다(양이 많으면 주제 이름과 건수만).
주제는 architecture 문서 이름이나 영역(agent, app, harness GUI, 화면, 작업 방식 등)으로 사람이 알아볼 말로 묶는다.

방식: 새로 고침은 요청할 때. 폴더에 collect.mjs를 두어 data/latest.json(수집 시각 포함)을 쓰고, 파일이 4 MiB를 넘으면 나눈다. 탭 머리 status에 수집 시각. 화면 글은 한국어(개발자 영어 단어 그대로). path·id는 펼치지 않는다. 다 만들면 tab open --artifact로 열어 screenshot과 logs로 확인한다.

끝나면 call reply로 짧게: 사람 결정 몇 건, 주제 몇 개, 서로 어긋나 보이는 결정이 있으면 그것, 확실하지 않은 것.
```

### context-map

session: `ses_01m74wjsmrztmgnzjcvkd6wm3y` (역할별 맥락 지도 artifact 만들기)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 만들어라: 이름 `context-map`, 제목 "역할별 맥락 지도". 먼저 skill `write-artifact`를 읽고 그대로 따른다.

목적: 사람이 이 저장소에서 일하는 agent 역할(planner, lead, worker, designer)마다 무엇을 읽고 어떤 도구를 돌리는지, 그리고 그 맥락을 어느 harness가 실제로 받는지를 한눈에 본다. 노드 그림(LophnKit.renderGraph 또는 ui.data.GraphDiagram)으로 역할 → 조각 연결을 보이고, 아래에 역할별 요약(늘 실리는 것, 일에 따라 실리는 것, 필요할 때 읽는 것)을 둔다.

재료(저장소 /home/pyosechang/projects/lophn, 읽기만. 저장소 파일을 고치지 않는다):
- project-docs/context-component-registry.yaml: roles와 components(id, kind, roles, path, change_reasons). kind는 instruction, skill, doc, catalog, record, plan, tool.
- 실리는 방식: AGENTS.md는 Claude Code·Codex·OpenCode 모두 root에서 읽는다. .claude/skills는 Claude Code만 불러온다. project-docs/plan/tools/lead/prompt.py가 worker prompt를 만든다(AGENTS.md와 brief, write-test skill을 가리킴). lophn project Skills 폴더(/home/pyosechang/.lophn/projects/prj_01m664qk6c68vbvb5br15dr7dt/skills)는 비어 있다. 이 사실로 "Claude Code만 받는 맥락"을 표시한다.
- 조각의 크기(바이트)도 보여 무거운 역할을 드러낸다.
그래프가 너무 빽빽하면 조각을 kind별로 묶은 노드로 줄이고, 자세한 목록은 아래에 둔다.

방식: 새로 고침은 요청할 때. 폴더에 collect.mjs를 두어 data/latest.json(수집 시각 포함)을 쓰고 탭 머리 status에 수집 시각을 보인다. 화면 글은 한국어(개발자 영어 단어 그대로). 다 만들면 tab open --artifact로 열어 screenshot과 logs로 확인한다.

끝나면 call reply로 짧게: 역할별 조각 수와 크기, Claude Code만 받는 맥락이 무엇인지, 확실하지 않은 것.
```

### project-docs

session: `ses_01m74wjtfx4833ktfq6js0vnw9` (프로젝트 문서 artifact 재생성)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 다시 만들어라: 이름 `project-docs`, 제목 "프로젝트 문서". 먼저 skill `write-artifact`를 읽고 그대로 따른다. project memory에 이 artifact가 있었다고 적혀 있으나 지금 artifacts 폴더에는 없다.

내용(memory에 적힌 대로): 요약 page, 이슈, journey, scenario, wireframe gallery. 탭 머리의 tabs로 나눈다.
- 이슈: project-docs/issues/*.yaml(338건). 상태·kind·topic으로 거르고, 한 줄에 title과 상태, 펼치면 now/impact/fix 요약.
- journey: project-docs/flows/journeys/*.yaml(group별 journeys, steps의 do와 screen).
- scenario: project-docs/flows/scenarios/*.yaml.
- wireframe gallery: 저장소 tools/wireframes(renderer를 그리는 gallery). `npm run wireframes`로 tools/wireframes/dist를 만들 수 있다(dist는 git에서 무시된다. 저장소의 다른 파일은 고치지 않는다). memory대로 gallery는 minified로, 파일 하나가 4 MiB를 넘지 않게 나눠 artifact 폴더에 넣는다. 원본은 저장소에 그대로 둔다. gallery가 artifact의 봉인된 환경(네트워크 없음, /_lophn/kit 말고 외부 library 없음)에서 돌지 않으면 무리하지 말고, 화면 이름·설명 목록과 journey가 가리키는 screen 연결만 보이고 그렇다고 보고한다.
- 요약: 위 숫자와 열린 이슈 상위 topic.

저장소는 /home/pyosechang/projects/lophn. 읽기만 하고 dist 말고는 쓰지 않는다.
방식: 새로 고침은 요청할 때. memory에 적힌 대로 폴더에 tools/build.mjs(데이터)와 tools/build-wireframes.mjs(gallery)를 둔다. data에 수집 시각을 넣고 탭 머리 status에 보인다. 화면 글은 한국어(개발자 영어 단어 그대로). 다 만들면 tab open --artifact로 열어 screenshot과 logs로 확인하고 gallery 탭도 눌러 본다.

끝나면 call reply로 짧게: 무엇이 되었나, gallery가 돌았나, 확실하지 않은 것.
```

### progress

session: `ses_01m74wjtgk24a3gxtzgmyy04nh` (진행 현황 결과 페이지 만들기)

```text
You are a team member spawned by your parent session. Do the work yourself. When done, answer this call with `lophn call reply`. If you are unsure or need approval, use `ask`; it goes to your parent. If you spawn members yourself, end your turn after spawning and do not poll; their answers arrive as new input.결과 페이지(artifact) 하나를 만들어라: 이름 `progress`, 제목 "진행 현황". 먼저 skill `write-artifact`를 읽고 그대로 따른다.

목적: 사람이 지금 무엇이 돌고 있고 최근 무엇이 바뀌었는지 한눈에 본다. 위에 큰 숫자 몇 개(열린 계획, 열린 이슈, 최근 7일 바뀐 일), 아래에 묶음.

재료(저장소 /home/pyosechang/projects/lophn, 읽기만. 저장소 파일을 고치지 않는다):
- 진행 중인 계획: project-docs/plan/<계획>/README.md의 목표 한 줄, status.md의 task 상태(wave별 merged/running/todo). 지금 browser-vault, context-cache, ui-overhaul.
- 최근 바뀐 것: project-docs/products/change-log/ 의 최근 판 폴더(0.23, 0.22) 항목 title. `node tools/records.ts changes`로도 목록을 얻는다. 날짜는 git log로.
- 이슈: project-docs/issues/*.yaml을 topic별 open 건수, kind(bug/defect/mistake)별로. `node tools/records.ts issues --status open`. 최근 열린 것 몇 건.
- 큰 일 대기열: project-docs/products/roadmap/*.md 주제 목록과 첫 줄.
- 지난 release(products/release-notes 최신 판) 뒤로 쌓인 change-log 건수.

방식: 새로 고침은 요청할 때. 폴더에 collect.mjs를 두어 data/latest.json(수집 시각 포함)을 쓰고 탭 머리 status에 수집 시각을 보인다. 화면 글은 한국어(개발자 영어 단어 그대로). commit hash, path, id는 펼치지 않는다. 다 만들면 tab open --artifact로 열어 screenshot과 logs로 확인한다.

끝나면 call reply로 짧게: 주요 숫자, 눈에 띄는 것 셋, 확실하지 않은 것.
```
