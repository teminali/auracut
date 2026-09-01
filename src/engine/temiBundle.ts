/* ═══════════════════════════════════════════════════════════════════
   Encrypted Project Bundle (.temi) Engine.

   Packages the complete timeline state (tracks, clips, effects,
   keyframes, markers, project settings) AND all media assets (video,
   audio, images) into a single encrypted, compressed .temi bundle.

   Any user can import the .temi file on another machine or browser,
   and TeminaliCut will unpack, decrypt, restore in-memory media URLs,
   and reload the timeline ready for immediate editing.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { useRecentsStore } from '../store/recentsStore';
import { Track, TimelineMarker, MediaAsset, ProjectSettings, createClip, Clip } from '../types/edl';
import { FORMAT_VERSION } from './projectIO';

/** Magic header for .temi bundles (8 bytes ASCII: "TEMICUT1"). */
export const TEMI_MAGIC = new Uint8Array([0x54, 0x45, 0x4D, 0x49, 0x43, 0x55, 0x54, 0x31]);
export const TEMI_BUNDLE_VERSION = 1;

/** Built-in app key — locks .temi files to TeminaliCut. Not user-facing. */
const TEMI_APP_KEY = 'temi:teminali-cut:project:v1:standard-bundle-key';

export const FLAG_GZIP_COMPRESSED = 0x02;

export interface BundledAssetEntry {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  originalUrl: string;
  byteLength: number;
}

export interface TemiManifest {
  format: 'temi.project';
  version: number;
  formatVersion: number;
  exportedAt: number;
  projectName: string;
  project: ProjectSettings;
  tracks: Track[];
  markers: TimelineMarker[];
  mediaPool: MediaAsset[];
  assetEntries: BundledAssetEntry[];
}

export interface TemiExportProgress {
  phase: 'collecting' | 'compressing' | 'encrypting' | 'done' | 'error';
  percent: number;
  statusText: string;
  currentAsset?: string;
  totalAssets?: number;
  processedAssets?: number;
}

export interface TemiExportResult {
  ok: boolean;
  blob?: Blob;
  fileName?: string;
  sizeBytes?: number;
  assetCount?: number;
  uncompressedBytes?: number;
  error?: string;
}

export interface TemiImportResult {
  ok: boolean;
  error?: string;
  projectName?: string;
  assetCount?: number;
  sizeBytes?: number;
  warnings?: string[];
}

/* ── Cryptographic Helpers ───────────────────────────────────────── */

