/* ═══════════════════════════════════════════════════════════════════
   Seed project — the sequence Kerf opens with.
   Every clip is built through `createClip` so it is always complete.
   ═══════════════════════════════════════════════════════════════════ */

import { Track, MediaAsset, ProjectSettings, createClip } from '../types/edl';

export const INITIAL_PROJECT: ProjectSettings = {
  id: 'proj_default_kerf',
  name: 'DukaBot Commercial · Seq 01',
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 16000,
  backgroundColor: '#000000',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/*
  These are STILLS, and they say so.

  They used to be typed `video`, named `.mov`, and labelled
  `ProRes 422 HQ` at `18.4 MB` — while being Unsplash JPEGs. That fiction
  hid a real bug for a long time: the compositor had no video decode path
  at all, and drew every clip through an <img>. Stills render fine that
  way, so the demo looked like a working video editor while actual footage
  rendered as a grey placeholder gradient.

  A seed project that misdescribes itself is a test that always passes.
*/
export const SAMPLE_MEDIA_ASSETS: MediaAsset[] = [
  {
    id: 'media_cyber_city',
    name: 'Still_NeonCity.jpg',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1600&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=300&q=80',
    durationMs: 6000,
    width: 1920,
    height: 1080,
    fileSizeFormatted: '-',
    codec: 'JPEG',
    transcript: 'Welcome to the future of AI commerce in Tanzania.',
  },
  {
    id: 'media_spiderman_jump',
    name: 'Still_CinematicJump.jpg',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1635863138275-d9b33299680b?auto=format&fit=crop&w=1600&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1635863138275-d9b33299680b?auto=format&fit=crop&w=300&q=80',
    durationMs: 5000,
    width: 1920,
    height: 1080,
    fileSizeFormatted: '-',
    codec: 'JPEG',
    transcript: 'DukaBot AI gives your duka superpowers.',
  },
  {
    id: 'media_duka_store',
    name: 'Still_KariakooStore.jpg',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1600&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=300&q=80',
    durationMs: 5000,
    width: 1920,
    height: 1080,
    fileSizeFormatted: '-',
    codec: 'JPEG',
    transcript: 'Record sales over WhatsApp in seconds.',
  },
  {
    id: 'media_phonk_bgm',
    name: 'Audio_TechHouse_Master.wav',
    type: 'audio',
    url: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3',
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=300&q=80',
    durationMs: 16000,
    fileSizeFormatted: '4.2 MB',
    codec: 'WAV 48kHz 24-bit',
  },
  {
    id: 'media_whoosh_sfx',
    name: 'SFX_OpticalWhoosh_01.wav',
    type: 'audio',
    url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
    thumbnailUrl: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=300&q=80',
    durationMs: 1500,
    fileSizeFormatted: '380 KB',
    codec: 'WAV 48kHz 24-bit',
  },
  {
    id: 'media_plushie_cutout',
    name: 'Graphics_Mascot_Layer.png',
    type: 'image',
    url: 'https://images.unsplash.com/photo-1535223289827-42f1e9919769?auto=format&fit=crop&w=900&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1535223289827-42f1e9919769?auto=format&fit=crop&w=300&q=80',
    durationMs: 6000,
    width: 900,
    height: 900,
    fileSizeFormatted: '1.1 MB',
  },
];

const asset = (id: string): MediaAsset =>
  SAMPLE_MEDIA_ASSETS.find((a) => a.id === id) ?? SAMPLE_MEDIA_ASSETS[0];

/* ── Tracks, top layer first (index 0 renders last / on top) ────── */

export const INITIAL_TRACKS: Track[] = [
  {
    id: 'track_text_v3',
    type: 'text',
    name: 'Subtitles',
    index: 0,
    muted: false,
    locked: false,
    solo: false,
    volume: 1,
    heightPx: 46,
    collapsed: false,
    clips: [
      createClip({
        id: 'clip_text_1',
        trackId: 'track_text_v3',
        type: 'text',
        name: 'DukaBot AI Commercial',
        color: '#a03a6b',
        startTimeMs: 500,
        durationMs: 4500,
        sourceDurationMs: 4500,
        transform: { y: 340 },
        keyframes: [
          { id: 'kf_t1', property: 'scaleX', timeOffsetMs: 0, value: 0.85, easing: 'easeOut' },
          { id: 'kf_t2', property: 'scaleX', timeOffsetMs: 300, value: 1, easing: 'linear' },
          { id: 'kf_t3', property: 'scaleY', timeOffsetMs: 0, value: 0.85, easing: 'easeOut' },
          { id: 'kf_t4', property: 'scaleY', timeOffsetMs: 300, value: 1, easing: 'linear' },
        ],
        textStyle: {
          text: 'DUKABOT AI COMMERCIAL',
          fontSize: 68,
          color: '#ffffff',
          highlightColor: '#4c9dff',
          kineticAnimation: 'kinetic_stack',
        },
      }),
      createClip({
        id: 'clip_text_2',
        trackId: 'track_text_v3',
        type: 'text',
        name: 'Sales Automated',
        color: '#a03a6b',
        startTimeMs: 6000,
        durationMs: 5000,
        sourceDurationMs: 5000,
        transform: { y: 340 },
        textStyle: {
          text: 'SALES, AUTOMATED',
          fontSize: 68,
          color: '#ffffff',
          highlightColor: '#2fc98d',
          kineticAnimation: 'pop_in',
        },
      }),
    ],
  },

  {
    id: 'track_overlay_v2',
    type: 'overlay',
    name: 'Overlays',
    index: 1,
    muted: false,
    locked: false,
    solo: false,
    volume: 1,
    heightPx: 52,
    collapsed: false,
    clips: [
      createClip({
        id: 'clip_plushie_1',
        trackId: 'track_overlay_v2',
        type: 'image',
        name: 'Mascot Overlay (PIP)',
        mediaUrl: asset('media_plushie_cutout').url,
        thumbnailUrl: asset('media_plushie_cutout').thumbnailUrl,
        color: '#7b56c9',
        startTimeMs: 1500,
        durationMs: 4000,
        sourceDurationMs: 4000,
        naturalWidth: 900,
        naturalHeight: 900,
        fitMode: 'contain',
        transform: { x: 520, y: 220, scaleX: 0.62, scaleY: 0.62 },
        keyframes: [
          { id: 'kf_p1', property: 'rotation', timeOffsetMs: 0, value: -6, easing: 'easeInOut' },
          { id: 'kf_p2', property: 'rotation', timeOffsetMs: 2000, value: 8, easing: 'easeInOut' },
          { id: 'kf_p3', property: 'rotation', timeOffsetMs: 4000, value: -4, easing: 'easeInOut' },
        ],
      }),
    ],
  },

  {
    id: 'track_main_v1',
    type: 'video',
    name: 'Primary Video',
    index: 2,
    muted: false,
    locked: false,
    solo: false,
    volume: 1,
    heightPx: 58,
    collapsed: false,
    clips: [
      createClip({
        id: 'clip_vid_1',
        trackId: 'track_main_v1',
        type: 'image',
        name: 'Still_NeonCity.jpg',
        mediaUrl: asset('media_cyber_city').url,
        thumbnailUrl: asset('media_cyber_city').thumbnailUrl,
        color: '#2f6fb8',
        startTimeMs: 0,
        durationMs: 5500,
        sourceDurationMs: 5500,
        naturalWidth: 1920,
        naturalHeight: 1080,
        filters: { contrast: 15, saturation: 20 },
        transitionOut: { type: 'whip_pan', durationMs: 400 },
      }),
      createClip({
        id: 'clip_vid_2',
        trackId: 'track_main_v1',
        type: 'image',
        name: 'Still_CinematicJump.jpg',
        mediaUrl: asset('media_spiderman_jump').url,
        thumbnailUrl: asset('media_spiderman_jump').thumbnailUrl,
        color: '#2f6fb8',
        startTimeMs: 5500,
        durationMs: 5000,
        sourceDurationMs: 5000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        transitionIn: { type: 'whip_pan', durationMs: 400 },
        transitionOut: { type: 'zoom_in', durationMs: 350 },
      }),
      createClip({
        id: 'clip_vid_3',
        trackId: 'track_main_v1',
        type: 'image',
        name: 'Still_KariakooStore.jpg',
        mediaUrl: asset('media_duka_store').url,
        thumbnailUrl: asset('media_duka_store').thumbnailUrl,
        color: '#2f6fb8',
        startTimeMs: 10500,
        durationMs: 5500,
        sourceDurationMs: 5500,
        naturalWidth: 1920,
        naturalHeight: 1080,
        transitionIn: { type: 'zoom_in', durationMs: 350 },
      }),
    ],
  },

  {
    id: 'track_audio_a1',
    type: 'audio',
    name: 'Master Audio',
    index: 3,
    muted: false,
    locked: false,
    solo: false,
    volume: 0.85,
    heightPx: 48,
    collapsed: false,
    clips: [
      createClip({
        id: 'clip_bgm_1',
        trackId: 'track_audio_a1',
        type: 'audio',
        name: 'Audio_TechHouse_Master.wav',
        mediaUrl: asset('media_phonk_bgm').url,
        color: '#1f7d5c',
        startTimeMs: 0,
        durationMs: 16000,
        sourceDurationMs: 16000,
        audio: { volume: 0.8, fadeInMs: 400, fadeOutMs: 1200 },
      }),
    ],
  },

  {
    id: 'track_sfx_a2',
    type: 'audio',
    name: 'Sound Effects',
    index: 4,
    muted: false,
    locked: false,
    solo: false,
    volume: 1,
    heightPx: 44,
    collapsed: false,
    clips: [
      createClip({
        id: 'clip_sfx_whip',
        trackId: 'track_sfx_a2',
        type: 'audio',
        name: 'SFX_OpticalWhoosh_01.wav',
        mediaUrl: asset('media_whoosh_sfx').url,
        color: '#1f7d5c',
        startTimeMs: 5300,
        durationMs: 1500,
        sourceDurationMs: 1500,
      }),
    ],
  },
];
