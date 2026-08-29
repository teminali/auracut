/* ═══════════════════════════════════════════════════════════════════
   The bundled starter project — replaced by the Reverse Engineered
   Brand Logo Demo timeline.
   ═══════════════════════════════════════════════════════════════════ */

import { useTimelineStore } from '../store/timelineStore';
import { useProjectStore } from '../store/projectStore';
import { Track, MediaAsset, createClip } from '../types/edl';

export const STARTER_ID = 'starter:sample-demo';
export const STARTER_NAME = 'Sample Demo (Reverse Engineered)';
export const STARTER_DURATION_MS = 11500;

const rawClips = [
      {
        "id": "clip_nx6bnq07",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_derduzpo",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_amztxhtw",
                    "property": "positionX",
                    "timeOffsetMs": 2000,
                    "value": 369,
                    "easing": "linear"
          },
          {
                    "id": "kf_jnr6bix4",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_fhz5z37o",
                    "property": "positionY",
                    "timeOffsetMs": 2000,
                    "value": -386,
                    "easing": "linear"
          },
          {
                    "id": "kf_r414qvfr",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_65nqmtw6",
                    "property": "scaleX",
                    "timeOffsetMs": 2000,
                    "value": 1.5939999999999999,
                    "easing": "linear"
          },
          {
                    "id": "kf_vvupjjn5",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_712drp8x",
                    "property": "scaleY",
                    "timeOffsetMs": 2000,
                    "value": 1.5939999999999999,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_4k9pjcxy",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_pyn31li7",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_j5usixjd",
                    "property": "positionX",
                    "timeOffsetMs": 1000,
                    "value": 9,
                    "easing": "linear"
          },
          {
                    "id": "kf_1hk2gazs",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_o48vxak9",
                    "property": "positionY",
                    "timeOffsetMs": 1000,
                    "value": -29,
                    "easing": "linear"
          },
          {
                    "id": "kf_ix48zlgm",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_dnwqxht7",
                    "property": "scaleX",
                    "timeOffsetMs": 1000,
                    "value": 1.026,
                    "easing": "linear"
          },
          {
                    "id": "kf_21xe2kci",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_awxon1ov",
                    "property": "scaleY",
                    "timeOffsetMs": 1000,
                    "value": 1.026,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_o2wqr7dn",
        "trackId": "track_lm9jbvir",
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
        "id": "clip_cumet2xv",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_bjhcv7bl",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_34xzdq56",
                    "property": "positionX",
                    "timeOffsetMs": 533,
                    "value": -3,
                    "easing": "linear"
          },
          {
                    "id": "kf_lzudjhcr",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_sxppuxg9",
                    "property": "positionY",
                    "timeOffsetMs": 533,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_3mtp0uss",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_rofu12yk",
                    "property": "scaleX",
                    "timeOffsetMs": 533,
                    "value": 1.0045305,
                    "easing": "linear"
          },
          {
                    "id": "kf_qib0jvxp",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_zhishaed",
                    "property": "scaleY",
                    "timeOffsetMs": 533,
                    "value": 1.0045305,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_pczak47o",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_6mejpw80",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_js979oak",
                    "property": "positionX",
                    "timeOffsetMs": 467,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_alcggk5x",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_e1zxm0xf",
                    "property": "positionY",
                    "timeOffsetMs": 467,
                    "value": 12,
                    "easing": "linear"
          },
          {
                    "id": "kf_hkriph0v",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_1fsojtxe",
                    "property": "scaleX",
                    "timeOffsetMs": 467,
                    "value": 1.0097136,
                    "easing": "linear"
          },
          {
                    "id": "kf_uzvl8wut",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_njxaiuxg",
                    "property": "scaleY",
                    "timeOffsetMs": 467,
                    "value": 1.0097136,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_hwtcsfmv",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_uarpf0q5",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_6ucrayey",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": 2,
                    "easing": "linear"
          },
          {
                    "id": "kf_0si7mpf2",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_p04wz4ne",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_ssaqt6po",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_56gk597o",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.006,
                    "easing": "linear"
          },
          {
                    "id": "kf_fxa6wjc2",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_u394c7r1",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.006,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_lc6hxh2g",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_51s6megm",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_uw1y2srj",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": -668,
                    "easing": "linear"
          },
          {
                    "id": "kf_6cjayz0w",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_rd3vebvu",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": -943,
                    "easing": "linear"
          },
          {
                    "id": "kf_ezedldd8",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_57rir6md",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 2.1849,
                    "easing": "linear"
          },
          {
                    "id": "kf_qifqxh50",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_dodgve7j",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 2.1849,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_wwsdo8sk",
        "trackId": "track_lm9jbvir",
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
        "id": "clip_93n7vzeb",
        "trackId": "track_lm9jbvir",
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
        "id": "clip_sd4ylhjj",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_ol7us0w1",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_bliggmmt",
                    "property": "positionX",
                    "timeOffsetMs": 333,
                    "value": -2,
                    "easing": "linear"
          },
          {
                    "id": "kf_ynb8oxy8",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_y8hdm7yw",
                    "property": "positionY",
                    "timeOffsetMs": 333,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_2j5q9c7e",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_386dnez9",
                    "property": "scaleX",
                    "timeOffsetMs": 333,
                    "value": 1.002331,
                    "easing": "linear"
          },
          {
                    "id": "kf_p5dcsmkp",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_9p5lmyfq",
                    "property": "scaleY",
                    "timeOffsetMs": 333,
                    "value": 1.002331,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_th714b4l",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_rq0h2p0j",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_poa075qq",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": -109,
                    "easing": "linear"
          },
          {
                    "id": "kf_cmvsc0zg",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_831w5dou",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": 106,
                    "easing": "linear"
          },
          {
                    "id": "kf_e4hu6eeb",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_vrlxi12u",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.1724999999999999,
                    "easing": "linear"
          },
          {
                    "id": "kf_m0am8snv",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_col0q541",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.1724999999999999,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_i0jiuy14",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_27mttw5m",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_0uhyxapz",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": 6,
                    "easing": "linear"
          },
          {
                    "id": "kf_7d2qesvg",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_q5fsjbw9",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": -30,
                    "easing": "linear"
          },
          {
                    "id": "kf_5881sy48",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_bx0v1mat",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.0248,
                    "easing": "linear"
          },
          {
                    "id": "kf_sy071s2f",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_g7q6uh4m",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.0248,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_np1q7au7",
        "trackId": "track_lm9jbvir",
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
        "id": "clip_af3983wd",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_5j3kmoad",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_sxo1frpr",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": 15,
                    "easing": "linear"
          },
          {
                    "id": "kf_ulx4cktf",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_37qyf75b",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": -19,
                    "easing": "linear"
          },
          {
                    "id": "kf_k87xnade",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_jy5tsh9q",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.0254,
                    "easing": "linear"
          },
          {
                    "id": "kf_x0y23p9g",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_jzi9gnks",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.0254,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_zz6v9oex",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_z50hnkzo",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_g6xbbv9r",
                    "property": "positionX",
                    "timeOffsetMs": 133,
                    "value": 15,
                    "easing": "linear"
          },
          {
                    "id": "kf_zf5a7yif",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_fktfqutv",
                    "property": "positionY",
                    "timeOffsetMs": 133,
                    "value": 120,
                    "easing": "linear"
          },
          {
                    "id": "kf_c1vfktxr",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_i4c4mu98",
                    "property": "scaleX",
                    "timeOffsetMs": 133,
                    "value": 1.0957866,
                    "easing": "linear"
          },
          {
                    "id": "kf_z2oc4lqm",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_pqzydelp",
                    "property": "scaleY",
                    "timeOffsetMs": 133,
                    "value": 1.0957866,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_sbbhkha2",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_8leyhoh2",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_5s8y0g09",
                    "property": "positionX",
                    "timeOffsetMs": 367,
                    "value": 29,
                    "easing": "linear"
          },
          {
                    "id": "kf_8ez8c2mb",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_njgunom5",
                    "property": "positionY",
                    "timeOffsetMs": 367,
                    "value": 46,
                    "easing": "linear"
          },
          {
                    "id": "kf_bf0dqr5z",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_cvg5d9nz",
                    "property": "scaleX",
                    "timeOffsetMs": 367,
                    "value": 1.0544628,
                    "easing": "linear"
          },
          {
                    "id": "kf_t79q4f2o",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_lv0r5jud",
                    "property": "scaleY",
                    "timeOffsetMs": 367,
                    "value": 1.0544628,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_8xm0s2ai",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_3rhn8ece",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_wvtpnft2",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_i8zaey3v",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_gp4r44l6",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": 14,
                    "easing": "linear"
          },
          {
                    "id": "kf_4z44urd8",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_zu7uage4",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.0137,
                    "easing": "linear"
          },
          {
                    "id": "kf_v3il0zs4",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_i52o4zcp",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.0137,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_79sux120",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_vedozblm",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_o0sa9s52",
                    "property": "positionX",
                    "timeOffsetMs": 500,
                    "value": -15,
                    "easing": "linear"
          },
          {
                    "id": "kf_43j743s7",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_bbz94lzx",
                    "property": "positionY",
                    "timeOffsetMs": 500,
                    "value": -6,
                    "easing": "linear"
          },
          {
                    "id": "kf_zckl80qv",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_8gixf6mf",
                    "property": "scaleX",
                    "timeOffsetMs": 500,
                    "value": 1.0212,
                    "easing": "linear"
          },
          {
                    "id": "kf_fb0ngik5",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_fapf3mws",
                    "property": "scaleY",
                    "timeOffsetMs": 500,
                    "value": 1.0212,
                    "easing": "linear"
          }
]
      },
      {
        "id": "clip_3ajyt50m",
        "trackId": "track_lm9jbvir",
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
                    "id": "kf_7kaytnmm",
                    "property": "positionX",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_6ccjf1hg",
                    "property": "positionX",
                    "timeOffsetMs": 1500,
                    "value": 18,
                    "easing": "linear"
          },
          {
                    "id": "kf_1159b5n8",
                    "property": "positionY",
                    "timeOffsetMs": 0,
                    "value": 0,
                    "easing": "linear"
          },
          {
                    "id": "kf_ng5pe7s0",
                    "property": "positionY",
                    "timeOffsetMs": 1500,
                    "value": -24,
                    "easing": "linear"
          },
          {
                    "id": "kf_12f78squ",
                    "property": "scaleX",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_l0l19kzb",
                    "property": "scaleX",
                    "timeOffsetMs": 1500,
                    "value": 1.03165,
                    "easing": "linear"
          },
          {
                    "id": "kf_8aycenvx",
                    "property": "scaleY",
                    "timeOffsetMs": 0,
                    "value": 1,
                    "easing": "linear"
          },
          {
                    "id": "kf_wkitkbp1",
                    "property": "scaleY",
                    "timeOffsetMs": 1500,
                    "value": 1.03165,
                    "easing": "linear"
          }
]
      }
];

const tracks: Track[] = [
  {
    "id": "track_41c0stok",
    "type": "video",
    "name": "Reconstructed Video",
    "index": 0,
    "muted": false,
    "locked": false,
    "solo": false,
    "volume": 1,
    "heightPx": 80,
    "collapsed": false,
    "clips": rawClips.map((c: any) => createClip(c))
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
  useTimelineStore.setState({ mediaPool: mediaPool });
  const store = useTimelineStore.getState();
  store.loadProject(tracks, []);
  store.commit('Open starter project');
}
