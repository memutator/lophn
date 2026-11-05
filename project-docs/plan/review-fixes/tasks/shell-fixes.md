# shell-fixes

terminal supervisor의 request id 충돌을 고치고, prod renderer bundle에서 dev mock을 뺀다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/supervisor.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
- 읽을 것:
  - `packages/shell/renderer/build.ts`(renderer build가 dev/prod를 어떻게 가르는지)
  - `packages/shell/renderer/desktop/dev-mock/mod.ts`, `dev-seed.ts`
- 계약: 없음

## 할 일

1. `supervisor.ts` 202행: request id가 `req_${pending.size}_${Date.now()}`라 A·B가 걸려 있다가 A가 끝난 같은 ms에 C를 만들면 C가 B와 같은 id가 되어 B의 resolver를 덮는다. 단조 증가 counter로 바꾼다.
2. `entry.tsx` 6-7행이 `dev-mock/mod.ts`와 `dev-seed.ts`를 정적으로 import해 prod bundle에 약 9k행의 가짜 source가 실리고, prod에서도 `?mock`·`?dev-seed` URL이 앱 전체를 가짜 core로 바꾼다. build가 가진 dev 표시(`import.meta.env.DEV`나 build.ts의 define)로 감싸고 동적 `import()`로 바꿔 prod에서는 실리지 않게 한다. build에 dev 표시가 없으면 build.ts의 define을 쓰는 가장 작은 길을 보고에 "넘길 줄"로 적고 build.ts 한 줄만 고친다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- `node packages/shell/renderer/build.ts`가 되고, prod 출력에 dev-mock 코드가 없다(출력 bundle에서 dev-mock의 고유 문자열 하나를 grep해 0줄).
- 위험 test: 없음.

## 보고

brief-template의 보고 꼴.
