/**
 * Native GZIP compression and decompression helpers using browser's CompressionStream and DecompressionStream.
 */

export const isCompressionSupported = (): boolean => {
  return typeof globalThis.CompressionStream !== 'undefined' && typeof globalThis.DecompressionStream !== 'undefined';
};

/**
 * Compresses a JSON string using native GZIP compression.
 * Returns a Blob with the compressed binary data.
 */
export async function compressToGzip(jsonString: string): Promise<Blob> {
  if (!isCompressionSupported()) {
    throw new Error('La compresión nativa GZIP no está soportada en este navegador.');
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(jsonString);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  const compressionStream = new CompressionStream('gzip');
  const compressedStream = stream.pipeThrough(compressionStream);
  const response = new Response(compressedStream);
  return response.blob();
}

/**
 * Decompresses a GZIP-compressed Blob back into a JSON string.
 */
export async function decompressFromGzip(blob: Blob): Promise<string> {
  if (!isCompressionSupported()) {
    throw new Error('La descompresión nativa GZIP no está soportada en este navegador.');
  }
  const decompressionStream = new DecompressionStream('gzip');
  const decompressedStream = blob.stream().pipeThrough(decompressionStream);
  const response = new Response(decompressedStream);
  const arrayBuffer = await response.arrayBuffer();
  const decoder = new TextDecoder();
  return decoder.decode(arrayBuffer);
}
