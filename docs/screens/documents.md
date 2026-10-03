---
type: screen
concerns: [documents/outline-and-search, documents/addressing, documents/versions]
---
# documents

사람이 문서를 검색하고 저장한 saved view를 연다.

lophn 공간의 형제 화면이다(shell/desktop#R28). 문서 하나를 읽고 고치는 일은 document 화면이 맡고, 여기는 **찾기**와 **정리**(이름·자리·보관·export)만 맡는다.

## 보이는 것

1. **검색**: 입력 하나(제목·본문·요약을 같이 찾는다, documents/outline-and-search#R10, R11)와 자리(프로젝트/앱)·format 기본 filter.
2. **결과 목록**: 이름, 자리("No project"처럼 자리 없음도 구별), 최신 판의 저장 주체·시각, 일치한 부분 snippet(documents/outline-and-search#R12, documents/versions#R9). agent가 쓴 결과는 작은 작성자 표식으로 구별한다(shell/design-system#R34).
3. **Saved views**: 이름 붙여 저장한 조건을 목록으로 두고 누르면 그 조건으로 지금 목록을 새로 만든다(documents/outline-and-search#R23, R24).
4. 결과가 index 반영 지연 중이면 그 사실만 짧게 보인다("결과가 늦을 수 있음"). 평소에는 안 보인다(documents/outline-and-search#R14).

## 숨긴 것

- 자리·context 포함 여부·보관 여부·갱신 시점 같은 나머지 조건은 "More filters"에 접는다(documents/outline-and-search#R23).
- outline token 예산, cursor 계산, 500ms 재파생 묶기, embedding 없음 같은 내부 사정은 화면에 없다(G3). 검색은 그냥 결과로만 말한다.
- section 단위 주소(`문서#section`)와 그 안의 읽기는 이 화면이 아니라 결과를 열었을 때의 document 화면이 맡는다(documents/addressing#R4).
- lophn이 알아서 처리해 안 보이는 것: 옛 address를 현재 대상으로 안내하는 일(documents/addressing#R6), section이 지워졌는지와 아직 모르는지를 구별하는 판정(documents/outline-and-search#R22).

## 행동

- **주 행동 없음** — 찾기 화면이라 검색 입력 자체가 핵심 동작이다.
- **보조 행동**: Save this search, saved view 열기/고치기/지우기, 결과 항목의 "..." 메뉴에서 Rename·Move·Archive·Export.
- Rename·Move는 추천 이름/자리와 함께 사람이 직접 고른 뒤에만 적용되고, 자유 문장으로는 움직이지 않는다(documents/addressing#R9, R10).

## 상태

- **빈 검색 결과**: "No matches" + 다른 말이나 filter를 권하는 한 줄. 원본이 없다고 단정하지 않는다(documents/outline-and-search#R14).
- **아직 검색 전**: saved view 목록과 최근 문서만 보인다.
- **불러오는 중 / 오류**: 공통 패턴.
- **결과가 늦을 수 있음**: 마지막으로 확인한 index 시각과 함께, 비어 있음과 뒤처짐을 구별해서 보인다(documents/outline-and-search#R14).
- **옛 자리/이름으로 들어옴**: "This moved. Now at {place}." 안내와 함께 현재 자리로 그대로 연다(documents/addressing#R6, R7).
- **export 준비**: 고를 판·형식(Markdown/JSON/원본)과 포함될 문서 수를 먼저 보이고 누른 뒤에만 내려받는다(documents/versions#R16).

## 문구

| key | en |
|---|---|
| documents.title | Documents |
| documents.search.label | Search documents |
| documents.filters.place | Place |
| documents.filters.format | Format |
| documents.filters.more | More filters |
| documents.filters.archived | Include archived |
| documents.filters.updated | Updated |
| documents.results.empty.title | No matches |
| documents.results.empty.body | Try different words or filters. |
| documents.results.stale | Results may be behind — last checked {time} |
| documents.results.no_place | No project |
| documents.results.author.agent | by {name} (agent) |
| documents.results.load_more | Load more |
| documents.saved_views.heading | Saved views |
| documents.saved_views.save | Save this search |
| documents.saved_views.name.label | Name |
| documents.saved_views.empty | No saved views yet |
| documents.item.rename | Rename |
| documents.item.move | Move |
| documents.item.archive | Archive |
| documents.item.unarchive | Unarchive |
| documents.item.export | Export |
| documents.export.format.label | Export as |
| documents.export.included | {count, plural, one {# document included} other {# documents included}} |
| documents.redirect.notice | This moved. Now at {place}. |
| documents.error.title | Couldn't search right now |

## 크기와 접근성

- 결과 목록은 shell/design-system#R30의 표 치수를 따르고 1,000행을 넘으면 가상 스크롤을 쓴다(documents/outline-and-search#R5).
- snippet의 일치 부분은 색만으로 강조하지 않고 굵게도 함께 표시한다(shell/design-system#R2).
- 키보드로 검색 입력·filter·결과 이동·saved view 열기까지 가능하다.
- 좁은 창에서는 filter가 접힌 패널로, 결과 목록은 한 열로 바뀐다(shell/design-system#R24).
