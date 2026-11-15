# mobile-coding-wireframes

폰의 coding session과 터미널 화면 wireframe을 gallery(Drafts › Phone app)에 더한다. 화면을 짓는 task(wave 6~8)가 옮길 기준이고, 사람이 보고 승인한 뒤에 그 task를 띄운다. 새 flow `Phone · 8 Coding agents and terminal`(page id `phone-coding`)을 만든다.

- 단위: coding-phone (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/phone/coding.tsx`(새 file)
  - `tools/wireframes/drafts/phone/coding.module.css`(새 file. 필요할 때만. 기존 `phone.module.css`는 고치지 않는다)
  - `tools/wireframes/drafts/phone/index.tsx`(`FLOWS`에 한 항목과 import 한 줄)
- 읽을 것:
  - 기준 그림과 구조: `tools/wireframes/drafts/phone/{kit,session,workspace,more,shell}.tsx`와 `phone.module.css`(조각 `Phone`, `TopBar`, `Row`, `Sheet`, `Btn`, `Seg`, `Composer`, `Keyboard`와 숫자). 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/{4-session,6-project-workspace,2-home-and-sidebar}.png`
  - 이 계획 `README.md`의 "정한 것"(switch 확인 문구, 터미널 입력 허락, 깨우기 단추), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 2, 3, 6
  - desktop의 같은 확인: `packages/shell/renderer/terminal/terminal-gui.tsx`의 toggle modal(`GuiStops`: 멈출 일을 사람에게 보이는 글)과 `terminal-tab.tsx`
  - skill `.claude/skills/ui-design/SKILL.md`(wireframe 규칙)
- 계약:
  - 쓰는 것: `kit.tsx`의 조각. wireframe 규칙의 색과 단추 자리(행동 단추는 오른쪽 끝)
  - 내놓는 것: 아래 화면의 wireframe. 사람이 승인하는 기준이다

## 할 일

1. project workspace의 Sessions 탭에 "Coding agents on mina-desktop" 묶음 두 줄: 채팅 화면(chat)으로 도는 Claude Code(상태 줄), 터미널 화면(terminal)으로 도는 Codex(작은 "Terminal" 표시). 앱이 안 떠 있을 때 묶음 자리에 "lophn is not running on mina-desktop" 줄과 `Start lophn on the computer` 단추.
2. Coding session 대화: 이미 `session.tsx`에 있는 `Coding`을 쓰되 폰에서 보이는 모양 둘을 더한다: (a) 승인 card가 입력 칸 위에 있는 상태(`Approval`과 같은 모양, agent 이름만 coding agent). (b) 입력 칸 자리에 "This chat is open in a terminal on the computer. Switch to chat to reply here." 줄과 `Switch to chat` 단추(터미널로 도는 session).
3. Switch sheet 둘: 도는 turn이 없을 때와 있을 때. 있을 때는 "The running turn will be interrupted, 2 background tasks stop, and the terminal tab on mina-desktop becomes the chat view." 같은 글(이 문장을 영어 한 문장으로 정하고 caption에 한국어로 설명한다). 단추: 오른쪽 끝에 `Switch` (주 단추, `danger`가 아니다), 왼쪽에 Cancel. 막혔을 때(session id를 아직 모름, extension 꺼짐, Windows)의 한 줄 상태도 한 장.
4. 새 coding session(wave 8이 짓는다): 새 session sheet의 agent 고르기에 "Coding agents on mina-desktop" 묶음(Claude Code, Codex, OpenCode, omp), 고른 뒤 첫 말과 "Starts in a new terminal tab on the computer" 안내. 지난 coding session(읽기만 보이던 ledger session)에서 `Continue as chat`.
5. 터미널 화면(wave 7이 짓는다): 위에 session 이름과 `View only` 표시, 본문은 고정폭 styled row(색과 굵게가 있는 화면 하나를 그린다. claude TUI 같은 모양), 아래에 `Fit width` / `100%` Seg(가로 스크롤과 글자 줄이기). 입력이 허락되지 않은 기기: 아래에 "Typing is off for this phone. Turn it on in Settings › Remote on the computer." 한 줄. 허락된 기기: 아래에 글 입력 칸과 key bar(Esc, Tab, Ctrl-C, ↑ ↓ ← →, Enter) 한 줄.
6. page 하나 `phone-coding`을 `index.tsx`의 `FLOWS`에 더하고(`Shot`마다 한국어 caption 한두 문장) `phone-all`에도 들어가게 한다. 위 1~5를 다 그려도 한 줄에 셋씩 `rows(n)` 높이를 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고 gallery의 `phone-coding`이 light로 그려진다. dark는 터미널 화면 하나만 확인한다. 그림을 찍어 `.dev-data/mobile-coding-wireframes/shots/`에 둔다(ui-design skill의 확인 방법).
- 위험 test: 없음
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록(path), 사람이 정해야 할 문구(switch 확인 글, 터미널 입력 안내 글)를 한 줄씩, wireframe에서 정한 것(다른 화면과 어긋나는 곳).
