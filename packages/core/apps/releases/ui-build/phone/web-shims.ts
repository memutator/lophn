// desktop preview build에서 module 이름을 대신하는 core의 source. 앱 source가 아니고 staging에 쓰지도 않는다:
// build plugin이 이 글을 그대로 읽히고 그 안의 import는 staging의 node_modules에서 푼다. 글로 두는 이유는
// core packaging이 `.ts` 밖의 file을 따로 싣지 않아도 되게 하려는 것이다.
export const WEB_SHIMS: Record<string, string> = {
  // react-native-svg가 react-native에서 TurboModuleRegistry를 가져오는데 react-native-web에는 없다.
  "react-native": `export * from "react-native-web";
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
`,
  // react-native-svg의 web image 경로가 부른다. preview에는 asset registry가 없다.
  "@react-native/assets-registry/registry": `export const getAssetByID = () => undefined;
`,
  // 폰의 guest는 react-native-svg의 `Image`(URI로 그림을 그린다)를 주지 않는다: 폰 화면은 자기 file 자리 밖의 그림과 network 그림을 그릴 수
  // 없고 SVG의 image는 그 검사를 지나지 않기 때문이다. preview도 같은 곳에서 실패해 앱 agent가 release 전에 본다.
  "react-native-svg": `export * from "react-native-svg/lib/module/index.js";
export { default } from "react-native-svg/lib/module/index.js";
export const Image = undefined;
export const FeImage = undefined;
`,
  "expo-clipboard": `export async function setStringAsync(text) {
  await navigator.clipboard?.writeText(text);
  return true;
}
export async function getStringAsync() {
  return (await navigator.clipboard?.readText()) ?? "";
}
`,
  // desktop preview에는 소프트 키보드가 없다. web build는 풀리지만 입력 focus 쪽을 믿을 수 없어 그냥 통과시킨다.
  "react-native-keyboard-controller": `import { View } from "react-native-web";
export function KeyboardProvider({ children }) {
  return children;
}
export const KeyboardAvoidingView = View;
`,
};
