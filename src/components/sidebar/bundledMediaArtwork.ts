/*
  Poster artwork for the media items that ship with the seed project.

  This deliberately keys by the stable bundled asset id rather than by
  filename. Imported files keep their own thumbnail, and clips keep the
  thumbnail of the media they actually render. Only the editor's library
  surface uses these design posters, matching the approved prototype
  without making the timeline or exported project visually untruthful.
*/
import neon from '../../assets/design-thumbnails/media-neon.jpg';
import jump from '../../assets/design-thumbnails/media-jump.jpg';
import store from '../../assets/design-thumbnails/media-store.jpg';
import mix from '../../assets/design-thumbnails/media-mix.jpg';
import sfx from '../../assets/design-thumbnails/media-sfx.jpg';
import mascot from '../../assets/design-thumbnails/media-mascot.jpg';

const ARTWORK: Record<string, string> = {
  media_cyber_city: neon,
  media_spiderman_jump: jump,
  media_duka_store: store,
  media_phonk_bgm: mix,
  media_whoosh_sfx: sfx,
  media_plushie_cutout: mascot,
};

export const bundledMediaArtwork = (id: string) => ARTWORK[id];
