/* global chrome */
import { collectVisibleDiscoverLinks } from "./capture.js";

const copy = {
  ar: {
    heading: "اختار اللي يلهمك",
    intro:
      "افتح نتائج بحث في تيك توك أو إنستقرام أو يوتيوب، وبعدها اعرض روابط المقاطع الظاهرة هنا.",
    privacy: "روابط فقط، بحد أقصى ٢٤ رابط من الجزء الظاهر. ما ننقل نصوص الصفحة أو بيانات حسابك.",
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
      "Links only, up to 24 from the visible area. Page text and account data are never copied.",
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
}

elements.language.addEventListener("click", () => {
  language = language === "ar" ? "en" : "ar";
  render();
});

elements.capture.addEventListener("click", async () => {
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
