/* global chrome */
import { collectVisibleDiscoverLinks } from "./capture.js";
import {
  visibleTikTokVideo,
  sameCaptureTarget,
  cropVideoScreenshot,
  appendCapturedFrame,
} from "./video-capture.js";

const videoCopy = {
  ar: {
    heading: "راجع مقطع تيك توك ظاهر قدامك",
    privacy:
      "هذا الخيار يلتقط صورة للجزء الظاهر من المقطع، مو روابط فقط. نقصّ الصفحة حوله على جهازك. الصور تظل هنا لين تحفظها؛ ما نرسلها للذكاء الاصطناعي تلقائيًا.",
    capture: "التقط اللحظة الظاهرة",
    save: "احفظ ملف اللقطات",
    reset: "امسح اللقطات",
    open: "افتح Discover",
    help: "افتح مقطع تيك توك لحاله وخليه ظاهر بالكامل. التقط من لحظتين إلى ٨ لحظات مختلفة أثناء مشاهدتك، وراجع الصور. احفظ الملف وافتحه في Discover عشان تختار فحصه بـ ChatGPT. إغلاق الإضافة يمسح اللقطات غير المحفوظة. ما نسجّل الحركة أو الصوت.",
    working: "نلتقط الجزء الظاهر…",
    ready: (n) => `${n} لقطات جاهزة للمراجعة.`,
    saved: "حفظنا ملف اللقطات. افتحه في Discover قبل طلب فحص الذكاء الاصطناعي.",
    unsupported: "افتح رابط مقطع تيك توك نفسه، مو صفحة البحث أو حساب شخص.",
    failed: "ما قدرنا نلتقط المقطع بأمان. خليه ظاهر بالكامل، وسكّر أي نافذة تغطيه ثم جرّب ثاني.",
    repeat:
      "نحتاج لحظة مختلفة بعد اللقطة السابقة. شغّل المقطع شوي؛ إذا رجع للبداية امسح اللقطات وابدأ من جديد.",
    changed: "المقطع أو التبويب تغيّر. امسح اللقطات قبل مراجعة مقطع ثاني.",
    blank: "اللقطة فاضية أو مو واضحة. انتظر ظهور المقطع ثم جرّب ثاني.",
    full: "وصلت ٨ لقطات. راجعها واحفظ الملف، أو امسحها وابدأ من جديد.",
  },
  en: {
    heading: "Review a visible TikTok video",
    privacy:
      "This option captures images, not just links. We crop the surrounding page on your device. Images stay here until you save them; nothing is sent to AI automatically.",
    capture: "Capture this moment",
    save: "Save capture file",
    reset: "Discard captures",
    open: "Open Discover",
    help: "Open one TikTok post with its video fully visible. Capture 2–8 different moments as you watch, then review the images. Save the file and import it in Discover before choosing a ChatGPT check. Closing this popup discards unsaved captures. Motion and audio are not recorded.",
    working: "Capturing the visible video…",
    ready: (n) => `${n} captures ready to review.`,
    saved: "Capture file saved. Import it in Discover before requesting an AI check.",
    unsupported: "Open the TikTok post itself, rather than search results or a profile.",
    failed:
      "Couldn't capture safely. Keep the whole video visible and close anything covering it, then try again.",
    repeat:
      "Capture a different moment after the previous one. Let the video play; if it looped, discard these captures and start again.",
    changed: "The post or tab changed. Discard these captures before reviewing another post.",
    blank: "The image is blank or unclear. Wait for the video to appear, then try again.",
    full: "You have 8 captures. Review and save them, or discard them to start again.",
  },
};

