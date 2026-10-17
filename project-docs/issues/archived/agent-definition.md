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
