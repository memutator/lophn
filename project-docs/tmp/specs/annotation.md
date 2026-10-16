# S9. 앱 화면 annotation

상태: **확인됨** (2026-10-15). 요구로 정해진 것은 ID로 건다. 화면 모양은 wireframe(`tools/wireframes`, artifact "lophn wireframes"의 App space · annotate page)을 따른다. 13장은 사람이 확인했다(docs-review).

참고: ChatGPT 데스크톱 앱의 browser comment 기능을 거꾸로 따라간 노트 `../browser-anottation/chatgpt-browser-annotation.md`. 같은 폴더의 bundle 사본은 읽기만 했다.

## 1. 범위

사람이 앱 화면에서 요소나 영역을 골라 메모를 달고, 모아서 그 앱의 App Engineer에게 보내는 길이다. 다루는 것:
- 고르기(annotate mode)
- annotation 값
- screenshot
- 받는 session
- App Engineer에게 들어가는 꼴
- 저장과 ticket 근거
- 실패

제보(req-0172)는 따로다. annotation은 문제가 되지 않는다. 화면 모양은 wireframe과 `../ui-inventory.md`가 맡는다.

## 2. 한 줄

annotate mode에서 사람이 고른 요소나 영역마다 다음이 annotation 하나로 묶인다(req-1486, 1487).
- 메모
- 고른 곳을 표시한 screenshot
- SDK component와 앱 source 위치
- 앱 release와 화면 위치

모은 annotation은 한 번에 그 앱의 App Engineer session에 사람 메시지로 들어간다. App Engineer가 그 요청으로 ticket을 만들면 ticket 근거로 붙어 coding agent가 CLI로 읽는다(req-1488).

## 3. 부품과 소유

| 부품 | 맡는 일 |
|---|---|
| 앱 view preload(shell이 앱 view에 넣는 script) | annotate mode 동안 클릭과 끌기를 가로채 요소나 영역을 고른다. hover 윤곽, 번호 표지, 메모 칸을 앱 view 위 층에 그린다 |
| SDK component | 자기가 그린 DOM 요소에 component 이름을 표시한다(예: `data-lophn-component="DataTable"`) |
| shell main | 앱 view를 capture해 고른 곳을 자른다. 앱 release와 화면 위치(view 이름)를 안다 |
| shell renderer | 위쪽 바의 Annotate 단추, 켜짐 안내 toast, 모은 목록 panel, 보내기 |
| core | annotation 저장, App Engineer session으로 넣기(Router), ticket 근거 잇기, CLI 읽기 |
| App Engineer | 받은 annotation을 읽고 ticket을 만들며 근거로 붙인다(AGENT-ROLE A3) |

## 4. 고르기 (annotate mode)

화면 모양은 wireframe 그대로다.

1. 사람이 앱 공간 위쪽 바의 Annotate 아이콘 단추를 누른다.
   - 단추가 눌린 모양이 되고, 앱 화면 위쪽에 "Annotate is on" toast([Done])가 뜬다.
2. mode가 켜져 있는 동안 앱 화면의 클릭과 끌기는 앱에 닿지 않고 고르기에 쓰인다. Esc나 [Done]이 mode를 끈다.
3. **요소:**
   - 가리키면 그 요소에 윤곽과 이름표가 뜬다. 이름표는 SDK component 이름이고, SDK component가 아니면 role과 접근 이름이다.
   - 고르는 대상은 가리킨 DOM 요소에서 위로 올라가 처음 만나는 SDK component 요소다. 그런 요소가 없으면 가리킨 요소 그대로다.
   - 클릭하면 번호 표지와 메모 칸이 붙는다.
4. **영역:** 끌면 사각형이 생기고 번호 표지와 메모 칸이 붙는다.
5. **모은 목록:**
   - 고른 것은 번호 순서로 모은 목록 panel에 쌓인다. 하나씩 지우거나 전부 지울 수 있다.
   - [Send to App Engineer]로 한 번에 보낸다(req-1486).
   - 보내면 mode가 꺼지고 "N annotations sent to App Engineer" toast가 뜬다.
