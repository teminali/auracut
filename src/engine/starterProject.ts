/* ═══════════════════════════════════════════════════════════════════
   The bundled starter project — replaced by the Reverse Engineered
   Brand Logo Demo timeline.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Track, MediaAsset } from '../types/edl';

export const STARTER_ID = 'starter:sample-demo';
export const STARTER_NAME = 'Sample Demo (Reverse Engineered)';
export const STARTER_DURATION_MS = 11500;

const tracks: Track[] = [
  {
    "id": "track_0hnun943",
    "type": "video",
    "name": "Reconstructed Video",
    "index": 0,
    "muted": false,
    "locked": false,
    "clips": [
      {
        "id": "clip_wt7aa8hu",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_0.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_0.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_0.jpg', import.meta.url).href,
        "startTimeMs": 0,
        "durationMs": 2000,
        "sourceStartMs": 0,
        "sourceDurationMs": 2000,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_1jzmsj06",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_5bfu7k60",
                    "propertyPath": "transform.x",
                    "timeMs": 2000,
                    "value": 369,
                    "easing": "linear"
          },
          {
                    "id": "kf_mzhe2b9r",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_mpq23t93",
                    "propertyPath": "transform.y",
                    "timeMs": 2000,
                    "value": -386,
                    "easing": "linear"
          },
          {
                    "id": "kf_bc96aey1",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_w58pelre",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 2000,
                    "value": 1.5939999999999999,
                    "easing": "linear"
          },
          {
                    "id": "kf_k32oqsdj",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_14a2y9xn",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 2000,
                    "value": 1.5939999999999999,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_k4n3c4dm",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_1.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_1.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_1.jpg', import.meta.url).href,
        "startTimeMs": 2000,
        "durationMs": 1000,
        "sourceStartMs": 0,
        "sourceDurationMs": 1000,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_q9npxevh",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_o70vmg0t",
                    "propertyPath": "transform.x",
                    "timeMs": 1000,
                    "value": 9,
                    "easing": "linear"
          },
          {
                    "id": "kf_uhedvao7",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_tp363fws",
                    "propertyPath": "transform.y",
                    "timeMs": 1000,
                    "value": -29,
                    "easing": "linear"
          },
          {
                    "id": "kf_5xw6jij3",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_42b5tiox",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 1000,
                    "value": 1.026,
                    "easing": "linear"
          },
          {
                    "id": "kf_z7v1ngdu",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_2f54qkab",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 1000,
                    "value": 1.026,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_dph469ww",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_2.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_2.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_2.jpg', import.meta.url).href,
        "startTimeMs": 3000,
        "durationMs": 1000,
        "sourceStartMs": 0,
        "sourceDurationMs": 1000,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": []
      },
      {
        "id": "clip_l4wbh9cz",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_3.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_3.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_3.jpg', import.meta.url).href,
        "startTimeMs": 4000,
        "durationMs": 533,
        "sourceStartMs": 0,
        "sourceDurationMs": 533,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_hoepsdxr",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_ji8b6hx3",
                    "propertyPath": "transform.x",
                    "timeMs": 533,
                    "value": -3,
                    "easing": "linear"
          },
          {
                    "id": "kf_xesu635v",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_1h73vms5",
                    "propertyPath": "transform.y",
                    "timeMs": 533,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_wmc1enr8",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_3ysevc54",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 533,
                    "value": 1.0045305,
                    "easing": "linear"
          },
          {
                    "id": "kf_xyy3rgl1",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_9qxyo6fk",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 533,
                    "value": 1.0045305,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_p2r16i3b",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_4.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_4.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_4.jpg', import.meta.url).href,
        "startTimeMs": 4533,
        "durationMs": 467,
        "sourceStartMs": 0,
        "sourceDurationMs": 467,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_vq68oobq",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_xgwutl78",
                    "propertyPath": "transform.x",
                    "timeMs": 467,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_0ll2yif7",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_irt4qjeq",
                    "propertyPath": "transform.y",
                    "timeMs": 467,
                    "value": 12,
                    "easing": "linear"
          },
          {
                    "id": "kf_mzijtyg4",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_cjzzchgf",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 467,
                    "value": 1.0097136,
                    "easing": "linear"
          },
          {
                    "id": "kf_5whu3v4j",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_u0k4oxwc",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 467,
                    "value": 1.0097136,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_r0j9ft5z",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_5.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_5.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_5.jpg', import.meta.url).href,
        "startTimeMs": 5000,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_ergs6aov",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_9l42efh0",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": 2,
                    "easing": "linear"
          },
          {
                    "id": "kf_lqvypvy9",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_56wt935e",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_8a85kbqi",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_gprmmhgp",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.006,
                    "easing": "linear"
          },
          {
                    "id": "kf_m64x6jcs",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_l6qvua6k",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.006,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_at69vjhl",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_6.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_6.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_6.jpg', import.meta.url).href,
        "startTimeMs": 5500,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_1611ymk7",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_glmtpu99",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": -668,
                    "easing": "linear"
          },
          {
                    "id": "kf_10nhuhm5",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_1acb16pz",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": -943,
                    "easing": "linear"
          },
          {
                    "id": "kf_6690wa55",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_tl7s6zx3",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 2.1849,
                    "easing": "linear"
          },
          {
                    "id": "kf_ul8axw7r",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_3ntd3d9q",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 2.1849,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_kgyqo2vc",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_7.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_7.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_7.jpg', import.meta.url).href,
        "startTimeMs": 6000,
        "durationMs": 100,
        "sourceStartMs": 0,
        "sourceDurationMs": 100,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": []
      },
      {
        "id": "clip_i9ingplr",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_8.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_8.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_8.jpg', import.meta.url).href,
        "startTimeMs": 6100,
        "durationMs": 67,
        "sourceStartMs": 0,
        "sourceDurationMs": 67,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": []
      },
      {
        "id": "clip_6e6lwrro",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_9.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_9.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_9.jpg', import.meta.url).href,
        "startTimeMs": 6167,
        "durationMs": 333,
        "sourceStartMs": 0,
        "sourceDurationMs": 333,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_t6hs7jn3",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_0wbu0euu",
                    "propertyPath": "transform.x",
                    "timeMs": 333,
                    "value": -2,
                    "easing": "linear"
          },
          {
                    "id": "kf_3er8nfj9",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_8xike82f",
                    "propertyPath": "transform.y",
                    "timeMs": 333,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_bdbfdmby",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_trngfnxb",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 333,
                    "value": 1.002331,
                    "easing": "linear"
          },
          {
                    "id": "kf_v1ews0ej",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_r57d2e6g",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 333,
                    "value": 1.002331,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_a9zjk4di",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_10.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_10.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_10.jpg', import.meta.url).href,
        "startTimeMs": 6500,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_911v3pu2",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_hx3jrwip",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": -109,
                    "easing": "linear"
          },
          {
                    "id": "kf_u0g6lusd",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_6e3oc8q4",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": 106,
                    "easing": "linear"
          },
          {
                    "id": "kf_ql4naxzv",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_o4px0dva",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.1724999999999999,
                    "easing": "linear"
          },
          {
                    "id": "kf_r3jpr3wm",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_86bpskdj",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.1724999999999999,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_m4zpj9ix",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_11.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_11.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_11.jpg', import.meta.url).href,
        "startTimeMs": 7000,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_bfnikd02",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_94bfcryt",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": 6,
                    "easing": "linear"
          },
          {
                    "id": "kf_0epqoz8q",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_c5qucmia",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": -30,
                    "easing": "linear"
          },
          {
                    "id": "kf_5y058eep",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_27ixp4yh",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.0248,
                    "easing": "linear"
          },
          {
                    "id": "kf_rqa76ys4",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_mu32n5ic",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.0248,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_rcrf9d51",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_12.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_12.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_12.jpg', import.meta.url).href,
        "startTimeMs": 7500,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": []
      },
      {
        "id": "clip_jh1ohq8i",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_13.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_13.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_13.jpg', import.meta.url).href,
        "startTimeMs": 8000,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_x7b0r7o8",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_juvcoaov",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": 15,
                    "easing": "linear"
          },
          {
                    "id": "kf_b7zdjy50",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_werj458k",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": -19,
                    "easing": "linear"
          },
          {
                    "id": "kf_sxq0rdhh",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_9qznvjvw",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.0254,
                    "easing": "linear"
          },
          {
                    "id": "kf_t0d7nbpe",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_2va8omon",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.0254,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_u8q4dtxe",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_14.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_14.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_14.jpg', import.meta.url).href,
        "startTimeMs": 8500,
        "durationMs": 133,
        "sourceStartMs": 0,
        "sourceDurationMs": 133,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_eco12c9p",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_vqws8dvy",
                    "propertyPath": "transform.x",
                    "timeMs": 133,
                    "value": 15,
                    "easing": "linear"
          },
          {
                    "id": "kf_esct4csl",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_rkq68xw7",
                    "propertyPath": "transform.y",
                    "timeMs": 133,
                    "value": 120,
                    "easing": "linear"
          },
          {
                    "id": "kf_vd4q6ppc",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_cfvrc0zw",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 133,
                    "value": 1.0957866,
                    "easing": "linear"
          },
          {
                    "id": "kf_pb56wb04",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_cza8fwz4",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 133,
                    "value": 1.0957866,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_qjaosyhx",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_15.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_15.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_15.jpg', import.meta.url).href,
        "startTimeMs": 8633,
        "durationMs": 367,
        "sourceStartMs": 0,
        "sourceDurationMs": 367,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_mx5ga0qg",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_447k4ldp",
                    "propertyPath": "transform.x",
                    "timeMs": 367,
                    "value": 29,
                    "easing": "linear"
          },
          {
                    "id": "kf_c24us6os",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_7cghrwmv",
                    "propertyPath": "transform.y",
                    "timeMs": 367,
                    "value": 46,
                    "easing": "linear"
          },
          {
                    "id": "kf_5117oack",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_pun5zpk3",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 367,
                    "value": 1.0544628,
                    "easing": "linear"
          },
          {
                    "id": "kf_3t89arg8",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_xm0nm53n",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 367,
                    "value": 1.0544628,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_5i9e1ftj",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_16.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_16.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_16.jpg', import.meta.url).href,
        "startTimeMs": 9000,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_tn0on8x9",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_q6o08te9",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_xas83fuk",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_iwrh991q",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": 14,
                    "easing": "linear"
          },
          {
                    "id": "kf_ljt2f3bm",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_0bzjvuy5",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.0137,
                    "easing": "linear"
          },
          {
                    "id": "kf_0oqru8g4",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_v6friq94",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.0137,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_jaxr9t1b",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_17.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_17.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_17.jpg', import.meta.url).href,
        "startTimeMs": 9500,
        "durationMs": 500,
        "sourceStartMs": 0,
        "sourceDurationMs": 500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_o57nq5nl",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_71o3j0bl",
                    "propertyPath": "transform.x",
                    "timeMs": 500,
                    "value": -15,
                    "easing": "linear"
          },
          {
                    "id": "kf_i2le6ymu",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_9vzrklaj",
                    "propertyPath": "transform.y",
                    "timeMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_2d43z086",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_7zc7wfwd",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 500,
                    "value": 1.0212,
                    "easing": "linear"
          },
          {
                    "id": "kf_cfw67b0h",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_2h8yle0l",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 500,
                    "value": 1.0212,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_ku4zj6sb",
        "trackId": "track_0hnun943",
        "type": "image",
        "name": "shot_18.jpg",
        "mediaUrl": new URL('../assets/brand_shots/shot_18.jpg', import.meta.url).href,
        "thumbnailUrl": new URL('../assets/brand_shots/shot_18.jpg', import.meta.url).href,
        "startTimeMs": 10000,
        "durationMs": 1500,
        "sourceStartMs": 0,
        "sourceDurationMs": 1500,
        "fitMode": "cover",
        "blendMode": "normal",
        "locked": false,
        "hidden": false,
        "transform": {
          "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1,
          "anchorX": 0.5, "anchorY": 0.5, "flipH": false, "flipV": false
        },
        "keyframes": [
          {
                    "id": "kf_vhnqhdit",
                    "propertyPath": "transform.x",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_ufda13bu",
                    "propertyPath": "transform.x",
                    "timeMs": 1500,
                    "value": 18,
                    "easing": "linear"
          },
          {
                    "id": "kf_vm3sdpen",
                    "propertyPath": "transform.y",
                    "timeMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_yqy67k1g",
                    "propertyPath": "transform.y",
                    "timeMs": 1500,
                    "value": -24,
                    "easing": "linear"
          },
          {
                    "id": "kf_e4083tx0",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_ssnfrywe",
                    "propertyPath": "transform.scaleX",
                    "timeMs": 1500,
                    "value": 1.03165,
                    "easing": "linear"
          },
          {
                    "id": "kf_vaf3mh3n",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_4adx9bxu",
                    "propertyPath": "transform.scaleY",
                    "timeMs": 1500,
                    "value": 1.03165,
                    "easing": "linear"
          }
]
      }
    ]
  }
];

const mediaPool: MediaAsset[] = [
  {
    "id": "media_shot_0",
    "name": "shot_0.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_0.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_0.jpg', import.meta.url).href,
    "durationMs": 2000,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_1",
    "name": "shot_1.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_1.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_1.jpg', import.meta.url).href,
    "durationMs": 1000,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_2",
    "name": "shot_2.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_2.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_2.jpg', import.meta.url).href,
    "durationMs": 1000,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_3",
    "name": "shot_3.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_3.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_3.jpg', import.meta.url).href,
    "durationMs": 533,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_4",
    "name": "shot_4.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_4.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_4.jpg', import.meta.url).href,
    "durationMs": 467,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_5",
    "name": "shot_5.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_5.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_5.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_6",
    "name": "shot_6.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_6.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_6.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_7",
    "name": "shot_7.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_7.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_7.jpg', import.meta.url).href,
    "durationMs": 100,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_8",
    "name": "shot_8.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_8.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_8.jpg', import.meta.url).href,
    "durationMs": 67,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_9",
    "name": "shot_9.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_9.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_9.jpg', import.meta.url).href,
    "durationMs": 333,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_10",
    "name": "shot_10.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_10.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_10.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_11",
    "name": "shot_11.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_11.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_11.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_12",
    "name": "shot_12.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_12.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_12.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_13",
    "name": "shot_13.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_13.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_13.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_14",
    "name": "shot_14.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_14.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_14.jpg', import.meta.url).href,
    "durationMs": 133,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_15",
    "name": "shot_15.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_15.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_15.jpg', import.meta.url).href,
    "durationMs": 367,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_16",
    "name": "shot_16.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_16.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_16.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_17",
    "name": "shot_17.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_17.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_17.jpg', import.meta.url).href,
    "durationMs": 500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  },
  {
    "id": "media_shot_18",
    "name": "shot_18.jpg",
    "type": "image",
    "url": new URL('../assets/brand_shots/shot_18.jpg', import.meta.url).href,
    "thumbnailUrl": new URL('../assets/brand_shots/shot_18.jpg', import.meta.url).href,
    "durationMs": 1500,
    "width": 720,
    "height": 1280,
    "fileSizeFormatted": "100 KB",
    "codec": "JPEG"
  }
];

export function buildStarterProject(): void {
  const project = useProjectStore.getState();

  project.setProjectName(STARTER_NAME);
  project.setAspectRatio('9:16');
  project.setFps(30);
  project.setBackgroundColor('#000000');
  project.setDurationMs(STARTER_DURATION_MS);

  // Load the project from the reverse engineered JSON
  const store = useTimelineStore.getState();
  store.loadProject(tracks, mediaPool);
  store.commit('Open starter project');
}
