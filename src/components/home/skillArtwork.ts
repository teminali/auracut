import beatMontageUrl from '../../assets/skill-thumbnails/beat-montage.webp';
import tutorialUrl from '../../assets/skill-thumbnails/tutorial.webp';

const ARTWORK: Record<string, string> = {
  'beat-montage': beatMontageUrl,
  tutorial: tutorialUrl,
};

export const skillArtwork = (id: string) => ARTWORK[id];
