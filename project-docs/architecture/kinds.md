# kinds

domain의 문서가 어떤 모양이어야 하는지는 그 domain의 kind 파일(`kinds.yaml`) 하나가 정한다. domain은 project나 app 안의 책임 경계다(`architecture/domain.md`). program은 그 파일로 문서를 읽어 item을 뽑고, 칸을 검사하고, index에 두고, 위반을 problem으로 올린다. agent는 내장 tool `kind.list`·`kind.check`로 조회하고 검사한다. 이 문서는 kind 파일의 자리와 바뀔 때의 검사, 문서를 읽는 pipeline, 위반이 problem이 되는 길, prompt에 실리는 kind 글을 정한다. 이 경계가 흐려지면 틀린 kind 파일이 쓰던 kind를 지우거나, 위반이 problem에 오르지 않거나, agent가 맡지 않은 domain의 kind를 받는다.

## 흐름

```
 PM | App Engineer: file.write ──▶ <data>/domains/<dom>/kinds.yaml (그 그릇의 domain 폴더 전체가 file 범위, rewind된다)
                         │
 core watch (500ms 합침) ─┤  domain 폴더(재귀 아님, kinds.yaml 이벤트만) + kind glob이 가리키는 그릇 폴더
                         ▼
 kinds dispatcher ── sync(force) ──▶ kinds worker (documents/kinds, 별도 process)
   (domain마다,                         │ kinds 파일 검사: yaml·schema·구조, 바뀌었을 때만 glob 겹침
    2초 규칙,                            │   맞으면 그것을, 틀리면 앞의 맞던 것을 쓴다
    도는 sync 합침)                      │ glob(그릇 폴더 기준) → 문서 → 값 읽기(md frontmatter, yaml·json map, path capture)
        ▲                               │ 칸 검사 → item은 index, 위반은 목록
        │ 답: status, 위반(200개까지),  ◀─┘ index: <data>/derived/kinds.sqlite
        │     violations_hash
        ▼
  hash가 마지막으로 올린 값과 다르면 ── problem.sync_domain (machine 자격) ──▶ domain_problems
                                          새로 열림·다시 열림이 있으면 KindViolationFound{domain} ──▶ 그 그릇의 PM | App Engineer session

 kind.get / kind.list / kind.check (core memory route, 입력 {domain}) ──▶ dispatcher: sync(2초 규칙) 뒤 worker에 묻기
 kind.list·kind.check tool: 부른 agent가 맡은 domain만(여럿이면 domain을 입력으로 받는다)
 prompt: 맡은 domain마다 <lophn-kinds> 글, kind 파일이 바뀌면 kinds_changed notice
```

## 지키는 것

- kind 파일은 domain마다 하나이고 자리는 `<data>/domains/<dom>/kinds.yaml`이다(`domainKindsFile`, `packages/protocol/domains/paths.ts`). release도 draft도 거치지 않는다. 파일이 없으면 그 domain에는 kind가 없다.
  - 판(draft, test, submit)이 하던 일은 검사와 되돌리기다. 검사는 바뀔 때 program이 하고, 되돌리기는 rewind가 한다.
- kind 파일을 쓰는 것은 그 domain 그릇의 PM(project)이나 App Engineer(앱)뿐이다. `placeScope`가 둘에게 그 그릇의 domain 폴더 전체를 read·write로 주므로 `kinds.yaml`은 따로 연 파일 항목이 아니다. Operator의 범위에는 domain의 `artifacts/`만 있고 lophn의 범위에는 없다.
  - domain 폴더는 turn을 시작할 때 place 정보를 만들면서 core가 만든다(`architecture/artifact.md`). 같은 폴더에 `DOMAIN.md`, `skills/`, `artifacts/`가 있다.
  - rewind의 쓰기 폴더와 agent runtime의 Deno 쓰기 권한도 domain 폴더 단위다(`placeFoldersOf`, `runtimeFoldersOf`).
  - kind 파일이 가리키는 문서(glob)는 domain 폴더가 아니라 그 그릇의 폴더 기준이다. project면 등록 폴더들, 앱이면 source 폴더다. 그릇이 없거나 보관됐거나 폴더가 없으면(source가 없는 앱) 그 domain은 훑지 않고 읽기는 `not_found`다.
