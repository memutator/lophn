// Hermes has no Intl.Segmenter. The protocol's session schema counts a title's graphemes with it when the module loads
// (protocol/lophn-agent/sessions.ts), so the phone gives one before that code runs. It splits by code point: a title
// with joined emoji counts a little long, which only matters next to the 60 and 120 character limits.
const scope = Intl as { Segmenter?: unknown };
scope.Segmenter ??= class {
  segment(text: string) {
    let index = 0;
    return Array.from(text, (segment) => {
      const at = index;
      index += segment.length;
      return { segment, index: at, input: text };
    });
  }
};
