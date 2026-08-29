import beatMontageUrl from '../../assets/design-thumbnails/skill-beat.jpg';
import tutorialUrl from '../../assets/design-thumbnails/skill-tutorial.jpg';

const ARTWORK: Record<string, string> = {
  'beat-montage': beatMontageUrl,
  tutorial: tutorialUrl,
};

export const skillArtwork = (id: string) => ARTWORK[id];
