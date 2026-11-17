# sweep-docs-close

wave 2가 바꾼 동작에 architecture 문서와 flows를 맞추고, 폰 wireframe gallery와 개발용 가짜 coding host의 남은 줄을 고친다. 제품 code는 고치지 않는다.

- 단위: docs-close (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `project-docs/architecture/`
  - `project-docs/flows/`
  - `packages/mobile/README.md`
  - `tools/wireframes/drafts/phone/{index.tsx,kit.tsx,coding.module.css}`
  - `tools/fake-coding-host.ts`
- 읽을 것:
  - `/tmp/lophn-issue-sort/lead-log.md`의 `## W2`로 시작하는 절 여섯(wave 2 worker들의 보고 요약, 영어). 거기의 `Docs:`와 `TODO lead` 줄이 낡은 문서 줄의 목록이다.
  - 닫힌 이슈의 `closed` 칸: `project-docs/issues/{phone-tui-session-not-usable-from-terminal-screen,phone-direct-addresses-fixed-at-pairing,phone-coding-session-takes-no-pictures,claude-gui-resume-drops-images,remote-group-sessions-only-project-lophn,emulation-lost-on-devtools-open,forked-harness-session-loses-history,cut-off-notice-scans-all-turns,sync-rewind-reply-capped,shortcut-keeps-old-label-and-icon}.yaml`
  - `.claude/skills/flows/SKILL.md`
- 계약:
  - 쓰는 것: code의 계약은 고치지 않는다.

## 할 일

1. wave 2가 바꾼 동작을 문서에 적는다. 줄마다 지금 code(이 worktree)를 열어 확인한다. worker의 말을 그대로 옮기지 않는다. architecture 문서는 동작과 결정을 적고 code path는 적지 않는다.
   - 폰의 터미널: 터미널로 도는 coding session은 터미널 화면이 바로 열리고 `Switch to chat`은 그 화면의 menu다. 새 session의 agent sheet에 Terminal 항목이 있다. 터미널 입력 허락은 pairing 때 정해지고 기본이 켬이다(`terminal-agent.md`, `remote.md`, flows의 pairing과 기기 등록).
   - 붙는 주소: hello가 지금 주소 후보를 싣고 기기는 기계 id가 확인된 연결에서 온 목록으로만 바꾼다. 설정 `remote.addresses`(`remote.md`).
   - coding session의 대화: tool 본문은 펼칠 때 읽는다. 폰이 그림을 붙인다. 다시 연 대화의 그림이 되살아난다(`harness-gui.md`, `remote.md`의 비목표와 route 목록).
   - 다른 기계의 창의 session 목록, DevTools가 열릴 때의 emulation, fork한 harness session, turn 시작 때의 읽기, rewind의 결과 모름(`browser-tab.md`, `coding-agent.md`, `app-call.md`, `project-identity.md`).
   - 홈 화면 아이콘의 이름과 그림, guest 안의 Drawer(`phone-home-screen.md`, `phone-screen.md`, `packages/mobile/README.md`).
2. "열린 것" 줄: wave 2로 닫힌 이슈를 가리키는 줄을 지우고 본문에 지금 동작을 적는다. 새로 열린 이슈(`project-docs/issues/`에서 `status: open`인 것 가운데 문서의 주제에 맞는 것)는 한 줄로 가리킨다: `coding-input-skips-device-scope`, `coding-switch-confirms-stale-plan`, `coding-input-answered-ok-before-applied`, `queued-edit-move-not-relayed`, `archive-stops-turn-started-elsewhere`, `remote-call-errors-drop-details`, `phone-draft-lost-on-view-swap`, `phone-terminal-input-retry-types-twice`, `phone-coding-session-opens-empty`.
3. flows: wave 2 worker들이 고친 flows 줄이 지금 code와 맞는지 보고, 빠진 것(pairing의 `terminal_input`, 기기 등록, `tests/core-rest.yaml`의 "terminal_input이 기본 꺼짐" 줄)을 고친다. `node tools/flows.ts check`가 통과한다.
4. `tools/wireframes/drafts/phone/index.tsx`: `phone-coding`은 터미널 shot이 빠졌으니 줄 수와 제목·설명을 맞추고, `phone-terminal`은 shot이 늘었으니 줄 수를 맞춘다(gallery에서 빈 칸이나 잘림이 없게). `kit.tsx`의 `Dot`에 `working`과 `neutral` tone을 더해 Sessions shot이 도는 session을 초록으로 그리지 않게 한다. `coding.module.css`의 안 쓰는 `.term[data-fit]` 규칙을 지운다.
5. `tools/fake-coding-host.ts`: 새 host 요청 `coding_body`, `coding_image_write`, `coding_image_read`, `terminal_resize`, `terminal_open`에 답하게 한다(개발 core에 붙인 가짜 host로 tool 줄을 펼치고 그림을 붙여 볼 수 있게). 지금은 `unavailable`로 답한다.

알아 둘 것:
- 이 task는 project-docs를 고치는 것이 일이다(worker prompt의 "project-docs를 고치지 않는다"의 예외). `project-docs/issues/`, `project-docs/plan/`, `project-docs/products/`는 고치지 않는다.
- 말은 AGENTS.md "말"을 따른다. 날짜, task id, commit hash를 적지 않는다.
- 돌려 보지 못한 것(폰, Electron)을 확인한 것처럼 적지 않는다.

## 끝남

- `npm run check:full`이 통과한다(docs, flows, records, wireframes smoke 포함).
- 위험 test: 없음
- 항목마다 했는지, 못 했으면 왜인지가 보고에 있다.

## 보고

- 항목마다: 함 / 일부 / 못 함(이유)
- 바꾼 file, 통과한 check
- 문서와 code가 달라 판단한 곳
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