const copy = {
  ar: {
    heading: "اختار اللي يلهمك",
    intro:
      "افتح نتائج بحث في تيك توك أو إنستقرام أو يوتيوب، وبعدها اعرض روابط المقاطع الظاهرة هنا.",
    privacy:
      "زر الروابط ينسخ بحد أقصى ٢٤ رابط من الجزء الظاهر. ما ينقل نصوص الصفحة أو بيانات حسابك.",
    capture: "اعرض الروابط الظاهرة",
    capturing: "لحظة، نجهّز الروابط…",
    unsupported:
      "افتح صفحة نتائج البحث في تيك توك أو يوتيوب، أو بحث الكلمات أو الهاشتاق في إنستقرام، وجرّب ثاني.",
    empty: "ما لقينا روابط مقاطع ظاهرة. تأكد إن النتائج واضحة قدامك وجرّب ثاني.",
    failed: "ما قدرنا نقرأ الصفحة. افتح الإضافة من صفحة البحث وجرّب ثاني.",
    legend: "اختار الروابط اللي تبغاها",
    found: (count) => `لقينا ${count} رابط. اختار اللي تبغى تراجعه.`,
    review: (count) => `راجع في Discover (${count})`,
    opening: "فتحنا صفحة المراجعة في Discover.",
    openFailed: "ما قدرنا نفتح صفحة المراجعة. جرّب ثاني.",
    local: "شغّل التطبيق المحلي على localhost:3000. تراجع الروابط قبل إضافتها في Discover.",
  },
  en: {
    heading: "Choose what inspires you",
    intro:
      "Open TikTok, Instagram or YouTube search results, then list the video links visible on that page.",
    privacy:
      "The links button copies up to 24 visible links. It does not copy page text or account data.",
    capture: "Find visible links",
    capturing: "Finding links…",
    unsupported:
      "Open TikTok or YouTube search results, or Instagram keyword or hashtag search, and try again.",
    empty: "No visible video links found. Make sure results are visible and try again.",
    failed: "Couldn't read this page. Open the extension from a search results page and try again.",
    legend: "Choose links to review",
    found: (count) => `Found ${count} links. Choose which ones to review.`,
    review: (count) => `Review in Discover (${count})`,
    opening: "Opened the review page in Discover.",
    openFailed: "Couldn't open the review page. Try again.",
    local:
      "Run your local app at localhost:3000. You'll review these links before adding them to Discover.",
  },
};

let language = "ar";
let capture = null;
let status = "";
let busy = false;
let videoCapture = null;
let videoStatus = "";
const selected = new Set();
const elements = Object.fromEntries(
  [
    "language",
    "heading",
    "intro",
    "privacy",
    "capture",
    "status",
    "results",
    "legend",
    "links",
    "review",
    "local",
    "video-heading",
    "video-privacy",
    "video-help",
    "video-capture",
    "video-save",
    "video-reset",
    "video-open",
    "video-status",
    "video-source",
    "video-frames",
  ].map((id) => [id, document.getElementById(id)]),
);

function render() {
  const text = copy[language];
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  elements.language.textContent = language === "ar" ? "English" : "العربية";
  for (const key of ["heading", "intro", "privacy", "capture", "legend", "local"]) {
    elements[key].textContent = text[key];
  }
  elements.capture.disabled = busy;
  elements.status.textContent =
    status === "found" ? text.found(capture.urls.length) : text[status] || "";
  elements.review.textContent = text.review(selected.size);
  elements.review.disabled = busy || !selected.size;
  elements.review.hidden = !capture?.urls.length;
  elements.results.hidden = !capture?.urls.length;
  const videoText = videoCopy[language];
  for (const key of ["heading", "privacy", "help", "capture", "save", "reset", "open"])
    elements[`video-${key}`].textContent = videoText[key];
  elements["video-status"].textContent =
    videoStatus === "ready"
      ? videoText.ready(videoCapture.frames.length)
      : videoText[videoStatus] || "";
  elements["video-capture"].disabled = busy || videoCapture?.frames.length >= 8;
  elements["video-save"].disabled = busy || !(videoCapture?.frames.length >= 2);
  elements["video-reset"].disabled = busy || !videoCapture;
  elements["video-open"].disabled = busy;
  elements["video-source"].hidden = !videoCapture;
  if (videoCapture) {
    elements["video-source"].href = videoCapture.url;
    elements["video-source"].textContent = videoCapture.url;
  }
}

