import type { EditFormat } from "./editFormats";

/** Reviewed references are explicit leads, never fabricated output from the automatic scanner. */
export const REVIEWED_FORMAT_SEEDS: EditFormat[] = [
  {
    key: "trip-baby-repeating-figures",
    name: {
      en: "TRIP BABY — repeating figures",
      ar: "TRIP BABY — تكرار الشخص في اللقطة",
    },
    visualPattern: {
      en: "Repeated cutout figures layered across cinematic shots",
      ar: "نسخ مقصوصة من الشخص تتكرر فوق لقطات سينمائية",
    },
    audio: {
      title: "DON'T BE DUMB / TRIP BABY",
      artist: "A$AP Rocky",
      url: "https://www.instagram.com/reels/audio/1233965565529898/",
    },
    firstSeen: "2026-10-07T19:51:01.000Z",
    lastChecked: "2026-10-07T19:51:01.000Z",
    source: "reviewed-reference",
    reviewNote: {
      en: "You spotted this in your feed. Repeated figures were seen during partial playback, and Instagram confirmed the audio. Its audio page showed 9.6K Reels on 7 Oct; that counts all uses of the sound, not matching edits or recent growth.",
      ar: "لاحظته في خلاصتك. شفنا تكرار الشخص في جزء من المقطع وتأكدنا من الصوت في إنستغرام. صفحة الصوت عرضت 9.6 آلاف ريل يوم 7 أكتوبر؛ العدد لكل استخدامات الصوت، مو للإيديت نفسه ولا لقياس نموه مؤخرًا.",
    },
    evidence: {
      state: "candidate",
      creators7d: 0,
      posts7d: 0,
      scope: "reviewed-references",
    },
    samples: [
      {
        url: "https://www.instagram.com/reel/DdP6LgrT_aD/",
        title: "Feeling out place lately — jayp.zip",
        platform: "ig",
        handle: "jayp.zip",
        observedAt: "2026-10-07T19:51:01.000Z",
        basis: "partial-playback",
      },
    ],
  },
];
