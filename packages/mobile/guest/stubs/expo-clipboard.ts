// The guest has no Expo modules. The kit's code block imports expo-clipboard for its copy button; copying is not a
// host operation a screen may call, so in a guest it does nothing.
export async function setStringAsync(_text: string): Promise<boolean> {
  console.log("lophn guest: copy is not available in an app screen");
  return false;
}
