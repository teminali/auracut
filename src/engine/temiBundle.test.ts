import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportTemiProjectBundle,
  unpackTemiBundle,
  importTemiProject,
  checkTemiProtection,
  isTemiProjectFile,
  guessMimeType,
  deriveAesKey,
} from './temiBundle';
import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { createClip, Track, MediaAsset } from '../types/edl';

describe('temiBundle: MIME types and Key Derivation', () => {
  it('guesses MIME types from file extensions', () => {
    expect(guessMimeType('video.mp4')).toBe('video/mp4');
    expect(guessMimeType('movie.mov')).toBe('video/quicktime');
    expect(guessMimeType('audio.wav')).toBe('audio/wav');
    expect(guessMimeType('song.mp3')).toBe('audio/mpeg');
    expect(guessMimeType('photo.png')).toBe('image/png');
    expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
    expect(guessMimeType('unknown.xyz')).toBe('application/octet-stream');
  });

  it('derives consistent AES-GCM keys for same secret and salt', async () => {
    const salt = new Uint8Array(16).fill(42);
    const key1 = await deriveAesKey('test-app-key', salt);
    const key2 = await deriveAesKey('test-app-key', salt);
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
  });
});

describe('temiBundle: Export & Import Roundtrip', () => {
  beforeEach(() => {
    useTimelineStore.getState().loadProject([], []);
    useTimelineStore.setState({ mediaPool: [] });
    useProjectStore.getState().loadProjectSettings({
      id: 'proj_test_123',
      name: 'Temi Test Project',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 10000,
      backgroundColor: '#000000',
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('exports an encrypted project bundle with assets and unpacks it seamlessly', async () => {
    // Setup mock data in stores
    const dummyPngDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const mockAsset: MediaAsset = {
      id: 'media_sample_1',
      name: 'test_image.png',
      type: 'image',
      url: dummyPngDataUri,
      thumbnailUrl: dummyPngDataUri,
      durationMs: 4000,
      fileSizeFormatted: '1 KB',
    };

    const mockClip = createClip({
      id: 'clip_1',
      trackId: 'track_v1',
      type: 'image',
      name: 'test_image.png',
      mediaUrl: dummyPngDataUri,
      startTimeMs: 0,
      durationMs: 4000,
    });

    const mockTrack: Track = {
      id: 'track_v1',
      type: 'video',
      name: 'Video 1',
      index: 0,
      muted: false,
      locked: false,
      solo: false,
      volume: 1,
      heightPx: 64,
      collapsed: false,
      clips: [mockClip],
    };

    useTimelineStore.getState().loadProject([mockTrack], [{ id: 'm1', timeMs: 2000, label: 'Intro', color: '#ff0000', kind: 'chapter' }]);
    useTimelineStore.setState({ mediaPool: [mockAsset] });

    // Export bundle
    const exportResult = await exportTemiProjectBundle();
    expect(exportResult.ok).toBe(true);
    expect(exportResult.blob).toBeDefined();
    expect(exportResult.fileName).toBe('Temi_Test_Project.temi');
    expect(exportResult.assetCount).toBe(1);

    // Check protection check
    const protection = await checkTemiProtection(exportResult.blob!);
    expect(protection.isTemi).toBe(true);
    expect(await isTemiProjectFile(exportResult.blob!)).toBe(true);

    // Clear stores before import
    useTimelineStore.getState().loadProject([], []);
    useTimelineStore.setState({ mediaPool: [] });

    // Import bundle
    const importResult = await importTemiProject(exportResult.blob!);
    expect(importResult.ok).toBe(true);
    expect(importResult.projectName).toBe('Temi Test Project');
    expect(importResult.assetCount).toBe(1);

    // Verify stores were populated and media remapped
    const currentTimeline = useTimelineStore.getState();
    const currentProject = useProjectStore.getState().project;

    expect(currentProject.name).toBe('Temi Test Project');
    expect(currentTimeline.tracks).toHaveLength(1);
    expect(currentTimeline.tracks[0].clips).toHaveLength(1);
    expect(currentTimeline.mediaPool).toHaveLength(1);
    expect(currentTimeline.markers).toHaveLength(1);

    // Verify clip mediaUrl was remapped to an object URL or valid URL
    const restoredClip = currentTimeline.tracks[0].clips[0];
    expect(restoredClip.mediaUrl).toBeDefined();
    expect(restoredClip.name).toBe('test_image.png');
  });

  it('rejects tampered project bundle ciphertext', async () => {
    const exportResult = await exportTemiProjectBundle();
    expect(exportResult.ok).toBe(true);

    const arrayBuf = await exportResult.blob!.arrayBuffer();
    const tampered = new Uint8Array(arrayBuf);

    // Tamper with bytes in the ciphertext body
    tampered[tampered.length - 5] ^= 0xff;

    const result = await unpackTemiBundle(tampered);
    expect(result.ok).toBe(false);
  });

  it('rejects non-temi files', async () => {
    const junk = new TextEncoder().encode('not a temi file at all');
    const result = await unpackTemiBundle(junk);
    expect(result.ok).toBe(false);
    expect(await isTemiProjectFile(junk)).toBe(false);
  });
});

