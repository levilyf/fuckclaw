import zlib from 'node:zlib';

/**
 * Trace Compressor (§6.3, §6.6.1)
 * Provides lossless compression and decompression of episodic execution traces.
 */
export class TraceCompressor {
  static compress(content: string): string {
    if (!content || content.length === 0) {
      return '';
    }
    const buffer = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateSync(buffer, { level: 9 });
    return compressed.toString('base64');
  }

  static decompress(compressedBase64: string): string {
    if (!compressedBase64 || compressedBase64.length === 0) {
      return '';
    }
    try {
      const buffer = Buffer.from(compressedBase64, 'base64');
      const decompressed = zlib.inflateSync(buffer);
      return decompressed.toString('utf8');
    } catch {
      // Fallback if not compressed
      return compressedBase64;
    }
  }
}
