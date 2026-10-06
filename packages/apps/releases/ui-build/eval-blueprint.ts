// 앱의 blueprint.ts를 평가해 값을 JSON 한 줄로 낸다(apps/blueprint#R17). 앱 source는 신뢰하지 않으므로
// 호출자가 `deno run`으로 read 허락(staging·설치 SDK)만 주고 띄운다. `deno eval`은 모든 권한으로 돌아서 쓰지 않는다.
// 사용: deno run --allow-read=... eval-blueprint.ts <blueprint.ts 경로>
const path = Deno.args[0];
if (path === undefined) throw new Error("blueprint path is missing");
const loaded = await import(`file://${path}`);
console.log(JSON.stringify(loaded.default));
