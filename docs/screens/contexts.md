---
type: screen
concerns: [documents/contexts, documents/terms]
---
# contexts

사람이 자료를 묶어 Focus를 만들고, 그 안에서 쓰는 말의 뜻(Meaning)을 정한다.

## 보이는 것

1. **Focus 목록.** 사람이 지은 이름, 목적 한 줄, 확인할 변화가 있으면 그 개수만. 목적이 없는 빈 Focus는 만들 수 없다(documents/contexts#R1).
2. **선택한 Focus.** 목적 한 줄과 지금 들어 있는 자료 목록. 자료마다 이름과 관점(Baseline / Reference / Follow changes, shell/wording#R13)만 기본으로 보이고, 고른 이유는 접어 둔다(documents/contexts#R1). 자료가 없으면 "아직 자료가 없다"와 자료 추가 행동만 보인다.
3. **확인할 변화**(있을 때만). Follow changes로 넣은 자료 중 바뀌었거나 더는 찾을 수 없는 것의 이름과 마지막 확인 시각(documents/contexts#R10). 비어 있으면 이 묶음 전체가 안 보인다.
4. **Meanings 탭을 열면**: 이미 정한 뜻(이름 + 뜻 한 줄) 목록과, 아직 뜻을 정하지 않은 말의 개수(documents/terms#R1, R4).

## 숨긴 것

- 자료를 그 관점으로 고른 이유, 전체 관점 목록, 빈 관점은 "이유 보기"를 눌러야 보인다(documents/contexts#R1).
- 어떤 문서가 어떤 Focus에 들어 있는지 거꾸로 찾는 일(그 문서를 보는 화면에서 한다)과, 자료의 문서 전체/section 구분은 자료를 추가할 때만 묻고 이후에는 안 보인다(documents/contexts#R3, R8).
- Focus 구성(제목·자료·관점) 변경 이력과 되돌리기는 "이력 보기"에 둔다(documents/contexts#R5, lophn-agent/revert).
- Context Engineer가 대신 고친 변경은 작은 작성자 표식만 남고(shell/design-system#R34) 과정은 안 보인다. coding agent가 제안한 구성 변경은 사람이 받아들이기 전에는 Focus에 전혀 반영되지 않는다(documents/contexts#R6) — 받아들일 제안이 있을 때만 "제안 보기"가 나타난다.
- 자료가 바뀌었는지 비교하는 작업, section 이름의 같은 대응 계산, notification 중복 제거는 전부 보이지 않는다(documents/contexts#R9, R11, R12). 앱 읽기 자료의 watch는 화면 어디에도 "자동으로 호출된다"는 표시가 없다 — 실제로 자동 호출되지 않기 때문이다(documents/contexts#R13).
- export는 "내보내기" 보조 행동 뒤에 숨긴다(documents/contexts#R14).
- 말 후보의 출처 문서·근거 위치는 "어디서 나왔나 보기"를 눌러야 보인다(documents/terms#R1).
- 보관한 Focus와 보관한 Meaning은 기본 목록에서 빠지고 "보관함 보기"에서만 보인다(documents/contexts#R7, documents/terms#R5).

## 행동

**주 행동**: Focus 목록에서는 **New focus**. 선택한 Focus 안에서는 **Add item**.

**보조**: 관점 바꾸기, 자료 빼기, 제목/목적 바꾸기, Focus 보관, 되돌리기, 내보내기(documents/contexts#R5, R14) — 모두 Focus마다 바로 적용되고 매번 묻지 않는다. 확인할 변화 각 항목에는 **Ask for judgment**(대화를 연다)가 있으며, 그 자료를 이미 승인된 반복 확인(Repeating check, roles 화면)이 보고 있으면 "다음 반복 확인에서 본다"로 대신 표시하고 바로 판단을 요청하지 않아도 된다(documents/contexts#R1 끝줄).

Meanings 탭에서는 **주 행동: Decide meaning**(뜻을 아직 안 정한 말 하나를 골라 정의를 고르거나 직접 쓰거나 미룬다, documents/terms#R2). 뜻을 정한 뒤에도 마음이 바뀌면 같은 말을 다시 열어 새 결정을 남길 수 있다.

## 상태

- **비었음**: Focus가 하나도 없으면 "아직 만든 Focus가 없다"와 New focus. Meanings가 비었으면 "아직 뜻을 정한 말이 없다".
- **불러오는 중 / 오류**: 공통 패턴(shell/design-system#R1, #R34)을 따른다.
- **더는 찾을 수 없음**: Follow changes 자료가 원래 자리를 잃으면 "더는 찾을 수 없다"와 "새 자리 고르기"(documents/contexts#R9).
- **확인 못함**: 자료 형식을 읽지 못해 변화를 비교할 수 없으면 "지금은 확인할 수 없다"만 보이고 변화로 단정하지 않는다(documents/contexts#R11).
- **뜻을 아직 안 정함**: 말 후보는 "결정" 전까지 정한 뜻 목록과 섞이지 않는다(documents/terms#R1).
- **더 보기**: 정한 뜻이 30개를 넘으면 처음 30개와 "더 보기"(documents/terms#R4).

## 문구

| key | en |
|---|---|
| contexts.list.title | Focuses |
| contexts.list.empty.title | No focuses yet |
| contexts.list.new | New focus |
| contexts.detail.add_item | Add item |
| contexts.detail.empty.title | No material here yet |
| contexts.detail.perspective.baseline | Baseline |
| contexts.detail.perspective.reference | Reference |
| contexts.detail.perspective.watch | Follow changes |
| contexts.detail.reason.show | Why this was added |
| contexts.updates.title | Updates to check |
| contexts.updates.missing | No longer found |
| contexts.updates.unknown | Can't check this right now |
| contexts.updates.ask | Ask for judgment |
| contexts.updates.deferred_to_check | A repeating check will look at this next |
| contexts.meanings.title | Meanings |
| contexts.meanings.empty.title | No meanings decided yet |
| contexts.meanings.needs_meaning | Needs a meaning |
| contexts.meanings.decide | Decide meaning |
| contexts.meanings.more | Show 5 more |
| contexts.meanings.evidence | Where this came from |
| contexts.archive.show | Show archived |
| contexts.export | Export |
| contexts.history.show | See history |

## 크기와 접근성

목록·상세 틀은 shell/design-system#R21의 목록360px+상세를 쓰고 좁은 창에서는 shell/design-system#R24에 따라 목록과 상세를 한 화면씩 보인다. Focus 안 자료 목록은 트리가 아니라 목록 패턴(shell/design-system#R31 수치)을 쓰고, 관점 표지는 색 없이 글자 라벨로 구별한다(shell/design-system#R2). Meanings의 "더 보기"는 키보드로도 다음 페이지를 불러온다. 모든 이동·펼침·결정은 키보드로 되며 펼친 레이어를 닫으면 focus가 열었던 자리로 돌아간다(shell/design-system#R2).
