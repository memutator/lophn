# requirements

lophn이 지켜야 할 보장을 catalog 경계마다 적는다. ID는 `../boundary-catalog.yaml`을 가리킨다.

## 1. requirement 하나

- 한 경계가 지켜야 할, 판정할 수 있는 보장 하나다.
- 사람이 하는 일의 순서는 flow 몫이고, 잘되고 있는지 재는 것은 eval 몫이다.
- 독립으로 판정할 수 있는 보장이 둘 섞이면 둘로 나눈다.

## 2. 있는 것만 적는다

- 요구에는 있는 것만 적는다. 요구에 없는 기능은 만들지 않는다.
- 그래서 지운 기능·화면·말을 "없다"로 적지 않는다. 무엇을 지웠는지는 products/change-log에 남긴다.
- "~하지 않는다"(`forbids` 포함)는 lophn이 실제로 하는 동작 안에서 생길 수 있는 잘못에만 쓴다. 그 test는 그 동작을 돌려 보고 잘못된 결과가 없는지 본다.
  - 예: "개체 계산과 검색은 model을 부르지 않는다" → 검색을 돌려 model 호출이 없는지 본다.
- 코드나 화면에서 무엇이 없는지 찾아보게 하는 문장(이런 파일·문구·단추가 없다)은 쓰지 않는다.

## 3. subject

- 요구마다 catalog ID 하나를 `subject`로 둔다.
- 도메인 연산의 뜻은 그 도메인 요소가 subject다. interface는 그 계약 전체에 걸친 보장만 맡는다.
  - 예: "같은 폴더를 project로 두 번 등록하면 거절한다" → `projects`
  - 예: "core-api는 부르는 쪽마다 token을 확인한다" → `core-api`
- library(`sdk`, `design`, `base`, `protocol`)의 요구는 그 kit에 무엇이 들어 있는지와, 앱이나 다른 package가 그 부품을 쓸 때 부품이 어떻게 동작하는지를 쓴다. 주어는 "SDK의 문제 보고 client"처럼 부품으로 쓰고, library가 따로 도는 것처럼 쓰지 않는다.
- actor와 extension(`person`, `external-coding-agent`, `app`, `user-package`)은 subject가 아니다. 그들이 지켜야 할 것은 그것을 검사하는 lophn 쪽이 subject다.
- 같은 보장을 interface·제공자·사용자에 복사하지 않는다. 부모 요소의 요구가 자식에게 저절로 이어지지 않는다.

## 4. 파일

- 파일 하나는 catalog 요소 하나와 그 자손을 맡는다. 자기 파일이 따로 있는 자손은 뺀다.
- 파일 이름은 `<최상위 요소 ID>-<요소 ID>.yaml`이다. 최상위 요소 자신은 `<ID>.yaml`이다. 요소 ID가 이미 최상위 ID로 시작하면 한 번만 쓴다(`coding-agent-mcp.yaml`).
- 처음 파일 root는 최상위 요소와 `core`의 자식이다. 요구가 생길 때 파일을 만든다.
- 한 파일이 50개쯤 넘으면 자식 요소의 파일로 나눈다. 자식이 없는 요소는 넘어도 파일 하나로 둔다.
- interface는 `defined_by`가 아니라 그 계약의 뜻이 속한 관심사의 파일에 둔다. 어느 파일이 어느 interface를 맡는지는 그 파일의 `interfaces` 칸이 정한다.
- 파일 이름은 catalog를 따라 바뀔 수 있다. 요구 ID는 바뀌지 않는다.

## 5. 형식

```yaml
schema_version: 1
catalog: ../boundary-catalog.yaml
interfaces:            # 이 파일이 맡는 interface. 없으면 뺀다.
  - core-api
requirements:
  - id: req-0001
    status: accepted
    impl: partial      # 선택. 비어 있으면 아직 대조하지 않은 것이다.
    gap: 모자란 것 한 줄.  # impl이 partial일 때만, 반드시.
    subject: projects
    statement: 한 문장의 보장.
    details:           # 선택. 아래 키만 쓴다.
      forbids:
        - 금지되는 동작
    acceptance:
      - 판정할 수 있는 상황과 관찰 결과.
    related:           # 선택. 직접 관련된 다른 catalog ID.
      - shell
```