/** Derive an AES-GCM 256-bit CryptoKey using PBKDF2 with SHA-256. */
export async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Guess a sensible MIME type from filename or URL. */
export function guessMimeType(urlOrName: string): string {
  const ext = urlOrName.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'webm': return 'video/webm';
    case 'mkv': return 'video/x-matroska';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'aac': return 'audio/aac';
    case 'ogg': return 'audio/ogg';
    case 'm4a': return 'audio/mp4';
    case 'flac': return 'audio/flac';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

/** Fetch raw binary bytes for an asset from blob:, data:, http: or file: URL. */
export async function fetchAssetBytes(url: string, fallbackName = 'asset'): Promise<{ data: Uint8Array; mimeType: string }> {
  // Handle data URIs directly
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : guessMimeType(fallbackName);
    const byteString = atob(parts[1]);
    const u8 = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      u8[i] = byteString.charCodeAt(i);
    }
    return { data: u8, mimeType };
  }

  // Handle blob:, http:, https:, or standard reachable URLs
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch asset at ${url} (HTTP ${response.status})`);
  }
  const buf = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || guessMimeType(url || fallbackName);
  return { data: new Uint8Array(buf), mimeType };
}

/* ── Compression Helpers ─────────────────────────────────────────── */

async function compressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')));
    return new Uint8Array(await stream.arrayBuffer());
  }
  return bytes;
}

async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await stream.arrayBuffer());
  }
  return bytes;
}

/* ── Binary Serialization Helpers ────────────────────────────────── */

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readUint32BE(source: Uint8Array, offset: number): number {
  return (
    ((source[offset] << 24) >>> 0) +
    (source[offset + 1] << 16) +
    (source[offset + 2] << 8) +
    source[offset + 3]
  );
}

/* ── Packing & Unpacking Payloads ────────────────────────────────── */

interface RawAssetChunk {
  id: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
}

/** Packs manifest JSON + asset binary chunks into a single byte stream. */
function packPayload(manifest: TemiManifest, rawAssets: RawAssetChunk[]): Uint8Array {
  const enc = new TextEncoder();
  const manifestBytes = enc.encode(JSON.stringify(manifest));

  // Compute total size needed
  let totalBytes = 4 + 4 + manifestBytes.length + 4; // version (4) + manifestLen (4) + manifestBytes + assetCount (4)
  const preparedAssets: {
    idBytes: Uint8Array;
    mimeBytes: Uint8Array;
    nameBytes: Uint8Array;
    data: Uint8Array;
  }[] = [];

  for (const asset of rawAssets) {
    const idBytes = enc.encode(asset.id);
    const mimeBytes = enc.encode(asset.mimeType);
    const nameBytes = enc.encode(asset.name);
    preparedAssets.push({ idBytes, mimeBytes, nameBytes, data: asset.data });

    totalBytes += 4 + idBytes.length + 4 + mimeBytes.length + 4 + nameBytes.length + 4 + asset.data.length;
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;

  // 1. Payload version
  writeUint32BE(output, offset, TEMI_BUNDLE_VERSION);
  offset += 4;

  // 2. Manifest JSON
  writeUint32BE(output, offset, manifestBytes.length);
  offset += 4;
  output.set(manifestBytes, offset);
  offset += manifestBytes.length;

  // 3. Asset Count
  writeUint32BE(output, offset, preparedAssets.length);
  offset += 4;

  // 4. Asset Chunks
  for (const asset of preparedAssets) {
    writeUint32BE(output, offset, asset.idBytes.length);
    offset += 4;
    output.set(asset.idBytes, offset);
    offset += asset.idBytes.length;

    writeUint32BE(output, offset, asset.mimeBytes.length);
    offset += 4;
    output.set(asset.mimeBytes, offset);
    offset += asset.mimeBytes.length;

    writeUint32BE(output, offset, asset.nameBytes.length);
    offset += 4;
    output.set(asset.nameBytes, offset);
    offset += asset.nameBytes.length;

    writeUint32BE(output, offset, asset.data.length);
    offset += 4;
    output.set(asset.data, offset);
    offset += asset.data.length;
  }

  return output;
}

/** Unpacks uncompressed byte stream back into manifest and raw assets. */
function unpackPayload(bytes: Uint8Array): { manifest: TemiManifest; assets: RawAssetChunk[] } {
  const dec = new TextDecoder();
  let offset = 0;

  if (bytes.length < 12) {
    throw new Error('Corrupted or truncated project bundle payload.');
  }

  const payloadVersion = readUint32BE(bytes, offset);
  offset += 4;

  if (payloadVersion > TEMI_BUNDLE_VERSION) {
    throw new Error(`Project was created with a newer version of TeminaliCut (v${payloadVersion}).`);
  }

  const manifestLen = readUint32BE(bytes, offset);
  offset += 4;

  if (offset + manifestLen > bytes.length) {
    throw new Error('Truncated manifest data in project bundle.');
  }

  const manifestJson = dec.decode(bytes.subarray(offset, offset + manifestLen));
  offset += manifestLen;

  const manifest = JSON.parse(manifestJson) as TemiManifest;

  const assetCount = readUint32BE(bytes, offset);
  offset += 4;

  const assets: RawAssetChunk[] = [];

  for (let i = 0; i < assetCount; i++) {
    // ID
    const idLen = readUint32BE(bytes, offset);
    offset += 4;
    const id = dec.decode(bytes.subarray(offset, offset + idLen));
    offset += idLen;

    // MIME
    const mimeLen = readUint32BE(bytes, offset);
    offset += 4;
    const mimeType = dec.decode(bytes.subarray(offset, offset + mimeLen));
    offset += mimeLen;

    // Name
    const nameLen = readUint32BE(bytes, offset);
    offset += 4;
    const name = dec.decode(bytes.subarray(offset, offset + nameLen));
    offset += nameLen;

    // Data
    const dataLen = readUint32BE(bytes, offset);
    offset += 4;
    const data = bytes.subarray(offset, offset + dataLen);
    offset += dataLen;

    assets.push({ id, name, mimeType, data: new Uint8Array(data) });
  }

  return { manifest, assets };
}

/* ── Export Bundle API ───────────────────────────────────────────── */

export async function exportTemiProjectBundle(options?: {
  onProgress?: (progress: TemiExportProgress) => void;
}): Promise<TemiExportResult> {
  const onProgress = options?.onProgress ?? (() => {});
  const timeline = useTimelineStore.getState();
  const project = useProjectStore.getState().project;

  try {
    onProgress({ phase: 'collecting', percent: 10, statusText: 'Inspecting media assets…' });

    // Identify all unique media assets from mediaPool and clips
    const assetsToBundle: MediaAsset[] = [];
    const seenAssetIds = new Set<string>();

    for (const asset of timeline.mediaPool) {
      if (asset.id && !seenAssetIds.has(asset.id)) {
        seenAssetIds.add(asset.id);
        assetsToBundle.push(asset);
      }
    }

    // Also check clips for any assets not in mediaPool
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.mediaUrl && !clip.mediaUrl.startsWith('data:') && !seenAssetIds.has(clip.mediaUrl)) {
          // If not in media pool, create asset entry
          const exists = assetsToBundle.find((a) => a.url === clip.mediaUrl);
          if (!exists) {
            seenAssetIds.add(clip.mediaUrl);
            assetsToBundle.push({
              id: `bundled_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              name: clip.name || 'Clip Media',
              type: clip.type,
              url: clip.mediaUrl,
              thumbnailUrl: clip.thumbnailUrl || '',
              durationMs: clip.durationMs,
              fileSizeFormatted: '',
            });
          }
        }
      }
    }

    const rawAssets: RawAssetChunk[] = [];
    const assetEntries: BundledAssetEntry[] = [];
    let processed = 0;
    let totalUncompressedBytes = 0;

    for (const asset of assetsToBundle) {
      processed++;
      const percent = 10 + Math.round((processed / Math.max(1, assetsToBundle.length)) * 40);
      onProgress({
        phase: 'collecting',
        percent,
        statusText: `Reading asset ${processed}/${assetsToBundle.length}: ${asset.name}`,
        currentAsset: asset.name,
        totalAssets: assetsToBundle.length,
        processedAssets: processed,
      });

      if (!asset.url) continue;

      try {
        const { data, mimeType } = await fetchAssetBytes(asset.url, asset.name);
        rawAssets.push({
          id: asset.id,
          name: asset.name,
          mimeType,
          data,
        });
        assetEntries.push({
          id: asset.id,
          name: asset.name,
          type: asset.type,
          mimeType,
          originalUrl: asset.url,
          byteLength: data.length,
        });
        totalUncompressedBytes += data.length;
      } catch (err) {
        console.warn(`[temi] Failed to bundle media asset ${asset.name} (${asset.url}):`, err);
      }
    }

    onProgress({ phase: 'compressing', percent: 60, statusText: 'Compressing project archive…' });

    // Assemble Manifest
    const manifest: TemiManifest = {
      format: 'temi.project',
      version: TEMI_BUNDLE_VERSION,
      formatVersion: FORMAT_VERSION,
      exportedAt: Date.now(),
      projectName: project.name || 'Untitled Project',
      project,
      tracks: timeline.tracks,
      markers: timeline.markers,
      mediaPool: timeline.mediaPool,
      assetEntries,
    };

    // Pack binary payload
    const uncompressedPayload = packPayload(manifest, rawAssets);
    totalUncompressedBytes += uncompressedPayload.length;

    // GZIP compress payload
    const compressedPayload = await compressGzip(uncompressedPayload);

    onProgress({ phase: 'encrypting', percent: 80, statusText: 'Encrypting bundle with AES-256-GCM…' });

    // Generate Salt & IV
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const aesKey = await deriveAesKey(TEMI_APP_KEY, salt);

    // Encrypt compressed payload
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      compressedPayload as BufferSource
    );
    const ciphertext = new Uint8Array(ciphertextBuf);

    // Build final file structure:
    // [8 bytes: Magic TEMICUT1]
    // [1 byte: Flags]
    // [16 bytes: Salt]
    // [12 bytes: IV]
    // [4 bytes: Ciphertext Length]
    // [Ciphertext bytes]
    const flags = FLAG_GZIP_COMPRESSED;

    const totalFileSize = 8 + 1 + 16 + 12 + 4 + ciphertext.length;
    const finalFileBytes = new Uint8Array(totalFileSize);

    let offset = 0;
    finalFileBytes.set(TEMI_MAGIC, offset);
    offset += 8;

    finalFileBytes[offset] = flags;
    offset += 1;

    finalFileBytes.set(salt, offset);
    offset += 16;

    finalFileBytes.set(iv, offset);
    offset += 12;

    writeUint32BE(finalFileBytes, offset, ciphertext.length);
    offset += 4;

    finalFileBytes.set(ciphertext, offset);

    const blob = new Blob([finalFileBytes], { type: 'application/octet-stream' });
    const cleanName = project.name.replace(/[^\w\-]+/g, '_') || 'Project';
    const fileName = `${cleanName}.temi`;

    onProgress({ phase: 'done', percent: 100, statusText: 'Bundle ready!' });

    return {
      ok: true,
      blob,
      fileName,
      sizeBytes: finalFileBytes.length,
      assetCount: rawAssets.length,
      uncompressedBytes: totalUncompressedBytes,
    };
  } catch (err) {
    const error = (err as Error).message || 'Failed to export project bundle.';
    onProgress({ phase: 'error', percent: 0, statusText: error });
    return { ok: false, error };
  }
}

