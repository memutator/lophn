---
name: lophn-save
description: "만든 문서·PDF·이미지·data 파일을 lophn에 저장하는 절차. 저장 전에 format을 확인하고 검사하며, 허용된 프로젝트·앱 자리나 자리 없음을 고르고, 저장한 뒤 고정 주소를 사람에게 보고한다. 사람 원본 파일을 직접 고치는 방법은 안내하지 않는다."
---

# lophn 문서 저장

coding agent가 만든 결과물을 lophn의 문서로 남기는 절차다. 저장은 새 판을 만드는 일이고 사람의 원본 파일을 바꾸지 않는다.

## 통로

- `lophn_format`: op `list`, `show`, `validate`
- `lophn_project`: op `list`, `show`, `current`
- `lophn_index`: op `place`(자리 확인)
- `lophn_series`: op `list`, `show`, `next`
- `lophn_save`: 저장. MCP가 없으면 CLI `lophn save`

## 순서

1. format을 확인한다. `lophn_format` op `list`로 media type에 맞는 format(document, pdf, image, data)을 찾고 op `show`로 선언과 작성 안내를 읽는다. format을 지정하지 않으면 lophn이 media type에 맞는 기본 format으로 보존한다.
2. 저장할 파일을 검사한다. `lophn_format` op `validate`에 파일 경로(제출 위치 기준 상대 경로)를 준다. error가 있으면 고친 뒤 다시 검사한다. 명시한 format이 부적합하면 저장이 거절된다. 기본으로 추론한 format의 구조 문제는 저장 결과의 경고로 돌아온다.
3. 자리를 고른다. 사람이 말한 프로젝트·앱이 있고 `lophn_project`(op `current`, `list`)나 `lophn_index` op `place`에 보이면 그 자리를 쓴다. 허용되지 않았거나 모르면 자리 없음으로 저장한다. context를 소속으로 쓰지 않는다. 정기 문서라면 `lophn_series` op `next`가 주는 key와 title 제안을 쓰되 이 제안만으로 series가 만들어지지는 않는다.
4. 저장한다. `lophn_save`에 `paths`(첫 파일이 primary), 선택 `place`·`slug`·`title`·`format`·`series`와 `key`를 준다. 같은 문서의 새 판이면 읽어 둔 `base_revision`을 함께 준다. 되풀이 호출에 대비해 `idempotency_key`를 준다.
5. 결과를 보고한다. 응답의 고정 주소(문서·판), 변경 없음(같은 내용), 검사 경고를 사람에게 그대로 전한다. 자리 없는 저장이면 사람이 화면에서 자리를 고르면 된다고 적는다.

## 하지 않는 것

- 저장한 결과를 사람 원본 파일로 놓거나, 원본 폴더의 파일을 직접 편집하라고 안내하지 않는다. 원본 추적과 편집은 사람이 화면에서 한다.
- 새 series나 프로젝트를 만들지 않는다. 필요하면 사람에게 화면에서 만들어 달라고 말한다.
- 검사에서 error가 난 파일을 format 이름만 바꿔 다시 저장하지 않는다.
- 저장 실패와 효과 확인 불가를 성공으로 보고하지 않는다. 응답이 끊겼으면 같은 `idempotency_key`로 다시 보내거나 `lophn_document` op `list`로 현재 판을 다시 읽어 확인한다.
