// 앱의 lophn.ts를 평가해 값을 JSON 한 줄로 낸다. 호출자는 앱 폴더를 cwd로 이 파일을 `nodeCommand`로
// 띄운다. 앱의 node_modules가 `file:.lophn/sdk`의 SDK 사본을 풀고, Node는 `node_modules` 밖의 사본에 있는
// `.ts`를 돈다. 사용: node eval-declaration.ts <lophn.ts 경로>
import process from "node:process";
import { pathToFileURL } from "node:url";

const path = process.argv[2];
if (path === undefined) throw new Error("declaration path is missing");
const loaded = await import(pathToFileURL(path).href);
console.log(JSON.stringify(loaded.default));