/* ── Inspect & Import Bundle API ─────────────────────────────────── */

/** Fast check whether a file is a valid .temi bundle. */
export async function checkTemiProtection(
  fileOrBuffer: Blob | ArrayBuffer | Uint8Array
): Promise<{ isTemi: boolean }> {
  let bytes: Uint8Array;
  if (fileOrBuffer instanceof Uint8Array) {
    bytes = fileOrBuffer;
  } else if (fileOrBuffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileOrBuffer);
  } else {
    // Blob
    const slice = await fileOrBuffer.slice(0, 41).arrayBuffer();
    bytes = new Uint8Array(slice);
  }

  if (bytes.length < 41) return { isTemi: false };

  // Check magic
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== TEMI_MAGIC[i]) return { isTemi: false };
  }

  return { isTemi: true };
}

/** Check if a file is a .temi file. */
export async function isTemiProjectFile(fileOrBuffer: Blob | ArrayBuffer | Uint8Array): Promise<boolean> {
  const { isTemi } = await checkTemiProtection(fileOrBuffer);
  return isTemi;
}

export interface UnpackedTemiProject {
  manifest: TemiManifest;
  assetBlobUrls: Map<string, string>;
  assetCount?: number;
  warnings: string[];
}

/** Unpack, decrypt, and decompress a .temi bundle. */
export async function unpackTemiBundle(
  fileOrBuffer: Blob | ArrayBuffer | Uint8Array
): Promise<{ ok: true; data: UnpackedTemiProject } | { ok: false; error: string }> {
  let bytes: Uint8Array;
  if (fileOrBuffer instanceof Uint8Array) {
    bytes = fileOrBuffer;
  } else if (fileOrBuffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileOrBuffer);
  } else {
    bytes = new Uint8Array(await fileOrBuffer.arrayBuffer());
  }

  if (bytes.length < 41) {
    return { ok: false, error: 'That file is too small to be a valid .temi project bundle.' };
  }

  // Validate magic header
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== TEMI_MAGIC[i]) {
      return { ok: false, error: 'That file is not a valid TeminaliCut (.temi) project bundle.' };
    }
  }

  let offset = 8;
  const flags = bytes[offset];
  offset += 1;

  const isGzip = (flags & FLAG_GZIP_COMPRESSED) !== 0;

  const salt = bytes.subarray(offset, offset + 16);
  offset += 16;

  const iv = bytes.subarray(offset, offset + 12);
  offset += 12;

  const ciphertextLen = readUint32BE(bytes, offset);
  offset += 4;

  if (offset + ciphertextLen > bytes.length) {
    return { ok: false, error: 'Truncated ciphertext in .temi project bundle.' };
  }

  const ciphertext = bytes.subarray(offset, offset + ciphertextLen);

  // Always use the built-in app key — no user passwords
  let plaintextBuf: ArrayBuffer;
  try {
    const aesKey = await deriveAesKey(TEMI_APP_KEY, salt);
    plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      ciphertext as BufferSource
    );
  } catch {
    return { ok: false, error: 'Could not decrypt this project bundle. It may have been created by a different version of TeminaliCut.' };
  }

  let uncompressedBytes: Uint8Array = new Uint8Array(plaintextBuf);
  if (isGzip) {
    try {
      uncompressedBytes = await decompressGzip(uncompressedBytes);
    } catch (err) {
      return { ok: false, error: `Failed to decompress project payload: ${(err as Error).message}` };
    }
  }

  const { manifest, assets } = unpackPayload(uncompressedBytes);

  // Create Blob and Object URLs for all extracted assets
  const assetBlobUrls = new Map<string, string>();
  const warnings: string[] = [];

  for (const asset of assets) {
    try {
      const blob = new Blob([asset.data as unknown as BlobPart], { type: asset.mimeType || 'application/octet-stream' });
      const objectUrl = URL.createObjectURL(blob);
      assetBlobUrls.set(asset.id, objectUrl);

      // Also map original URL if recorded in manifest
      const entry = manifest.assetEntries?.find((e) => e.id === asset.id);
      if (entry?.originalUrl) {
        assetBlobUrls.set(entry.originalUrl, objectUrl);
      }
    } catch (err) {
      warnings.push(`Could not reconstruct media asset ${asset.name}: ${(err as Error).message}`);
    }
  }

  return {
    ok: true,
    data: {
      manifest,
      assetBlobUrls,
      assetCount: assets.length,
      warnings,
    },
  };
}

