# gallery-index

gallery 첫 화면과 목차를 README "gallery index"대로 다시 짠다. 맨 위 묶음 셋 Kit, Screens, Drafts. 구현 여부 badge와 `ScreenId`·`SCREENS`·`PARTS`의 따로 적기를 없애고, page 목록은 영역 폴더마다 한 곳에 적는다.

- 단위: gallery-index (wave 3)
- 선행: kit-checks
- 소유(이 task만 고친다):
  - `tools/wireframes`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 "gallery index"(지금 모양과 바꿀 모양), `classification.md` 4C 표
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "바꿀 모양" 트리
  - skill: `.claude/skills/ui-design/SKILL.md`("새 화면(page) 만들기"는 이 task가 바꾼다. 문서는 lead가 고친다)
  - 지금 코드: `tools/wireframes/pages.ts`(page 목록, `PARTS`, badge), `tools/wireframes/screens.tsx`(`SCREENS`), `tools/wireframes/gallery.tsx`(목차·첫 화면·page 보기·iframe)
- 계약:
  - 쓰는 것: `kit-gallery-*`가 만든 폴더 모양(`pages/kit/<분류>/page.tsx`, `pages/kit/tokens/`, `pages/kit/app-ui/`, `pages/screens/**`, `mock/`, `drafts/`)과 기존 page id
  - 내놓는 것: `tools/wireframes/pages/index.ts`가 `GROUPS`(묶음 3개 > 영역 > page)와 `pageById(id)`를 낸다. page 하나는 `{ id, title, description, render }`. `render`가 그리는 함수라 `SCREENS` 표가 없다. 영역 하나는 파일 하나(`pages/kit/<분류>/index.tsx`, `pages/screens/<영역>.tsx`, `drafts/index.tsx`)가 자기 page 목록과 그리는 함수를 같이 낸다. `kit-checks`의 check 1·2·3이 계속 통과한다.

## 할 일

근거: README "gallery index"(지금 모양의 다섯 문제와 바꿀 모양). 정한 것.
- Kit 묶음의 영역은 분류 8개에 더해 `tokens`와 `app-ui`다(`pages/kit/` 아래에 있고 분류는 아니다). 영역 파일은 폴더가 이미 있어서 `pages/kit/<분류>/index.tsx`로 한다(README의 `pages/kit/<분류>.ts`와 이름이 한 칸 다르다: 폴더와 같은 이름의 형제 파일을 피한다). `page.tsx`(`kit-gallery-split`이 만든 `Kit<이름>`)는 그대로 두고 `index.tsx`가 import해 page 하나로 낸다.
- Screens의 영역 아홉(README): `launcher`, `lophn-space`, `project-workspace`, `agent`, `agent-settings`, `contexts`, `app-space`, `settings`, `questions`(물음·입력: waiting, secret input). 파일은 `pages/screens/<영역>.tsx`. 제품 영역으로 묶는 것이라 `pages/screens/` 아래의 기존 하위 폴더(`agent-setup/` 등)는 옮기지 않는다.
- page id는 지금 것(`launcher-empty`, `new-agent-conversation` 등)을 그대로 둔다. 구현 여부를 말하던 `now`/`new` 접두는 id에 남겨도 된다(주소만 바뀌지 않으면 된다). 이름을 새로 짓지 않는다.
- 묶음 소속: Kit은 지금 `design` part(frame 없이 본문에 그림), Screens는 지금 `now`·`new` part(iframe), Drafts는 `drafts/`에 있는 page(`new-ways-to-open`)다.

1. 타입과 모음: `tools/wireframes/pages/types.ts`에 `Page`, `Area`, `Group`을 쓰고 `pages/index.ts`에 `GROUPS`를 모은다. `pageById`, 전체 page 순서(이전·다음 단추)는 GROUPS에서 만든다. 영역·page 순서는 지금 목록 순서를 따른다.
2. Kit 영역: `pages/kit/<분류>/index.tsx` 8개 + `pages/kit/tokens/index.tsx`(Tokens · colors/type/space/icons/chart colors) + `pages/kit/app-ui/index.tsx`. 각각 영역 id·제목·한 줄 요약과 page(`Kit · <분류>` 등)를 낸다. 한 줄 요약은 분류 `mod.ts`의 머리 주석(`kit-layout-guide`)을 바탕으로 한국어로 쓴다.
3. Screens 영역: 지금 `pages.ts`의 `now`·`new` page 약 136개를 제목 앞 묶음(`Launcher · …`, `Settings · …` 등)과 id 접두로 9개 영역에 나눈다. 애매한 것은 가장 가까운 영역에 넣고 보고에 적는다. 영역 파일마다 page 정의(`id`, `title`, `description`)와 그리는 함수(`screens.tsx`의 `SCREENS` 항목)를 같이 둔다. `screens.tsx`를 지운다.
   - 같은 제품 영역이 "지금 화면"과 "새 설계"로 갈라져 있던 것(Launcher, Settings, App space, Workspace)을 한 영역 안에 같이 둔다.