| 칸 | 필수 | 뜻 |
|---|---|---|
| `id` | 예 | `req-0001` 꼴. 전체에서 하나뿐이다. |
| `status` | 예 | `proposed`, `accepted`, `rejected` 중 하나. 아래 status 절. |
| `impl` | 아니요 | `todo`, `partial`, `done`. 아래 impl 절. |
| `gap` | `impl: partial`이면 예 | 코드에 무엇이 모자란지 한 줄. `partial`이 아니면 쓰지 않는다. |
| `subject` | 예 | 요구를 맡는 catalog ID 하나. |
| `statement` | 예 | 핵심 보장. |
| `acceptance` | 예 | 판정할 수 있는 상황과 관찰 결과의 목록. 새 의무를 여기서 처음 꺼내지 않는다. |
| `details` | 아니요 | 아래 고정 키만 쓴다. 빈 값으로 자리를 채우지 않는다. |
| `related` | 아니요 | 직접 관련된 다른 catalog ID. 공동 소유나 의존을 뜻하지 않는다. |

`status`:

| 값 | 뜻 |
|---|---|
| `proposed` | agent가 썼고 사람이 아직 확인하지 않았다. |
| `accepted` | 사람이 확인했다. |
| `rejected` | 사람이 버렸다(폐기됨). |

- agent는 `proposed`로만 쓴다. `accepted`로 바꾸는 것은 사람이거나, 사람이 확인하라고 말한 뒤의 agent다.
- agent가 `accepted`인 요구의 `statement`·`details`·`acceptance`를 고치면 `proposed`로 되돌린다.
- 무언가를 만드는 쪽은 `accepted`만 본다.
- 사람이 버린 요구는 지우지 않고 `rejected`로 둔다. `- id:` 바로 위에 `# 폐기: <이유>` 주석을 단다. 같은 요구가 옛 문서에서 다시 올라오지 않게 하려는 것이다.
- 무언가를 만드는 쪽과 test는 `rejected`를 보지 않는다. `rejected`에는 `impl`과 `gap`을 쓰지 않는다.
- 구현 여부는 status가 아니라 `impl`에 적는다.

`impl`:

| 값 | 뜻 |
|---|---|
| `todo` | 코드가 이 요구를 아직 지키지 않는다. |
| `partial` | 일부만 지킨다. 모자란 것을 `gap`에 적는다. |
| `done` | 코드가 acceptance를 모두 지킨다. |

- `status`는 사람이 확인했는지, `impl`은 코드가 따라왔는지를 말한다.
- `accepted`인데 `impl`이 비어 있으면 아직 코드와 대조하지 않은 것이다. 대조는 나중에 묶어서 한다.
- 코드를 바꾸는 쪽은 같은 변경 안에서 그 요구의 `impl`과 `gap`을 고친다.

`details` 키:

| 키 | 값 | 뜻 |
|---|---|---|
| `when` | 문자열 | 요구를 일으키는 사건·시점 |
| `if` | 문자열 | 요구가 적용되는 상태·조건 |
| `contains` | 목록 | 최소한 담아야 할 항목 |
| `performs` | 목록 | 반드시 하는 동작 |
| `returns` | 목록 | 부른 쪽에 돌려주는 결과 |
| `emits` | 목록 | 내보내는 event·알림 |
| `preserves` | 목록 | 지키는 상태·불변 조건 |
| `forbids` | 목록 | 실제로 하는 동작 안에서 막아야 할 잘못(2장) |
| `on_failure` | 목록 | 실패 조건과 그때의 대응 |
| `ordering` | 목록 | 반드시 지킬 선후 |
| `limits` | 목록 | 대상·단위·기준이 있는 제한 |

## 6. ID

- `req-` 뒤에 네 자리 번호다. 파일 이름이나 경계 이름을 넣지 않는다.
- 쓴 번호는 다시 쓰지 않는다. 요구를 지우면 그 번호는 비워 둔다.
- 여러 session이 같이 쓰면 번호 범위를 미리 나눠 준다.
- 파일을 옮기거나 subject를 바꿔도 ID는 그대로다.

## 7. 검사

저장소 root에서:

```sh
deno run --no-config --no-lock --allow-read .dev-data/docs-check/check-requirements.ts project-docs/requirements project-docs/boundary-catalog.yaml
```