elements.language.addEventListener("click", () => {
  language = language === "ar" ? "en" : "ar";
  render();
});

elements.capture.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  capture = null;
  selected.clear();
  elements.links.replaceChildren();
  status = "capturing";
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectVisibleDiscoverLinks,
    });
    if (injection?.result?.error) {
      status = "unsupported";
    } else if (injection?.result?.version === 1 && Array.isArray(injection.result.urls)) {
      capture = injection.result;
      status = capture.urls.length ? "found" : "empty";
      for (const url of capture.urls) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const caption = document.createElement("span");
        caption.textContent = url;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(url);
          else selected.delete(url);
          render();
        });
        label.append(checkbox, caption);
        elements.links.append(label);
      }
    } else {
      status = "failed";
    }
  } catch {
    status = "failed";
  } finally {
    busy = false;
    render();
  }
});

elements["video-capture"].addEventListener("click", async () => {
  if (busy || videoCapture?.frames.length >= 8) return;
  busy = true;
  videoStatus = "working";
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || typeof tab.windowId !== "number") throw new Error("failed");
    const [before] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: visibleTikTokVideo,
    });
    if (before?.result?.error) throw new Error(before.result.error);
    if (!before?.result?.url) throw new Error("failed");
    if (videoCapture && videoCapture.url !== before.result.url) throw new Error("changed");
    const screen = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== tab.id || active?.windowId !== tab.windowId) throw new Error("changed");
    const [after] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: visibleTikTokVideo,
    });
    if (!sameCaptureTarget(before.result, after?.result)) throw new Error("changed");
    const crop = await cropVideoScreenshot(screen, before.result);
    videoCapture = appendCapturedFrame(videoCapture, before.result, crop);
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = crop;
    image.alt = `${videoCapture.frames.length}`;
    const caption = document.createElement("figcaption");
    caption.textContent = `≈ ${before.result.timestampSeconds.toFixed(1)}s`;
    figure.append(image, caption);
    elements["video-frames"].append(figure);
    videoStatus = "ready";
  } catch (error) {
    videoStatus = ["unsupported", "repeat", "changed", "blank", "full"].includes(error?.message)
      ? error.message
      : "failed";
  } finally {
    busy = false;
    render();
  }
});

elements["video-reset"].addEventListener("click", () => {
  if (busy) return;
  videoCapture = null;
  videoStatus = "";
  elements["video-frames"].replaceChildren();
  elements["video-source"].removeAttribute("href");
  render();
});

elements["video-save"].addEventListener("click", () => {
  if (busy || !videoCapture || videoCapture.frames.length < 2) return;
  const serialized = JSON.stringify(videoCapture);
  if (serialized.length > 2 * 1024 * 1024) {
    videoStatus = "failed";
    render();
    return;
  }
  const file = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = file;
  link.download = `discover-tiktok-capture-${videoCapture.url.split("/").at(-1)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(file), 1000);
  videoStatus = "saved";
  render();
});

elements["video-open"].addEventListener("click", async () => {
  if (busy) return;
  try {
    await chrome.tabs.create({ url: "http://localhost:3000/discover/#video-capture" });
  } catch {
    videoStatus = "failed";
    render();
  }
});

elements.review.addEventListener("click", async () => {
  if (busy || !capture || !selected.size) return;
  busy = true;
  render();
  const payload = { version: 1, platform: capture.platform, urls: [...selected].slice(0, 24) };
  try {
    await chrome.tabs.create({
      url: `http://localhost:3000/discover/#discover-import=${encodeURIComponent(JSON.stringify(payload))}`,
    });
    status = "opening";
  } catch {
    status = "openFailed";
  } finally {
    busy = false;
    render();
  }
});

render();
