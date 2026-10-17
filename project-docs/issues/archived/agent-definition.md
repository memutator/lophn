# agent-definition (닫음)

## `web.fetch` redirect를 hop마다 검사하며 직접 따라간다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `tools/web/fetch.ts`가 `redirect: "manual"`로 최대 5번(`MAX_REDIRECTS`) 따라가며 hop마다 `tools/web/target.ts`의 `checkFetchTarget`을 부른다. 이 검사는 scheme과 host literal(localhost, 사설 IPv4, IPv6 loopback·ULA·link-local, `::ffff:` 매핑)만 본다. 파일은 68줄이다(예전 글처럼 표가 길지는 않다). host 이름이 사설 주소로 풀리는 경우(DNS)는 보지 않는다.

영향: 이 검사가 사람 PC의 내부 주소로 agent가 요청을 보내지 못하게 하는 경계다. 지우면 redirect로 내부 주소를 칠 수 있다.

고치려면: 권한 경계라 줄일 이유가 약하다. 추천: 남기고 archived로 닫는다(kept). DNS 재바인딩은 별도 이슈로 다룰지 사람이 정한다.

닫음: 남긴다. 인터넷 내용이 사람 PC 내부 주소를 치지 못하게 막는다. DNS 해석 검사는 더하지 않는다.

## 경로 판정이 symlink·끊어진 symlink·새 파일의 상위 realpath까지 본다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: scope_test.ts
```

지금: `tools/file/scope.ts`의 `resolveInPlace`가 후보 경로를 정규화한 뒤 있는 가장 가까운 상위 폴더까지 올라가 `realpath`를 구하고, 끊어진 symlink(`lstat`이 symlink)는 거절하고, 허용 폴더의 realpath 안인지 본다. 92줄이다.

영향: 판정이 복잡하지만 place 밖 쓰기를 막는 유일한 경계(shell은 묻지도 않는다)다. 단순화하면 symlink로 폴더를 탈출할 수 있다.

고치려면: 권한 경계라 남기는 쪽을 추천한다. archived로 닫는다(kept)(`scope_test.ts`가 있다).

닫음: 남긴다. agent가 place 폴더 밖에 쓰는 실수를 막는 유일한 경계다.

## App Engineer의 active context 읽기가 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `agents/layers.ts`의 `activeContexts`가 App Engineer에도 그 앱을 source로 읽는 context를 `context.list`로 페이지마다 읽어(최대 50쪽) `resolveAgent`의 `active_contexts`로 넘기고, `resolve.ts`가 `agent.contexts`에 담는다. 그러나 `run-loop/place-data.ts`는 `agent.contexts`를 project_manager와 operator에게만 읽고, `prompt-assembly/place-info.ts`의 `visibleContexts`는 `app_engineer`에게 `false`를 준다. 읽은 결과가 어디에도 보이지 않는다.

영향: turn마다 쓰이지 않을 core 읽기가 App Engineer에게 돈다. 읽기 코드와 `agent.contexts` 필드의 의미가 혼동된다(`hash`에는 들어간다).

고치려면: (a) `layers.ts`에서 App Engineer 분기를 지운다(`resolve.ts`가 `role !== "lophn"`이면 담는 줄도 맞춘다). (b) App Engineer에게 context를 보이게 한다. 이쪽은 제품 결정이다. 추천: (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `activeContexts`에서 App Engineer 분기(`context_app_data` join 포함)와 `role` 인자를 지웠다. project place만 그 project의 active context를 읽고, 나머지 role은 빈 목록이다.

## deferred tool을 아무 tool에도 켜지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `prompt-assembly/turn-prompt.ts`가 `TurnTool.deferred`를 보고(`deferredBlock`, `tools[]` 거르기) `tools/bundles/skill.ts`의 `tool.search`가 정의를 돌려주지만, `run-loop/prepare.ts`는 `deferred`를 한 번도 켜지 않는다. 모든 tool 정의가 prompt에 실린다.

영향: 쓰이지 않는 분기와 tool 하나(`tool.search`가 model에 노출된다)가 prompt와 코드에 남는다.

고치려면: (a) `deferred`, `deferredBlock`, `tool.search`를 지운다(`tool.search`는 tool 카탈로그·role 목록에서도). (b) 정의가 큰 tool(MCP 많이 붙은 경우)에 켠다. 추천: MCP tool이 많아져 prompt가 커지는 것이 아직 문제가 아니므로 (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `tool.search` tool과 입력 schema, `TurnTool.deferred`, `deferredBlock`, system 층 `tools`를 지웠다.
