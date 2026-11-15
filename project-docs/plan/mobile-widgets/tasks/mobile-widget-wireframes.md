# mobile-widget-wireframes

폰 위젯, 홈 화면 아이콘, 위치 동의의 wireframe을 gallery(Drafts › Phone app)에 더한다. 화면을 짓는 task(`mobile-widget-screens`, `mobile-shortcut-native`)와 native 위젯(`mobile-widget-native`)이 옮길 기준이고, 사람이 보고 승인한 뒤에 그 task를 띄운다. 새 flow `Phone · 11 Widgets and home screen`(page id `phone-widgets`)을 만든다.

- 단위: widget-design (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/phone/widgets.tsx`(새 file)
  - `tools/wireframes/drafts/phone/widgets.module.css`(새 file. 필요할 때만. 기존 `phone.module.css`는 고치지 않는다)
  - `tools/wireframes/drafts/phone/index.tsx`(`FLOWS`에 한 항목과 import 한 줄)
- 읽을 것:
  - 기준 그림과 구조: `tools/wireframes/drafts/phone/{kit,apps,inbox,shell}.tsx`와 `phone.module.css`(조각 `Phone`, `TopBar`, `Row`, `Sheet`, `Btn`, `Ic`, `Badge`, `Mark`와 숫자). 그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/{3-apps,5-inbox}.png`
  - 앱 menu: `apps.tsx`의 `AppMenu`(맨 아래 "Add to Home screen" 줄이 이미 있다). 동의 카드: `inbox.tsx`의 `Update`와 `Plus`(앱 새 판이 늘린 권한 줄)
  - 계획 `README.md`의 "정한 것"(위젯 머리는 앱 이름과 label뿐, 시각 줄, best effort, 위치 banner 없음), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.1, 2.2, 3(node 넷의 칸과 길이)
  - 본보기(다른 계획이 같은 일을 한 것): `.claude/worktrees/plan-mobile-coding-agents/project-docs/plan/mobile-coding-agents/tasks/mobile-coding-wireframes.md`
  - skill `.claude/skills/ui-design/SKILL.md`(wireframe 규칙)
- 계약:
  - 쓰는 것: `kit.tsx`의 조각. wireframe 규칙의 색과 단추 자리(행동 단추는 오른쪽 끝)
  - 내놓는 것: 아래 그림. 사람이 승인하는 기준이다

## 할 일

1. 홈 화면 판: launcher 배경(바탕 그림 대신 단색 판과 아이콘 몇 개) 위에 위젯을 둔다. 작은 위젯(2x2)과 넓은 위젯(4x2)의 칸 크기를 Android 기본 cell(약 73dp 폭, 4열)로 잡고 숫자를 caption에 적는다.
2. 위젯 모양(넓은 것과 작은 것 둘씩): 머리 줄(앱 이름 · 위젯 label, 오른쪽 끝에 새로 하기 아이콘), 본문 줄들, 꼬리 줄 "Updated 14:05". 본문 node 넷을 다 보인다: `text`(style `title`·`body`·`caption`), `stat`(큰 값과 label), `progress`(가로 막대와 label), `list`(줄마다 글과 오른쪽 `trail`, 다섯 줄까지). tone 넷(`neutral`, `good`, `warn`, `bad`)을 글 색으로 보인다. 작은 위젯은 아래 줄이 잘린다(줄임표를 그리지 않는다).
3. 상태: (a) 마지막 시도가 실패한 위젯: 본문이 흐리고 꼬리가 "Offline 14:05". (b) 놓았지만 아직 고르지 않은 위젯: "Tap to choose" 한 줄과 lophn 표식. (c) 앱이 보관됐거나 선언에서 빠진 위젯: "This widget is no longer available". (d) 컴퓨터를 지운 위젯: "Computer removed". 회전 표시(spinner)는 그리지 않는다.
4. "Choose a widget" 화면(폰 앱 안의 화면): 컴퓨터마다 묶음, 그 아래 앱마다 앱 표식과 이름, 그 앱이 선언한 위젯의 label과 지금 값의 작은 미리보기. 위젯을 선언한 앱이 없을 때의 빈 상태 한 줄. 앱 menu에서 들어와 한 앱으로 좁힌 모양도 한 장.
5. 앱 menu(`AppMenu`와 같은 sheet): "Add to Home screen" 위에 "Add widget" 줄을 더한 모양. 그 앱이 위젯을 선언하지 않았으면 "Add widget" 줄이 없다는 것을 caption에 적는다. "Add to Home screen"을 누른 뒤 launcher가 띄우는 확인(앱 아이콘과 이름, Add 단추)과 홈 화면에 놓인 아이콘(앱 아이콘, 이름) 한 장, 지워진 앱의 흐린 아이콘을 누를 때 launcher가 보이는 "This app was removed from mina-desktop" 한 장.
6. 위치 동의: Inbox의 앱 동의 항목(`inbox.tsx`의 모양을 이 file 안에 다시 쓴다. `inbox.tsx`는 고치지 않는다)에 "Phone · Use your phone's location" 줄이 더해진 것. Android의 위치 권한 창(앱이 처음 물을 때 OS가 띄우는 것) 한 장을 회색 상자로 표시만 하고, caption에 "lophn 동의와 OS 권한은 두 번 따로 묻는다"를 적는다.
7. page 하나 `phone-widgets`를 `index.tsx`의 `FLOWS`에 더한다(title `Phone · 11 Widgets and home screen`, `Shot`마다 한국어 caption 한두 문장). `phone-all`에도 들어가게 하고 한 줄에 셋씩 `rows(n)` 높이를 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고 gallery의 `phone-widgets`가 light로 그려진다. dark는 위젯 둘(넓은 것, Offline)만 확인한다. 그림을 찍어 `.dev-data/mobile-widget-wireframes/shots/`에 둔다(ui-design skill의 확인 방법).
- 위험 test: 없음
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 그림 목록(path), 사람이 정해야 할 문구 한 줄씩(시각 꼬리, "Tap to choose", "no longer available", "Computer removed", 동의 줄), 위젯 칸 크기와 글자 크기(native task가 옮길 숫자).
