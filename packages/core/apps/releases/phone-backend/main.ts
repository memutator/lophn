// release 준비가 child process로 띄운다: 앱의 lophn.ts를 평가해 선언을 얻고, 폰 backend를 묶고, 묶은 것을 실어
// 본다. 앱 code가 도는 곳이라 core process 밖이다. 결과는 JSON 한 줄이다.
// 사용: node main.ts <staging 폴더>   (cwd는 staging)
// 출력: {"ok":true,"files":[...],"manifest":{...}} | {"ok":false,"message":"..."}
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { buildPhoneBackend, type PhoneBackendDeclaration } from "./build.ts";
import { loadCheckPhoneBackend } from "./load-check.ts";

const staging = process.argv[2];
if (staging === undefined) throw new Error("staging folder is missing");

function say(result: unknown): void {
  console.log(JSON.stringify(result));
}

try {
  const loaded = await import(pathToFileURL(`${staging}/lophn.ts`).href);
  const declaration = loaded.default as PhoneBackendDeclaration;
  const built = await buildPhoneBackend(staging, declaration);
  if (!built.ok) {
    say({ ok: false, message: built.error.message });
  } else {
    const checked = await loadCheckPhoneBackend(staging, declaration);
    say(
      checked.ok
        ? { ok: true, ...built.value }
        : { ok: false, message: checked.error.message },
    );
  }
} finally {
  await esbuild.stop();
}