- 틀린 kind 파일은 앞의 맞던 kind를 지우지 않는다. yaml 문법이나 schema가 틀리면(`kinds_syntax`), 구조가 틀리면(`checkKindsStructure`), 바뀐 파일의 glob이 실제 파일 하나를 두 kind에 걸면(`glob_overlap`) `state: invalid`이고 마지막으로 맞던 kind를 계속 쓴다(`using: previous`). 앞의 것이 없으면 kind가 없다. 파일을 지우면 쓰던 kind도 버린다.
  - 판정은 worker의 `applyKindsFile`(`packages/core/projects/kinds/check/kinds-file.ts`) 하나다. 맞던 kind 파일 글은 index에 둔다. index는 파생이라 지워지면 "앞의 맞던 것"만 잃는다.
  - glob 겹침이 kind 파일 오류인 것은 kind 파일이 바뀔 때뿐이다. 그 뒤 새 문서 때문에 생긴 겹침은 그 문서의 `overlap` 위반이다. 문서 하나 때문에 쓰던 kind 파일이 통째로 무효가 되면 안 된다.
- 문서 위반은 아무것도 막지 않는다. 읽지 못한 문서(`unreadable`)와 type이 틀린 문서(`type`)는 index에서 빠지고 `skipped`로 센다. 필수·허용 값·pattern·unique·ref 위반 문서는 값이 있으므로 item으로 남는다. 두 kind에 걸린 문서(`overlap`)는 어느 kind의 item도 아니다. key 칸은 kind 안에서 유일해야 한다(`unique` 위반).
  - `kind.list`는 `skipped`를 늘 돌려준다. 빠진 것을 모르면 agent가 결과를 전부로 믿는다.
- 위반 message에는 문서의 값을 싣지 않는다. 칸 이름, 기대 type, 규칙만 쓴다. 문서 내용이 problem 목록과 tool 결과로 퍼지지 않게 한다.
- kinds worker는 lophn DB를 열지 않고 core에 닿지 않는다. 읽기는 그릇 폴더, kind 파일, 자기 index뿐이고 쓰기는 index뿐이다. network, env, subprocess는 없다(`packages/core/projects/kinds/host/process.ts`). 요청의 `kinds_file`이 그 domain의 정해진 자리가 아니면 거절한다.
- scan은 `sync`만 한다. `get`·`list`·`check`는 index를 있는 그대로 읽는다. dispatcher가 읽기 앞에 늘 sync를 보내므로 읽기는 최대 2초 묵은 것이다.
  - 위반을 problem으로 올리는 길은 sync 답 하나다. 읽기가 scan하면 그 결과가 dispatcher를 거치지 않아 위반이 오르지 않는다.
  - 직전 scan 뒤 2초 안이면 다시 훑지 않는다. 감시의 신호는 `force`로 이 규칙을 건너뛴다. 감시는 힌트일 뿐이라 놓쳐도 다음 읽기 앞 sync가 따라잡는다.
- 위반은 domain 범위 problem(`domain_problems`, `packages/core/problems/domain/`)이다. `problem.sync_domain`은 그 domain의 지금 위반 **전체**를 받아 처음 보이는 것은 열고, 닫혔다 다시 보이는 것은 다시 열고, 안 보이는 열린 것은 닫는다. 목록이 200개에서 잘렸으면(`truncated`) 닫지 않는다.
  - 같은 위반의 정체성은 `(source, kind, path, field, rule)`이고 JSON 배열 글로 저장한다. NUL로 이으면 node:sqlite가 읽을 때 잘라 저장된 행과 다시 맞지 않는다.
  - 이 command는 kinds dispatch의 machine 자격(`KINDS_DISPATCH_PRINCIPAL`)만 낸다. dispatcher는 위반 hash가 마지막으로 올린 값과 다를 때만 내고, 실패하면 기억하지 않아 다음 sync가 다시 낸다. core를 다시 켠 뒤 첫 sync는 늘 낸다.
  - 새로 열렸거나 다시 열린 위반이 있을 때만 `KindViolationFound {domain, count}`를 한 번 낸다. 기본 reaction이 그 domain 그릇의 PM(project)이나 App Engineer(앱) session을 연다(`agentOfDomain`). 위반이 줄거나 사라지는 것은 event가 아니다.
  - 받은 agent는 `problem.list`에 `domain`을 주어 그 기록을 읽고(`domain`을 주면 앱 problem이 아니라 그 domain의 kind 위반을 준다), `kind.check`로 지금 상태를 검사한다.
