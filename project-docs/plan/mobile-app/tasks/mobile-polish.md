# mobile-polish

wave 3의 화면 일곱은 서로를 보지 않고 지어졌다. 이 task가 한 번 전체를 보고 맞춘다: 같은 일을 하는 조각을 하나로 합치고, 화면마다 다른 표기를 맞추고, 보고에 남은 동작 결함을 고치고, 모든 화면을 좁은 폭과 넓은 폭에서 wireframe과 대조한다. 새 기능은 넣지 않는다. opus high로 돌린다.

- 단위: mobile-app (wave 4)
- 선행: mobile-home, mobile-session, mobile-inbox, mobile-places, mobile-ops, mobile-frame-fixes, mobile-web-removal
- 소유(이 task만 고친다):
  - `packages/mobile/src`(`packages/mobile/src/screens/session/attach.tsx`와 `sheets.tsx`의 첨부 sheet 부분은 `mobile-attach`의 것이라 건드리지 않는다)
  - `packages/design/native`
  - `packages/design/i18n/catalog/mobile-app.ts`, `mobile-home.ts`, `mobile-session.ts`, `mobile-inbox.ts`, `mobile-places.ts`, `mobile-ops.ts`, `mobile-kit.ts`
  - `packages/shell/renderer/workflow/model.ts`와 `packages/shell/renderer/line-diff.ts`(아래 3의 순수 helper를 깨끗한 file로 옮기는 만큼만. desktop의 동작과 export 이름은 그대로다)