4. Drafts: `drafts/index.tsx`가 `new-ways-to-open`(ways-page)을 낸다. 영역은 하나(`experiments`)다.
5. `pages.ts`를 지운다: `PartId`, `PARTS`, `BADGE_*`, `design()/now()/fresh()`, `ScreenId`, `PAGES`. "구현됨 · 진짜 화면"·"새 설계" badge를 없앤다. badge 칸 자체를 없앤다(위치가 구현 여부를 말한다). 파일 머리 주석의 "버린 화면" 목록은 `pages/index.ts` 머리 주석으로 옮긴다.
6. `gallery.tsx`:
   - 첫 화면: 161장 page 카드 대신 묶음 3개, 각 묶음 아래 영역 카드(이름, page 수, 한 줄)다. 카드는 영역의 첫 page로 간다.
   - 왼쪽 목차: 묶음 > 영역 > page. 지금 page가 있는 영역만 펼치고 나머지는 접는다. 현재 `tocGroups`(제목의 ` · ` 앞으로 묶기)는 영역이 대신하니 지운다.
   - page 보기: Kit 묶음은 본문에 바로 그리고 Screens·Drafts는 iframe(`?frame=<id>`)이다. 제목과 description만 보인다(badge 없음). 이전·다음은 같은 묶음 안 순서로 한다.
   - `FramePage`는 `pageById(id)?.render()`다.
7. 쓰던 css를 정리한다: `gallery.module.css`는 check 1의 예외 파일이다. 새 규칙(영역 카드, 접히는 목차)은 여기에 더한다. badge 규칙은 지운다. 다른 css 파일을 만들지 않는다.
8. `main.tsx`, `build.ts`가 새 경로로 맞는지 본다. `pages.ts`·`screens.tsx`를 가리키는 곳이 없어야 한다.
9. 문서(ui-design skill의 "새 화면(page) 만들기" 1~7번, architecture)는 lead가 고친다. 이 task의 보고에 새 절차를 한 줄로 적어 준다(영역 파일에 page 하나 더하는 법).

## 끝남

- `deno task check`가 통과한다(`kit` step 포함).
- `deno task wireframes`가 되고, 첫 화면에 묶음 셋과 영역 카드가 보인다. 목차에서 한 영역만 펼쳐진다. 옛 page id 몇 개(`#/launcher-empty`, `#/new-agent-conversation`, `#/kit-overlay`, `#/tokens-colors`, `#/new-ways-to-open`)가 그려진다. Kit page는 본문에, 나머지는 iframe에 뜬다.
- 위험 test: 없음
- 남지 않음:
  - `ls tools/wireframes/pages.ts tools/wireframes/screens.tsx`가 둘 다 없다.
  - `grep -rnE "ScreenId|SCREENS|PARTS|BADGE_|구현됨" tools/wireframes --include=*.ts --include=*.tsx | grep -v dist`가 0줄이다.
  - page 수: 작업 전에 `grep -cE '^  (design|now|fresh)\(' tools/wireframes/pages.ts`로 센 값과 작업 뒤 `GROUPS`의 page 수가 같다. 다르면 이유를 보고한다.
- (화면) 위 page들이 열린다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`pages.ts`가 없어졌다)
- 안 쓰게 된 export: 없음
- 정한 것: 영역에 애매하게 넣은 page와 이유, 영역 파일 이름
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 없음이 기본. 영역 분배가 틀렸다고 사람이 보면 그 page 몇 개만 영역 파일 사이에서 옮기면 된다

## lead가 더함

- (lead가 더함) `kit-gallery-split`이 만든 모양에서 screens가 drafts 코드를 쓰는 곳이 하나 남았다. `pages/screens/contexts/pm-session.tsx`가 `drafts/link.tsx`(눌러서 탭을 여는 글 링크, CSS는 `drafts/compose.module.css`의 `.link`)를 import한다. renderer에 같은 component가 없어서 그대로 둔다. pm-session을 그리는 page는 Screens의 `contexts` 영역에 둔다. 보고의 "알려진 미완 동작"에 그 page id들을 적는다. 승인 때 사람이 링크 모양을 정한다.
- (lead가 더함) gallery의 drive(mount 뒤 단추를 눌러 상태를 고정하는 것)는 `mock/drive.ts`의 `useDrive` 하나로 합쳐졌다(`kit-gallery-split`). 영역 파일에서 page를 만들 때 drive를 새로 짜지 않는다.
- (lead가 더함) 임시 file(page 수 세기 등)은 worktree 안 `.dev-data/gallery-index/`에 둔다.
