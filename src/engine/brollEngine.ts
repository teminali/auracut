import { Track, Clip, MediaAsset } from '../types/edl';

export interface BrollSuggestion {
  id: string;
  keyword: string;
  reason: string;
  startTimeMs: number;
  durationMs: number;
  confidence: number;
  mediaAsset: MediaAsset;
  recommendedTransition: 'crossfade' | 'zoom_in' | 'whip_pan';
}

// Curated thematic B-roll repository
export const BROLL_CATALOG: MediaAsset[] = [
  {
    id: 'broll_kariakoo_store',
    name: 'B-Roll: Retail Store & Shelf Products.mp4',
    type: 'video',
    url: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1200&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=300&q=80',
    durationMs: 3500,
    fileSizeFormatted: '8.4 MB',
    codec: 'H.264 High Profile',
  },
  {
    id: 'broll_whatsapp_phone',
    name: 'B-Roll: Smartphone WhatsApp Messaging.mp4',
    type: 'video',
    url: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=1200&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&w=300&q=80',
    durationMs: 3000,
    fileSizeFormatted: '6.2 MB',
    codec: 'H.264 High Profile',
  },
  {
    id: 'broll_mobile_money',
    name: 'B-Roll: Digital Mobile Payments & Cash.mp4',
    type: 'video',
    url: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=300&q=80',
    durationMs: 3200,
    fileSizeFormatted: '7.8 MB',
    codec: 'H.264 High Profile',
  },
  {
    id: 'broll_cyber_ai',
    name: 'B-Roll: Futuristic AI Dashboard Glow.mp4',
    type: 'video',
    url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=300&q=80',
    durationMs: 4000,
    fileSizeFormatted: '11.1 MB',
    codec: 'H.264 High Profile',
  },
];

/**
 * Analyzes speech transcript / dialogue and suggests thematic B-roll insertions
 */
export function analyzeTranscriptForBroll(tracks: Track[]): BrollSuggestion[] {
  const suggestions: BrollSuggestion[] = [];

  // Find text/caption clips or audio transcripts
  const textTrack = tracks.find((t) => t.type === 'text');
  const clips = textTrack ? textTrack.clips : [];

  if (clips.length > 0) {
    clips.forEach((clip, index) => {
      const text = (clip.textStyle?.text || clip.name).toLowerCase();
      let matchedBroll = BROLL_CATALOG[index % BROLL_CATALOG.length];
      let reason = 'Thematic contextual overlay';

      if (text.includes('whatsapp') || text.includes('oda')) {
        matchedBroll = BROLL_CATALOG[1];
        reason = 'Matches WhatsApp messaging & order keyword';
      } else if (text.includes('duka') || text.includes('biashara') || text.includes('dukabot')) {
        matchedBroll = BROLL_CATALOG[0];
        reason = 'Matches local shop / retail commerce keyword';
      } else if (text.includes('pesa') || text.includes('sales') || text.includes('free')) {
        matchedBroll = BROLL_CATALOG[2];
        reason = 'Matches money / sales checkout keyword';
      } else {
        matchedBroll = BROLL_CATALOG[3];
        reason = 'Matches AI technology theme';
      }

      suggestions.push({
        id: `broll_sugg_${Date.now()}_${index}`,
        keyword: text.substring(0, 24),
        reason,
        startTimeMs: clip.startTimeMs,
        durationMs: Math.min(3500, clip.durationMs),
        confidence: 0.94 + (index % 5) * 0.01,
        mediaAsset: matchedBroll,
        recommendedTransition: index % 2 === 0 ? 'whip_pan' : 'crossfade',
      });
    });
  } else {
    // Default timeline placement suggestions
    suggestions.push(
      {
        id: `broll_sugg_1`,
        keyword: 'DukaBot AI Launch',
        reason: 'Hero commercial hook B-roll',
        startTimeMs: 1000,
        durationMs: 3500,
        confidence: 0.98,
        mediaAsset: BROLL_CATALOG[1],
        recommendedTransition: 'whip_pan',
      },
      {
        id: `broll_sugg_2`,
        keyword: 'Retail Store Operations',
        reason: 'Contextual retail shop floor cutaway',
        startTimeMs: 6500,
        durationMs: 3200,
        confidence: 0.95,
        mediaAsset: BROLL_CATALOG[0],
        recommendedTransition: 'crossfade',
      }
    );
  }

  return suggestions;
}