- 읽을 것:
  - 기준 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/`(wireframe)와 `tools/wireframes/drafts/phone/`의 caption. 지금 화면의 그림: `/home/pyosechang/projects/lophn/screenshot/mobile-app/{frame,frame-fixes,home,inbox,places,session,ops}/`
  - 이 계획 `README.md`의 "정한 것", `packages/mobile/README.md`, `packages/mobile/src/app/{nav.ts,routes.tsx,intl.ts}`, `packages/mobile/src/data/mod.ts`, `packages/design/native/mod.ts`
  - desktop의 같은 화면(표기와 동작의 기준): `packages/shell/renderer/`에서 찾는다
- 계약:
  - 쓰는 것: 지금의 nav, data, kit
  - 내놓는 것: 없음(사람이 보는 동작이 화면 사이에서 같아진다)

## 할 일

1. **같은 조각을 하나로.**
   - 짧은 지난 시간(`now`, `4m`, `2h`, `2d`)을 내는 helper 하나를 `packages/mobile/src/parts`에 두고 모든 화면이 쓴다. 지금 `screens/home/ago.ts`, `screens/inbox/time.ts`가 따로 있고 Workspace 화면과 Jobs·Agents는 "2 minutes ago", "21 hours ago"로 쓴다. 목록의 오른쪽 끝과 한 줄 meta에는 짧은 꼴을 쓰고(wireframe), 문장 안("Went live 2 days ago", "Asked 4 minutes ago")은 그대로 둔다.
   - `Intl` 대체 코드는 `packages/mobile/src/app/intl.ts`에만 둔다. `screens/workspace/intl-polyfills.ts`, `screens/session/plural.ts`, `data/ops.ts` 맨 위의 것을 지우고 import를 걷는다.
   - `packages/mobile/src/data/mod.ts`가 `places.ts`, `search.ts`, `ops.ts`와 session의 `data.ts`가 내는 읽기를 다시 내보낸다. 화면은 `data/mod.ts`만 import한다.
   - sample 컴퓨터의 data(workflow, file, job, run, release, agent)가 `data/places.ts`와 `data/ops.ts`에 약 500줄 있다. sample 컴퓨터가 있는 곳(`data/sample.ts`)으로 옮긴다. sample의 시각은 지금 시각을 기준으로 만들어 "Working · 961h"처럼 낡은 값이 보이지 않게 한다.
2. **화면 사이의 표기.** 다음을 모든 화면에서 같게 한다: offline일 때의 banner(문구, Try again 단추가 있고 실제로 다시 붙는다. Home의 것이 기준이다)와 흐리게 하기와 단추 잠그기, 빈 상태의 글 크기와 자리, 목록 줄의 높이와 얼굴·dot의 자리, composer(높이, placeholder, chip), 뒤로 가기와 sidebar 단추의 자리. coding agent의 상세에 있는 New session 단추는 뺀다(폰에서 coding session을 여는 길은 다른 계획이 짓는다). 대화의 앱 card 줄이 앱 id(`app_…`)가 아니라 앱 이름을 보인다.
3. **desktop에서 베낀 순수 규칙을 한 곳으로.** 화면들이 desktop의 순수 helper를 베꼈다. desktop file이 DOM kit이나 desktop tab의 type을 import해서 폰의 typecheck가 renderer 전체를 끌어오기 때문이다. 순수 부분을 import가 깨끗한 `.ts` file로 옮겨 desktop과 폰이 같은 것을 쓰게 하고 베낀 것을 지운다: `screens/workspace/workflow-model.ts`(desktop `workflow/model.ts`의 `shownOf`, `stepRows`, `turnOf`, `participantText`), 대화의 line diff(`shell/renderer/line-diff.ts`의 `DiffLine` type이 `@lophn/ui/reading`에 있어 끌려온다). 그 밖의 베낀 것(시간 글, tool 줄 label, 실패 이유 표, input request 제목)은 옮기는 데 드는 것이 작으면 같이 하고, 크면 무엇이 남았는지 보고한다.
4. **연결이 죽는 결함.** 대화 hook에 잘못된 session id(예: 빈 문자열)가 가면 폰이 잘못된 `watch`를 보내고 core가 연결을 닫아 폰이 Offline에 머문다. (a) data layer가 틀린 id로는 `watch`와 읽기를 보내지 않는다. (b) core가 protocol 오류로 연결을 닫은 뒤에도 폰이 다시 붙는다(다시 붙기가 왜 멈췄는지 찾아 고친다). 이 둘은 위험 test 하나로 본다(node, `packages/mobile/src/**/*.test.ts`: 틀린 id는 frame을 내지 않는다. 닫힌 뒤 다시 건다).
5. **여러 답을 고르는 질문.** kit의 `QuestionCard`가 답 하나만 고른다. desktop은 여러 답을 고르는 질문이 있다. kit card가 그 질문을 받게 하고 대화와 Inbox가 그대로 쓴다.
6. **넓은 폭.** 폭 600 이상(sidebar가 늘 보인다)과 가로 화면에서 모든 화면을 본다. wave 3의 화면들은 넓은 폭을 확인하지 않았다. 깨진 곳을 고친다(본문 최대 폭, sheet의 폭, composer).
7. **전체 대조.** emulator(port 5578, Metro 8218, 개발 core의 remote port 47478)에서 sample 컴퓨터로 모든 화면을 light로, 대표 화면 여섯을 dark로, 넓은 폭으로 화면 여덟을 찍어 `.dev-data/mobile-polish/shots/`에 둔다. wireframe과 다른 곳을 고치고, 고치지 않은 차이는 이유와 함께 보고한다. 실제 개발 core에 pairing해 Home에서 session을 열고, 대화를 보내고, project의 file을 읽고, job을 켜고 끄는 한 바퀴를 돈다.

native module을 더하지 않는다. dev build는 `/tmp/lophn-mobile-app-x86_64.apk`다(`mobile-attach`가 새 build를 짓고 있으면 그 task의 것이 아니라 이것을 쓴다).

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 위 4의 하나
- 남지 않음: `grep -rn "PluralRules\|RelativeTimeFormat" packages/mobile/src --include=*.ts --include=*.tsx`가 `src/app/intl.ts`만 낸다. `screens/workspace/workflow-model.ts`가 없다.
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).

- flows catalog: 이 task가 더하거나 지우는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 합친 조각과 지운 file, 화면마다 고친 것, 옮기지 못하고 남은 베낀 helper, 연결 결함의 원인, 넓은 폭에서 고친 것, 그림 목록, wireframe과 다른 채 둔 곳과 이유.
