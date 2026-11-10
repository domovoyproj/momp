/** Read a small JSON object without buffering an unbounded request body. */
export async function readBoundedJson(req: Request, limit: number): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Request exceeds the size limit");
      }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request body");
    return parsed as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}
