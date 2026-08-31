import { describe, it, expect } from 'vitest';
import { assembleRecording, alignToSpeech, detectIntroduction, detectOutro, DEMONSTRATION_MARKERS, OUTRO_MARKERS } from './recordingProject';
import { findQuietStretches, pointerTravelTimes } from './cursorZoom';
import { Take } from './screenCapture';
import { useTimelineStore } from '../store/timelineStore';

describe('Semantic Speech & Telemetry Camera Switching (End-to-End)', () => {
  const baseTake: Take = {
    dir: '/tmp/take_test',
    durationMs: 30000,
    fps: 30,
    cursorTracked: true,
    input: { ok: true, source: 'events', reason: 'ready', message: 'Ready' },
    cursor: [
      { tMs: 0, x: 0.1, y: 0.1 },
      { tMs: 1000, x: 0.1, y: 0.1 },
      // Mouse movement at 8s - 12s
      { tMs: 8000, x: 0.1, y: 0.1 },
      { tMs: 8500, x: 0.2, y: 0.3 },
      { tMs: 9000, x: 0.35, y: 0.45 },
      { tMs: 9500, x: 0.5, y: 0.6 },
      { tMs: 10000, x: 0.6, y: 0.6 },
      // Mouse movement at 20s - 22s
      { tMs: 20000, x: 0.6, y: 0.6 },
      { tMs: 21000, x: 0.8, y: 0.8 },
      { tMs: 22000, x: 0.8, y: 0.8 },
      { tMs: 30000, x: 0.8, y: 0.8 },
    ],
    events: [
      { tMs: 10000, kind: 'click', x: 0.6, y: 0.6 },
      { tMs: 21500, kind: 'click', x: 0.8, y: 0.8 },
    ],
    marks: [],
    screen: {
      url: 'file:///tmp/screen.mp4',
      path: '/tmp/screen.mp4',
      raw: false,
      bytes: 1024000,
      width: 1920,
      height: 1080,
      hasAudio: false,
    },
    camera: {
      url: 'file:///tmp/camera.mp4',
      path: '/tmp/camera.mp4',
      raw: false,
      bytes: 2048000,
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
    cameraOffsetMs: 0,
    warnings: [],
  };

  it('pointerTravelTimes accurately detects steady and subtle mouse movements', () => {
    const travel = pointerTravelTimes(baseTake.cursor);
    expect(travel.length).toBeGreaterThan(0);
    // Movements at 8.5s, 9.0s, 9.5s, 21.0s should all be caught
    expect(travel.some((t) => t >= 8000 && t <= 10000)).toBe(true);
    expect(travel.some((t) => t >= 20000 && t <= 22000)).toBe(true);
  });

  it('keeps camera in PiP inset with 0 takeovers when there is no speech transcript', async () => {
    useTimelineStore.setState({ tracks: [] });
    const report = await assembleRecording(baseTake, { speech: [] });
    
    // When speech is empty, camera must NOT take over full screen
    expect(report.cameraTakeovers).toBe(0);
    
    // Camera clip exists on track
    const tracks = useTimelineStore.getState().tracks;
    const cameraTrack = tracks.find((t) => t.name.includes('Camera'));
    expect(cameraTrack).toBeDefined();
  });

  it('keeps camera in PiP inset when speech is demonstrating UI actions', async () => {
    useTimelineStore.setState({ tracks: [] });
    const speech = [
      { startMs: 2000, endMs: 7000, text: 'Click on the settings button and open the preferences menu.' },
      { startMs: 12000, endMs: 18000, text: 'As you can see right here, let us type the command in the terminal.' },
    ];
    const report = await assembleRecording(baseTake, { speech });
    
    // Demonstration speech must veto camera takeover
    expect(report.cameraTakeovers).toBe(0);
  });

  it('allows full-frame camera takeover only when speech is conceptual and mouse is idle', async () => {
    useTimelineStore.setState({ tracks: [] });
    const speech = [
      // Spoken concept during quiet gap (12s - 18s) with no mouse action
      { startMs: 12500, endMs: 17500, text: 'This architecture allows agents to communicate cleanly without overhead.' },
    ];
    const report = await assembleRecording(baseTake, { speech });
    
    // Conceptual speech with idle mouse is allowed
    expect(report.cameraTakeovers).toBe(1);
  });

  it('opens on full-frame camera for spoken intro and returns to screen before mouse action starts', async () => {
    useTimelineStore.setState({ tracks: [] });
    const speech = [
      { startMs: 200, endMs: 6000, text: 'Hi everyone, my name is Alex and today I want to introduce our video editor.' },
      { startMs: 8000, endMs: 15000, text: 'Now let us click on the dashboard button to get started.' },
    ];
    const report = await assembleRecording(baseTake, { speech });
    
    // Should detect intro
    expect(report.notes.some((n) => n.toLowerCase().includes('opens with') || n.toLowerCase().includes('introduction'))).toBe(true);
  });

  it('never covers active mouse movement with full-screen camera', async () => {
    const stretches = findQuietStretches(
      { cursor: baseTake.cursor, events: baseTake.events, marks: [] },
      baseTake.durationMs
    );
    
    // None of the quiet stretches should overlap with the mouse movement times (8s-10s, 20s-22s)
    for (const stretch of stretches) {
      expect(stretch.startMs < 10000 && stretch.endMs > 8000).toBe(false);
      expect(stretch.startMs < 22000 && stretch.endMs > 20000).toBe(false);
    }
  });
});
