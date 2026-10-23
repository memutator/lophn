// 앱의 lophn.ts를 평가해 값을 JSON 한 줄로 낸다. AI가 쓴 앱 코드의 실수가 퍼지지 않게
// 호출자가 `deno run`으로 read 허락(staging·설치 SDK)만 주고 띄운다. `deno eval`은 모든 권한으로 돌아서 쓰지 않는다.
// 사용: deno run --allow-read=... eval-declaration.ts <lophn.ts 경로>
const path = Deno.args[0];
if (path === undefined) throw new Error("declaration path is missing");
const loaded = await import(`file://${path}`);
console.log(JSON.stringify(loaded.default));
