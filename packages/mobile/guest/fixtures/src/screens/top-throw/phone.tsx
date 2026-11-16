// (b) Throws while the screen bundle evaluates. The build's try/catch hands it to __lophnFatal.
export default function Never() {
  return null;
}
throw new Error("top-level throw while the screen evaluates");
