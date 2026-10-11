---
type: domain-model
concerns: [documents/series]
---
# documents/series

반복 문서 묶음의 경로 pattern 값, 거기서 나오는 멤버 목록과 순서, 다음 이름 계산 함수를 정의한다.

이 concern에는 entity도 ledger 표도 command도 event도 없다. 값과 순수 함수만 있다. pattern은 context 계약의 series 자료가 담고(→ documents/contexts), 멤버와 다음 이름은 읽을 때마다 파일 목록에서 계산한다.

## SeriesPattern (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `text` | string | 아니오 | 아래 문법 | 프로젝트 폴더 기준 상대 경로 pattern |

pattern은 context 계약의 series 자료 안에 값으로 산다. 따로 저장하거나 ID를 갖지 않고, 바뀌는 방식·판 보존·검사는 계약이 따른다(→ documents/contexts).

### 문법

`text`는 `/`로 나눈 경로이고 마지막 칸이 파일 이름이다.

| 항목 | 제약 |
|---|---|
| 앞 칸들 | 글자 그대로(literal). `*`·`{`·`}`·`..`·빈 칸 금지; 절대 경로 금지 |
| 파일 이름 칸 | literal 글자와 `*`(0글자 이상, `/` 제외)와 번호 자리 정확히 하나 |
| 번호 자리 | `{(n\|major\|minor\|patch)(([+-])(\d+))?(:(\d+))?}` |
| step | 생략은 `+1`; 명시한 부호와 정수는 안전한 정수 범위(2^53-1 이하); 0 허용 |
| width | 생략은 채움 없음; 지정하면 정수 값이 1~4; `:03`은 3 |
| 번호 자리의 이웃 | 앞뒤 글자가 숫자·`*` 금지; 바로 뒤가 `.`이면 그 다음 글자가 숫자 금지 |

위반은 `invalid_input`이며 계약을 저장할 때 검사한다. 바깥 공백은 문법에 들어가지 않는다(앞뒤 공백이 있으면 위반).

번호 자리의 종류가 잡는 key 모양:

| 종류 | key가 맞는 모양 | 성분 수 |
|---|---|---|
| `n` | `\d+` | 1 |
| `major`, `minor`, `patch` | `\d+(\.\d+)*` | 1개 이상 |

각 성분은 안전한 정수 범위를 넘으면 맞지 않는다. 번호 자리는 가능한 가장 긴 숫자를 잡는다.

## SeriesMember (derived 값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `path` | 상대 경로 | 아니오 | pattern 전체에 맞는 파일 | |
| `key` | string | 아니오 | 번호 자리가 잡은 글자; 앞자리 0 유지 | `0.3`, `010` |
| `parts` | 정수[] | 아니오 | key를 `.`로 나눈 10진 정수 | 순서 비교에 쓴다 |

멤버 목록은 `members(pattern, files) -> SeriesMember[]`의 결과다. `files`는 프로젝트 폴더 아래 파일의 상대 경로 목록(→ documents/projects)이다. 폴더 칸이 literal이므로 pattern 칸 수와 폴더가 같은 파일만 본다. 맞지 않는 파일은 목록에 없고 오류도 아니다. 파일 이름만 본다. 저장하지 않으며 같은 `pattern`과 `files`는 같은 결과를 낸다.

### 순서

멤버는 아래 순으로 비교한다. 문자열 비교는 locale 독립 Unicode codepoint 순이다.

1. `parts`를 앞에서부터 수로 비교한다. 짧은 쪽은 모자란 성분을 0으로 본다(`0.2` = `0.2.0`).
2. 같으면 `key` 글자.
3. 같으면 `path` 글자.

`exp-002 < exp-009 < exp-010`, `0.2 < 0.9 < 0.10`. 마지막 멤버는 이 순서의 마지막이며 감소 규칙이어도 같다.

## NextName (값)

`next_name(pattern, files) -> NextName`

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 계산 불가면 빈 문자열 | 다음 key |
| `path` | 상대 경로 | 예 | 계산 불가면 null; key를 번호 자리에 넣은 경로; `*`는 그대로 남음 | 다음 이름 |
| `complete` | boolean | 아니오 | path가 있고 `*`가 없으면 true; 아니면 false | 쓰는 쪽이 채울 자리가 남았나 |
| `from` | 상대 경로 | 예 | 마지막 멤버의 path; 멤버가 없으면 null | 계산 근거 |
| `taken` | boolean | 아니오 | 같은 key를 가진 멤버가 있다 | 이미 있음 |

