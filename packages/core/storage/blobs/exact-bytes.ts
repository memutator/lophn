// 입력이 선언한 크기와 정확히 같은 바이트만 흘린다. 어긋나면 stream을 오류로 끝내 blob을
// 만들지 못하게 하고, 그 사실을 알려 호출자에게 입력 오류로 답한다.
export function exactBytes(
  source: ReadableStream<Uint8Array>,
  size: number,
  mismatch: { value: boolean },
): ReadableStream<Uint8Array> {
  let total = 0;
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > size) {
          mismatch.value = true;
          throw new Error("body longer than declared");
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (total !== size) {
          mismatch.value = true;
          throw new Error("body shorter than declared");
        }
      },
    }),
  );
}
