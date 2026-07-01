import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

export interface ArtifactMeasurement {
  name: string;
  path: string;
  rawBytes: number;
  gzipBytes: number;
}

export async function measureArtifact(name: string, path: string): Promise<ArtifactMeasurement> {
  const bytes = await readFile(path);
  return {
    name,
    path,
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength
  };
}