/**
 * Applies an unpacked Temi project to the app's zustand stores,
 * remapping all media URLs so playback works seamlessly.
 */
export function applyTemiProjectToStores(unpacked: UnpackedTemiProject): { ok: boolean; assetCount: number } {
  const { manifest, assetBlobUrls } = unpacked;

  // Remap media pool
  const remappedMediaPool: MediaAsset[] = (manifest.mediaPool || []).map((asset) => {
    const newUrl = assetBlobUrls.get(asset.id) || assetBlobUrls.get(asset.url) || asset.url;
    const newThumb = asset.thumbnailUrl
      ? assetBlobUrls.get(asset.thumbnailUrl) || (asset.type === 'image' || asset.type === 'video' ? newUrl : '')
      : (asset.type === 'image' || asset.type === 'video' ? newUrl : '');

    return {
      ...asset,
      url: newUrl,
      thumbnailUrl: newThumb,
    };
  });

  // Remap tracks and clips
  const remappedTracks: Track[] = (manifest.tracks || []).map((track) => ({
    ...track,
    collapsed: track.collapsed ?? false,
    clips: (track.clips || []).map((clip) => {
      let newMediaUrl = clip.mediaUrl;
      if (clip.mediaUrl) {
        newMediaUrl = assetBlobUrls.get(clip.mediaUrl) || assetBlobUrls.get((clip as any).mediaAssetId) || clip.mediaUrl;
      }
      return createClip({
        ...(clip as Clip),
        mediaUrl: newMediaUrl,
      });
    }),
  }));

  // Apply to stores
  useTimelineStore.getState().loadProject(remappedTracks, manifest.markers || []);
  useProjectStore.getState().loadProjectSettings(manifest.project);
  useTimelineStore.setState({ mediaPool: remappedMediaPool });

  // Remember in recents wall
  useRecentsStore.getState().remember({
    id: manifest.project.id,
    name: manifest.project.name,
    durationMs: manifest.project.durationMs,
    aspectRatio: manifest.project.aspectRatio,
    clipCount: remappedTracks.reduce((sum, t) => sum + t.clips.length, 0),
  });

  return { ok: true, assetCount: unpacked.assetCount ?? remappedMediaPool.length };
}

/**
 * Top-level helper to import a .temi project file directly.
 */
export async function importTemiProject(
  fileOrBuffer: Blob | ArrayBuffer | Uint8Array
): Promise<TemiImportResult> {
  const result = await unpackTemiBundle(fileOrBuffer);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    };
  }

  const { assetCount } = applyTemiProjectToStores(result.data);

  return {
    ok: true,
    projectName: result.data.manifest.projectName || result.data.manifest.project.name,
    assetCount,
    warnings: result.data.warnings,
  };
}