`taken`은 감소 규칙이나 사람이 밖에서 만든 파일 때문에 계산한 key를 가진 멤버가 이미 있을 때 true다. `path`에 `*`가 남으면 쓰는 쪽이 채운 이름이 기존 파일과 겹치는지는 쓰는 쪽이 파일 목록으로 확인한다.

함수는 파일을 만들거나 예약하지 않는다. 입력이 같으면 결과가 같다.

### 계산

마지막 멤버의 `parts`와 번호 자리의 종류·step·width로 새 `parts`를 만든다.

| 종류 | 바꾸는 성분 | 이어지는 성분 |
|---|---|---|
| `n` | 유일한 성분 | 없음 |
| `major` | 첫째 | 뒤 성분은 모두 0 |
| `minor` | 둘째, 성분이 하나뿐이면 첫째 | 뒤 성분은 모두 0 |
| `patch` | 셋째, 성분이 둘 이하면 마지막 | 뒤 성분은 모두 0 |

- 바꾸는 성분에 step을 더한다. 결과가 0 미만이면 0으로 한다.
- width는 바꾸는 성분의 최소 글자 수다(앞을 0으로 채운다). 더 긴 값은 자르지 않는다. 바뀌지 않는 앞 성분은 마지막 멤버 key에 쓰인 글자 그대로 둔다. 0으로 초기화된 성분은 `0`이다.
- 결과 성분이 안전한 정수 범위를 넘으면 빈 제안(`key = ""`, `path = null`, `complete = false`, `taken = false`)이다. 멤버가 없을 때도 `from = null`인 빈 제안이다.

예(pattern → 마지막 멤버 → 다음):

| pattern | 마지막 멤버 | 다음 `path` | `complete` |
|---|---|---|---|
| `P{n+1:03}.md` | `P001.md` | `P002.md` | true |
| `weekly-{minor}.md` | `weekly-0.2.md` | `weekly-0.3.md` | true |
| `weekly-{major}.md` | `weekly-0.2.md` | `weekly-1.0.md` | true |
| `weekly-{patch}.md` | `weekly-0.2.1.md` | `weekly-0.2.2.md` | true |
| `v{n+1}.md` | `v1.md` | `v2.md` | true |
| `reports/weekly-{n}.md` | `reports/weekly-9.md` | `reports/weekly-10.md` | true |
| `eval/experiments/exp-{n+1:03}-*.md` | `eval/experiments/exp-010-x.md` | `eval/experiments/exp-011-*.md` | false |
| `weekly-{n-1}.md` | `weekly-5.md` | `weekly-4.md` | true |
| `weekly-{n}.md` | `weekly-2026-09-28.md`만 있음 | 없음(빈 제안) | false |

## 오류

| code | 언제 |
|---|---|
| `invalid_input` | pattern 문법 위반(번호 자리 없음·둘 이상, 폴더 칸의 번호 자리·`*`, `..`·절대 경로, width 0·5 이상, step이 안전한 정수 범위 밖, 이웃 글자 위반) |
| `not_found` | 프로젝트 폴더를 읽을 수 없어 파일 목록이 없음 |

계산할 수 없는 경우(멤버 없음, 결과가 안전한 정수 범위 초과)는 오류가 아니라 빈 제안이다. 멤버 목록과 순서 계산에는 오류가 없다.

## 정책

- **정본.** 정본은 프로젝트 폴더의 파일이다. 멤버·순서·다음 이름은 읽을 때 계산하는 값이며 ledger에도 derived store에도 두지 않는다.
- **읽기.** 읽기는 변경 event를 만들지 않는다. 파일 목록을 읽는 비용 때문에 쓰는 캐시는 정본이 아니며, 지워도 결과가 같다.
- **문서.** 멤버는 판 없는 프로젝트 파일이다. 새로 쓰기는 일반 파일 쓰기이며 이 concern의 command가 없다.
- **계약과의 경계.** series 자료가 어느 프로젝트 폴더를 가리키는지, 계약이 어떻게 판을 얻고 검사하는지는 → documents/contexts. 쓰는 쪽 도구의 모양은 lophn-agent 쪽 문서가 정한다.
