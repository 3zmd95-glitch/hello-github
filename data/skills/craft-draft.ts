import type { LText, Skill } from "@/lib/domain";

/**
 * Phone-first craft draft pack (Camera on iPhone, Lighting, Composition).
 * Written by hand as placeholders until Skill Scout replaces them with sourced cards (Sprint 4.3).
 * source = "draft" and no refs on purpose: nothing here is taken from real search results.
 */

const t = (ar: string, en: string): LText => ({ ar, en });

export const craftDraftSkills: Skill[] = [
  {
    id: "iphone-lock-exposure-wb",
    programId: "camera",
    sectionId: "phone-videography",
    name: t("قفل التعريض وتوازن الأبيض في الآيفون", "Lock exposure and white balance on iPhone"),
    tier: 1,
    gear: "phone",
    studio: false,
    source: "draft",
    what: t(
      "الآيفون يغيّر الإضاءة والألوان لحاله وانت تصوّر، فاللقطة تفلّش وتتلون. لو قفلتها، الصورة تثبت من أول اللقطة لآخرها.",
      "The iPhone keeps changing brightness and color while you record, so shots pump and shift. Locking them keeps the image stable from start to end.",
    ),
    steps: [
      t(
        "في كاميرا الآيفون اضغط مطوّل على الموضوع لحد ما يطلع AE/AF LOCK.",
        "In the iPhone Camera app, press and hold on the subject until AE/AF LOCK appears.",
      ),
      t(
        "اسحب الشمس الصغيرة لتحت أو فوق عشان تضبط الإضاءة، وخلّي السما ما تحترق.",
        "Drag the small sun icon down or up to set exposure so the sky does not clip.",
      ),
      t(
        "لتوازن الأبيض: نزّل تطبيق Blackmagic Camera المجاني واختار WB ثابت (مثلا 5600K برا).",
        "For white balance: use the free Blackmagic Camera app and set a fixed WB (e.g. 5600K outdoors).",
      ),
      t(
        "صوّر لقطة وانت تتحرك من الشمس للظل، وشيّك إن الألوان ما تتغيّر.",
        "Record a shot moving from sun to shade and check the colors stay put.",
      ),
    ],
    quests: {
      train: t(
        "صوّر نفس اللقطة مرتين (من الشمس للظل): مرة أوتو ومرة مقفولة. ارفع الاثنين كإثبات.",
        "Shoot the same sun-to-shade move twice: once auto, once locked. Upload both as proof.",
      ),
      research: t(
        "اكتب في Obsidian: إيش الفرق بين AE و AF و WB، ومتى تقفل كل واحد.",
        "Write an Obsidian note: AE vs AF vs WB, and when to lock each one.",
      ),
      produce: t(
        "ريل ١٥ ثانية: قبل/بعد، أوتو يرقص ضد مقفول ثابت.",
        "15 s reel: before/after, dancing auto exposure vs a locked shot.",
      ),
      article: t(
        'مقال: "ليه فيديو الآيفون حقك يفلّش؟ وكيف تقفله في ثانيتين".',
        'Article: "Why your iPhone video flickers, and how to lock it in two seconds".',
      ),
    },
    refs: [],
  },
  {
    id: "iphone-log-prores",
    programId: "camera",
    sectionId: "picture-profiles",
    name: t("التصوير بـ Log و ProRes في الآيفون وليه", "Shoot Log/ProRes on iPhone and why"),
    tier: 2,
    gear: "phone",
    studio: false,
    source: "draft",
    what: t(
      "الـ Log يحفظ تفاصيل أكتر في الإضاءة والظل، والصورة تطلع باهتة عشان تلوّنها بعدين. الـ ProRes ملف أتقل بس يستحمل التلوين أكتر.",
      "Log keeps more highlight and shadow detail and looks flat so you can grade it later. ProRes files are heavier but hold up better in the grade.",
    ),
    steps: [
      t(
        "شيّك إن جوالك يدعم Apple Log (آيفون 15 Pro وأحدث) من Settings > Camera > Formats.",
        "Check your phone supports Apple Log (iPhone 15 Pro or newer) in Settings > Camera > Formats.",
      ),
      t(
        "شغّل ProRes واختار Log، وانتبه للمساحة: دقيقة 4K تاكل جيجات.",
        "Turn on ProRes and choose Log; watch storage, a minute of 4K eats gigabytes.",
      ),
      t(
        "صوّر بتعريض أفتح شوية من العادي، الـ Log يحب الضوء.",
        "Expose a little brighter than usual; Log likes light.",
      ),
      t(
        "في دافنشي حط CST أو LUT من Apple Log لـ Rec.709 وشوف الفرق.",
        "In DaVinci, apply a CST or LUT from Apple Log to Rec.709 and compare.",
      ),
    ],
    quests: {
      train: t(
        "صوّر نفس المنظر (غروب أو شباك) مرة عادي ومرة Log. ارفع اللقطتين.",
        "Shoot the same scene (sunset or window) once normal, once Log. Upload both.",
      ),
      research: t(
        "نوت في Obsidian: إيش هو الـ Log، وإيش الـ ProRes، ومتى ما تستاهل.",
        "Obsidian note: what Log is, what ProRes is, and when they are not worth it.",
      ),
      produce: t(
        "ريل ٢٠ ثانية: اللقطة الباهتة ← بعد التلوين في دافنشي.",
        "20 s reel: the flat Log shot → after the DaVinci grade.",
      ),
      article: t(
        'مقال: "Apple Log للمبتدئين: متى تشغّله ومتى لا".',
        'Article: "Apple Log for beginners: when to turn it on and when not to".',
      ),
    },
    refs: [],
  },
  {
    id: "handheld-no-gimbal",
    programId: "camera",
    sectionId: "stabilization",
    name: t("لقطات ثابتة باليد بدون جيمبل", "Steady handheld without a gimbal"),
    tier: 1,
    gear: "phone",
    studio: false,
    source: "draft",
    what: t(
      "ما تحتاج جيمبل عشان تطلع لقطة ناعمة. طريقة المسكة والمشي والعدسة الواسعة تفرق كتير.",
      "You do not need a gimbal for smooth shots. Grip, walk and a wide lens make a big difference.",
    ),
    steps: [
      t(
        "امسك الجوال بيدينك وقرّب كوعك من جسمك.",
        "Hold the phone with both hands and tuck your elbows in.",
      ),
      t(
        "امشي مشية النينجا: ركب مثنية وخطوات من الكعب للأصابع.",
        "Walk the ninja walk: bent knees, heel-to-toe steps.",
      ),
      t(
        "استخدم العدسة الـ 0.5x أو 1x، الزووم يكبّر الرجفة.",
        "Use the 0.5x or 1x lens; zoom magnifies shake.",
      ),
      t(
        "شغّل Action mode لو المشهد فيه ضوء كفاية.",
        "Turn on Action mode when there is enough light.",
      ),
    ],
    quests: {
      train: t(
        "امشي نفس الطريق ١٠ ثواني ثلاث مرات: عادي، نينجا، نينجا + Action mode. ارفع الثلاث.",
        "Walk the same 10 s path three times: normal, ninja walk, ninja + Action mode. Upload all three.",
      ),
      research: t(
        "نوت في Obsidian: ٥ حيل ثبات بدون عدة، وأي وحدة نفعت معك.",
        "Obsidian note: 5 no-gear stabilization tricks and which one worked for you.",
      ),
      produce: t(
        "ريل ١٥ ثانية: لقطة مشي ناعمة في الحارة أو المول.",
        "15 s reel: one smooth walking shot in your street or a mall.",
      ),
      article: t(
        'مقال: "ثبّت فيديو جوالك بدون ما تشتري جيمبل".',
        'Article: "Stabilize your phone video without buying a gimbal".',
      ),
    },
    refs: [],
  },
  {
    id: "phone-180-shutter",
    programId: "camera",
    sectionId: "shutter-angle",
    name: t(
      "قاعدة الـ ١٨٠° في الجوال (الفريمات + فلتر ND)",
      "The 180° shutter rule on a phone (frame rate + ND)",
    ),
    tier: 2,
    gear: "phone",
    studio: false,
    source: "draft",
    what: t(
      "الحركة تطلع سينمائية لما سرعة الغالق ضعف الفريمات: 25fps ← 1/50. في الشمس الجوال يرفع السرعة، فتحتاج فلتر ND.",
      "Motion looks cinematic when shutter speed is double the frame rate: 25fps → 1/50. In sun the phone raises the shutter, so you need an ND filter.",
    ),
    steps: [
      t(
        "افتح Blackmagic Camera واختار 25 أو 30 فريم.",
        "Open Blackmagic Camera and choose 25 or 30 fps.",
      ),
      t(
        "حط الغالق على 1/50 (أو 1/60 لـ 30fps) أو اختار Shutter angle 180°.",
        "Set shutter to 1/50 (or 1/60 for 30fps), or pick a 180° shutter angle.",
      ),
      t(
        "لو الصورة محروقة برا، ركّب فلتر ND على العدسة لحد ما التعريض يرجع طبيعي.",
        "If the image clips outdoors, clip an ND filter on the lens until exposure is back.",
      ),
      t(
        "صوّر حاجة تتحرك (يد، سيارة، موية) وشوف الـ motion blur.",
        "Film something moving (hands, cars, water) and look at the motion blur.",
      ),
    ],
    quests: {
      train: t(
        "صوّر نفس الحركة بـ 1/50 و 1/500 و 1/2000. ارفع الثلاث لقطات.",
        "Film the same motion at 1/50, 1/500 and 1/2000. Upload all three.",
      ),
      research: t(
        "نوت في Obsidian: إيش هي زاوية الغالق، وليه ١٨٠°، ومتى نكسرها.",
        "Obsidian note: what shutter angle is, why 180°, and when to break it.",
      ),
      produce: t(
        'ريل ٢٠ ثانية: مقارنة جنب لجنب، "ليه فيديوك شكله جوال؟".',
        '20 s reel: side-by-side comparison, "Why does your video look like a phone?".',
      ),
      article: t(
        'مقال: "قاعدة الـ ١٨٠° بالعربي: سر الحركة السينمائية في الجوال".',
        'Article: "The 180° rule explained: the secret to cinematic motion on a phone".',
      ),
    },
    refs: [],
  },
  {
    id: "one-light-one-window",
    programId: "lighting",
    sectionId: "three-point",
    name: t(
      "ضوء واحد وشباك واحد: أساسيات الـ Key والـ Fill",
      "One light, one window: key + fill basics",
    ),
    tier: 1,
    gear: "lights",
    studio: false,
    source: "draft",
    what: t(
      "الـ Key هو الضوء الأساسي على الوجه، والـ Fill يخفف الظل. الشباك ممكن يكون واحد منهم وإضاءتك الثانية.",
      "The key is the main light on the face; the fill softens the shadow. A window can be one of them and your light the other.",
    ),
    steps: [
      t(
        "قعّد الشخص جنب الشباك بزاوية ٤٥°، دا الـ Key.",
        "Sit the subject at 45° to a window; that is your key.",
      ),
      t(
        "حط إضاءتك من الجهة الثانية على أقل قوة، دا الـ Fill.",
        "Put your light on the other side at low power; that is your fill.",
      ),
      t(
        "زوّد وقلّل الـ Fill لحد ما الظل يعجبك، لا يختفي كله.",
        "Raise and lower the fill until the shadow looks good, not gone.",
      ),
      t(
        "طفّي أنوار السقف عشان ما تخرّب الألوان.",
        "Switch off the ceiling lights so they do not muddy the colors.",
      ),
    ],
    quests: {
      train: t(
        "صوّر نفس الوجه ٣ مرات: شباك بس، شباك + Fill خفيف، شباك + Fill قوي. ارفع الصور.",
        "Film the same face 3 ways: window only, window + soft fill, window + strong fill. Upload the frames.",
      ),
      research: t(
        "نوت في Obsidian: Key و Fill و Back، ونسبة الإضاءة (Key:Fill).",
        "Obsidian note: key, fill and back light, and the key:fill ratio.",
      ),
      produce: t(
        "كليب ٢٠ ثانية تتكلم فيه للكاميرا بإضاءة الشباك + Fill.",
        "20 s talking-head clip lit with window + fill.",
      ),
      article: t(
        'مقال: "إضاءة احترافية في غرفتك بشباك وضوء واحد".',
        'Article: "Pro lighting in your room with one window and one light".',
      ),
    },
    refs: [],
  },
  {
    id: "soft-vs-hard-harsh-sun",
    programId: "lighting",
    sectionId: "harsh-sun",
    name: t(
      "الضوء الناعم والقاسي: التنعيم في شمس الظهر",
      "Soft vs hard light: diffusion in harsh sun",
    ),
    tier: 1,
    gear: "lights",
    studio: false,
    source: "draft",
    what: t(
      "شمس الظهر عندنا قاسية: ظلال سودا تحت العيون. الحل تنعّم الضوء أو تهرب للظل أو تحط الشمس ورا الشخص.",
      "Midday sun here is harsh: dark shadows under the eyes. Soften it, move to shade, or put the sun behind the subject.",
    ),
    steps: [
      t(
        "شوف الظل على الأرض: حاد = ضوء قاسي، ناعم = ضوء ناعم.",
        "Look at the shadow on the ground: sharp = hard light, soft edge = soft light.",
      ),
      t(
        "حط قماش أبيض خفيف (أو ديفيوزر) بين الشمس والشخص.",
        "Put a thin white cloth (or a diffuser) between the sun and the subject.",
      ),
      t(
        "أو دوّر الشخص عشان الشمس تصير ورا راسه، ونوّر الوجه بعاكس أو ضوءك.",
        "Or turn the subject so the sun is behind their head, and fill the face with a reflector or your light.",
      ),
      t("جرّب ظل مبنى: ضوء ناعم ببلاش.", "Try a building's shade: free soft light."),
    ],
    quests: {
      train: t(
        "الساعة ١٢ الظهر صوّر نفس الوجه: شمس مباشرة، مع ديفيوزر، في الظل. ارفع الثلاث.",
        "At noon film the same face: direct sun, with diffusion, in shade. Upload all three.",
      ),
      research: t(
        "نوت في Obsidian: ليه حجم مصدر الضوء يغيّر نعومته.",
        "Obsidian note: why the size of a light source changes how soft it is.",
      ),
      produce: t(
        'ريل ١٥ ثانية: "تصوّر الظهر؟ اعمل كدا" مع قبل/بعد.',
        '15 s reel: "Filming at noon? Do this" with a before/after.',
      ),
      article: t(
        'مقال: "كيف تصوّر في شمس السعودية بدون ظلال بشعة".',
        'Article: "How to film in Saudi midday sun without ugly shadows".',
      ),
    },
    refs: [],
  },
  {
    id: "color-temp-mixing",
    programId: "lighting",
    sectionId: "color-temperature",
    name: t(
      "حرارة اللون: كيف تخلط ضوء النهار مع إضاءاتك",
      "Color temperature and mixing daylight with your lights",
    ),
    tier: 2,
    gear: "lights",
    studio: false,
    source: "draft",
    what: t(
      "كل ضوء له لون: النهار أزرق شوية (~5600K)، واللمبات الصفرا دافية (~3200K). لو خلطتهم بدون قصد، الوجه يطلع بلونين.",
      "Every light has a color: daylight is bluish (~5600K), warm bulbs are orange (~3200K). Mix them by accident and a face gets two colors.",
    ),
    steps: [
      t(
        "اعرف حرارة كل مصدر: الشباك، اللمبة، إضاءتك.",
        "Know each source's temperature: window, bulb, your light.",
      ),
      t(
        "خلّي إضاءتك على نفس حرارة الشباك (5600K) لو يبغى شكل طبيعي.",
        "Match your light to the window (5600K) for a natural look.",
      ),
      t(
        "أو اقصد الخلط: وجه دافي وخلفية زرقا عشان مود سينمائي.",
        "Or mix on purpose: warm face, cool background for a cinematic mood.",
      ),
      t(
        "اقفل توازن الأبيض في الكاميرا عشان الألوان ما تتحرك.",
        "Lock white balance in the camera so colors do not drift.",
      ),
    ],
    quests: {
      train: t(
        "صوّر نفس الكادر بإضاءتك على 3200K و 5600K مع الشباك. ارفع الاثنين.",
        "Film the same frame with your light at 3200K and 5600K next to a window. Upload both.",
      ),
      research: t(
        "نوت في Obsidian: مقياس الكلفن، وإيش الجلز CTO و CTB.",
        "Obsidian note: the Kelvin scale, and what CTO and CTB gels do.",
      ),
      produce: t(
        "كليب ٢٠ ثانية بمود دافي/بارد مقصود.",
        "20 s clip with an intentional warm/cool mood.",
      ),
      article: t(
        'مقال: "ليه وجهك في الفيديو لونين؟ حرارة اللون ببساطة".',
        'Article: "Why is your face two colors on video? Color temperature made simple".',
      ),
    },
    refs: [],
  },
  {
    id: "shot-sizes-headroom",
    programId: "composition",
    sectionId: "shot-sizes",
    name: t("أحجام اللقطات ومساحة الرأس", "Shot sizes and headroom"),
    tier: 1,
    gear: "any",
    studio: false,
    source: "draft",
    what: t(
      "واسعة تورّي المكان، متوسطة تورّي الشخص، قريبة تورّي الإحساس. ومساحة الرأس الصح تخلّي الكادر مرتاح.",
      "Wide shows the place, medium shows the person, close-up shows the feeling. Right headroom keeps the frame comfortable.",
    ),
    steps: [
      t("شغّل الشبكة (Grid) في الكاميرا.", "Turn on the grid in your camera."),
      t("صوّر WS و MS و CU لنفس الشخص.", "Shoot a WS, an MS and a CU of the same person."),
      t(
        "خلّي العيون على الخط الأعلى من الشبكة، ولا تقص الذقن في القريبة.",
        "Keep the eyes on the top grid line, and do not crop the chin in the close-up.",
      ),
      t(
        "لو الشخص يطالع يمين، خلّي مساحة قدامه (lead room).",
        "If the subject looks right, leave space in front of them (lead room).",
      ),
    ],
    quests: {
      train: t(
        "صوّر ٥ أحجام (EWS, WS, MS, MCU, CU) لنفس الشخص. ارفع الخمس صور.",
        "Shoot 5 sizes (EWS, WS, MS, MCU, CU) of the same person. Upload all five frames.",
      ),
      research: t(
        "نوت في Obsidian: أسماء أحجام اللقطات ومتى تستخدم كل وحدة.",
        "Obsidian note: shot size names and when to use each one.",
      ),
      produce: t(
        "كليب ٢٠ ثانية فيه تسلسل واسعة ← متوسطة ← قريبة.",
        "20 s clip with a wide → medium → close sequence.",
      ),
      article: t(
        'مقال: "أحجام اللقطات: قاموس المصوّر المبتدئ".',
        'Article: "Shot sizes: the beginner videographer\'s dictionary".',
      ),
    },
    refs: [],
  },
];
