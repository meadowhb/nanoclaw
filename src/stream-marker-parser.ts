export class StreamMarkerParser {
  private buffer = '';
  private readonly keepChars: number;

  constructor(
    private readonly startMarker: string,
    private readonly endMarker: string,
    private readonly maxBufferChars: number,
  ) {
    this.keepChars = Math.max(
      64 * 1024,
      maxBufferChars + this.startMarker.length + this.endMarker.length,
    );
  }

  append(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length > this.keepChars) {
      this.buffer = this.buffer.slice(-this.keepChars);
    }

    const extracted: string[] = [];
    let startIdx: number;

    while ((startIdx = this.buffer.indexOf(this.startMarker)) !== -1) {
      const endIdx = this.buffer.indexOf(this.endMarker, startIdx);
      if (endIdx === -1) break;

      const payload = this.buffer
        .slice(startIdx + this.startMarker.length, endIdx)
        .trim();
      this.buffer = this.buffer.slice(endIdx + this.endMarker.length);
      extracted.push(payload);
    }

    return extracted;
  }

  get bufferedChars(): number {
    return this.buffer.length;
  }
}