6. **표지 위치:**
   - 번호 표지와 윤곽은 모으는 동안만 있다. 위치는 viewport 비율과 scroll 값으로 적어 두고, 크기가 바뀌거나 scroll해도 다시 계산한다.
   - 고른 요소가 사라지면 적어 둔 사각형을 그대로 쓴다.
   - 보낸 뒤에는 앱 화면에 남기지 않는다.

## 5. annotation 값

| 칸 | 뜻 | 근거 |
|---|---|---|
| `n` | 보낸 묶음 안의 번호(1부터) | req-1486 |
| `kind` | `element` 또는 `region` | req-1486 |
| `note` | 사람이 쓴 메모. 비어 있어도 된다 | req-1487 |
| `screenshot` | 고른 곳을 표시한 이미지(6장). blob | req-1487 |
| `component` | SDK component 이름. SDK 밖 요소면 없음 | req-1487 |
| `source` | 그 component를 쓴 앱 source의 파일과 줄. 얻는 방식은 13장 2 | req-1487 |
| `element` | role, 접근 이름, 보이는 글(가까운 글 포함 짧게) | 참고 노트 3장 |
| `rect` | 화면 위치. viewport 비율의 x, 너비와 px의 y, 높이, scroll 값 | req-1487 |
| `view` | 앱 화면 위치. 앱이 정한 view 이름이나 route | req-1487 |
| `release` | 그때 활성 release | req-1487 |
| `app` | 앱 | |

- 한 묶음은 보낸 시각, 보낸 사람, 앱, annotation 목록이다. 묶음과 annotation마다 ID가 있다(9장).
- selector는 담지 않는다. 앱 source를 고치는 coding agent에게는 component와 source 위치가 더 정확하다. 참고 노트 8장이 말하듯 selector는 유일하지 않을 수 있다.

## 6. screenshot

1. 보내기를 누르면 shell main이 annotation마다 앱 view를 capture한다.
2. capture 직전에 preload가 그 annotation의 윤곽과 번호 표지를 그린다. 그래서 표시가 이미지에 찍힌다(참고 노트 5장).
3. 자르는 범위는 고른 사각형과 표지를 합친 것에 둘레 여백을 더한 것이다. 큰 이미지는 정해진 크기로 줄인다(수치는 refactor session).
4. 앱 view 바깥(lophn 크롬, 다른 창)은 찍지 않는다.

## 7. 보내기와 받는 session

1. 보내기는 사람의 동작이라 Gate를 거치지 않는다.
2. 받는 곳은 그 앱의 App Engineer다(앱마다 하나, req-1518).
   - 앱 공간의 agent pane에 그 App Engineer의 열린 session이 있으면 그 session으로 간다.
   - 없으면 새 session을 연다(13장 1).
3. 묶음 하나가 사람 메시지 하나다. Router 입력이고 출처는 사람이다(S3). 기본으로 다음 turn에 들어간다(req-1509). 일하는 중이면 Next turn 줄에 쌓인다.
4. 보관한 앱이면 그 session이 새 입력을 받지 않으므로(req-1522) 보내기가 실패하고 이유를 보인다.

## 8. App Engineer에게 들어가는 꼴

S4 6장의 입력 꼴을 따른다. 사람 메시지이므로 메모는 사람의 요청이다. tag는 출처와 모양만 밝힌다.

```
<lophn-annotation n="1" kind="element" app="Orders" release="r7" view="orders">
Note: The total is one cent off with the 10% discount.
Component: DataTable
Source: src/orders/totals-table.tsx:42
Element: row "#1042 · Dae Kim · $41.99"
Area: x=62% y=318px w=18% h=24px
</lophn-annotation>
[image: Annotation 1. The selected element is outlined in blue and marked 1.]
```