- `kind.get`·`kind.list`·`kind.check`는 core memory route다(`packages/core/projects/kinds/host/handlers.ts`). 입력은 `{domain}`이다. handler는 agent의 자격 그릇(`conditions.project` 또는 `conditions.app`)이 그 domain의 owner일 때만 열고, 아니면 `not_found`다. 그릇 조건이 없는 agent는 `forbidden`이다(lophn, 앱 place의 Operator). user와 machine은 막지 않는다. 같은 그릇 안에서 어느 domain을 읽을지는 tool이 정한다.
  - tool `kind.list`·`kind.check`(`packages/core/agent-roles/tools/kind.ts`)는 입력 `domain`이 agent가 맡은 domain(`ctx.domains`) 안이어야 하고 아니면 core를 부르지 않는다. 맡은 domain이 하나뿐이면 생략할 수 있다.
- prompt의 kind 글(`<lophn-kinds>`)은 맡은 domain마다 한 덩이(`Domain <name>`)로 싣는다. PM과 App Engineer는 그릇의 domain 전부를, Operator는 고른 domain을 받는다. kind 이름, 한 줄, glob, key, 칸 이름과 type(enum 값, ref 대상, required, list)을 domain 이름순, kind 이름순으로 결정적으로 조립한다. 예산을 넘으면 `full` → `names` → `count`다(모든 domain에 같은 level). kind 파일이 틀려 앞의 것을 쓰는 domain에는 그 사실을 한 줄 덧붙인다.
  - 바뀜은 쓰고 있는 kind 파일의 hash(`applied_hash`)로 본다. 다르면 `kinds_changed` notice와 새 글을 붙인다.
  - PM과 App Engineer의 place 정보에는 domain마다 폴더 경로(`Folder:`)가 있어, 파일이 아직 없어도 처음 쓸 자리를 안다.

## 왜 이 모양인가

- **판을 두지 않는다.** 예전에는 draft·test·submit 판과 bundle을 두었다. 그 일은 바뀔 때의 검사와 rewind로 충분하다. 문서만 있는 project를 코드 release 장치에 묶지 않는다(AGENTS.md "속도").
- **문서 위반이 막지 않는다.** 문서는 사람의 것이다. 막으면 schema를 바꿀 때마다 일이 멈춘다. 위반은 problem으로 올리고, schema와 문서 가운데 무엇을 고칠지는 PM이 판단한다.
- **검사는 별도 process가 한다.** 사람의 파일을 파싱하는 일을 core 밖 sandbox에 둔다. core는 감시와 dispatcher, problem 쪽 command만 맡는다. core feature module끼리 import하지 않으므로(`project-docs/architecture/layers.md`) 위반은 worker 답으로 실어 오고 problem 쪽에는 route 이름으로 command를 낸다.
- **조회는 부를 때 짠다.** 예전에는 PM이 search를 미리 선언했다. 이제 agent가 prompt의 kind 글을 보고 `kind.list`의 조건, 정렬, 집계를 부를 때 준다. 조건 schema는 세 층(묶음, 묶음, leaf)까지만 풀어 쓴다. tool 입력이 `z.toJSONSchema`로 model에 가는데 재귀는 `$ref`가 되고, 층마다 크기가 곱으로 늘기 때문이다.
- **앱 problem 표와 합치지 않았다.** 앱 problem은 report·occurrence·snapshot·release에 묶여 있다. domain 위반을 거기 끼우면 무겁다. id 접두(`prb`)만 같다. 한 목록으로 합칠지는 필요해질 때 본다.
- **kind 파일을 domain에 둔다.** 같은 project 안에서도 업무마다 문서 모양이 다르고, 앱의 domain도 같은 장치를 쓴다. 파일 범위, prompt, tool, 위반을 받는 쪽이 모두 같은 domain 단위로 좁혀진다.
