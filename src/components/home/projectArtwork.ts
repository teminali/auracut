import brandFilmPoster from '../../assets/design-thumbnails/home-brand-film.jpg';
import type { RecentProject } from '../../store/recentsStore';

/**
 * A saved frame is always the truth and always wins. The bundled starter
 * has no saved frame on first launch, so its approved design poster fills
 * that one known gap instead of showing an empty-state tile as content.
 */
export const projectArtwork = (project: RecentProject): string | undefined =>
  project.posterUrl ?? (project.starter === 'kerf-brand-film' ? brandFilmPoster : undefined);