- 묶음의 annotation을 번호 순서로 이어 붙인다. 이미지는 그 annotation 블록 바로 뒤에 붙는다.
- screenshot은 감싸지 않는다(13장 3). 앱은 사람이 만들고 grant로 배정한 것이라 S2 2장대로 믿는다. app-api 결과를 감싸지 않는 것과 같다.
- tag의 뜻은 S4 5장의 고정 본문에 둔다. 닫는 tag escape와 속성 값 scrub은 S4 6장 그대로다.
- `<lophn-annotation>`은 S4 6장 입력 표에 한 줄로 더한다(11장).

## 9. 저장과 ticket 근거

- core는 묶음과 annotation을 앱 아래에 저장한다. screenshot은 blob이다.
- session 기록의 그 메시지는 annotation ID를 가리킨다.
- App Engineer가 ticket을 만들 때 근거 ref로 `{kind: annotation, id}`를 붙인다(req-1488). 묶음 전체를 붙여도 된다.
- coding agent는 CLI로 ticket을 읽을 때 근거 annotation의 메모, component, source 위치, release, screenshot 파일 경로를 받는다(req-1488).
- 남기는 기간: annotation은 그것을 가리키는 session 기록이나 ticket이 있는 동안 남는다. 둘 다 사라지면 지운다.

## 10. 실패

| 경우 | 처리 |
|---|---|
| capture 실패 | screenshot 없이 보낸다. 그 annotation 블록에 "screenshot을 찍지 못했다"는 한 줄을 넣는다 |
| source 위치를 못 얻음(SDK 밖 요소, source map 없음) | `component`와 `source`를 비우고 `element`와 `rect`로 보낸다 |
| 앱이 보관됨, session이 새 입력을 받지 않음 | 보내기 실패. 모은 목록은 남고 이유가 보인다 |
| 보내는 중 앱 release가 바뀜 | 고를 때의 release를 담는다. App Engineer가 지금 release와 다르면 source 위치를 다시 확인한다(built-in 지침) |

## 11. 다른 spec과 닿는 곳(반영함)

- **S4 6장 입력 표:** `<lophn-annotation>` 줄. 5장 고정 본문에 tag 뜻.
- **S4 4장 ticket tool:** 근거 ref kind에 `annotation`을 더한다.
- **S6 CLI:** ticket 읽기가 근거 annotation을 돌려준다.
- **S1:** 보내기는 Router 입력이고 domain event가 아니다. toast는 보낸 결과로 renderer가 띄운다(8장 반응 층과 따로).
- **S8:** 받는 session 규칙(7장 2)이 S8의 session 열기와 맞는지.

## 12. 하지 않는 것

- 글 선택 annotation. 요구는 요소와 영역뿐이다(req-1486). ChatGPT에는 있다.
- 보낸 뒤 앱 화면에 표지를 남기거나, 표지를 다시 열어 고치기.
- annotation으로 문제 만들기. 제보는 따로다(req-0172).
- agent가 annotation을 다는 것. 지운 기능이다(removed.md 1장).
- selector 저장과 agent가 selector로 앱 화면을 조작하는 tool.

## 13. 정할 것

1. **정함(사람, 2026-10-15): 받는 session.** agent pane에 그 App Engineer의 열린 session이 있으면 그 session, 없으면 새 session. 사람이 보고 있는 대화로 가야 이어서 이야기할 수 있다.
2. **refactor session 몫: source 위치를 얻는 방식**(00-decisions C #112). 영역 조사의 추천은 (나)다: 요소에서 bundle 위치를 얻어 release의 source map으로 원래 위치로 푼다. (다) esbuild plugin이 SDK component 사용 지점에 위치 표시를 넣는 방식은 React 내부에 기대지 않는다는 장점이 있다.
3. **정함(사람, 2026-10-15): screenshot은 감싸지 않는다(8장).** ChatGPT는 아무 웹 page나 찍으므로 "untrusted page evidence"로 둔다. 우리 앱은 사람이 만들고 배정한 것이다. 다만 앱이 바깥 data를 화면에 보이면 그 글이 이미지에 찍힌다. 그래도 app-api 결과와 같은 기준으로 둔다.
