/** Serialized into the selected page's isolated world. Reads only visible player geometry/time. */
export function visibleTikTokVideo() {
  const page = new URL(window.location.href);
  const match = page.pathname.match(/^\/@([A-Za-z0-9_.]{1,64})\/video\/(\d{15,22})\/?$/);
  if (
    page.protocol !== "https:" ||
    page.port ||
    page.username ||
    page.password ||
    !["www.tiktok.com", "tiktok.com"].includes(page.hostname) ||
    !match ||
    document.visibilityState !== "visible"
  )
    return { error: "unsupported" };
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      Number(style.opacity) > 0
    );
  };
  if ([...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"]')].some(visible))
    return { error: "overlay" };
  const videos = [...document.querySelectorAll("video")].filter((video) => {
    const r = video.getBoundingClientRect();
    return (
      visible(video) &&
      r.width >= 120 &&
      r.height >= 120 &&
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= window.innerWidth &&
      r.bottom <= window.innerHeight
    );
  });
  if (videos.length !== 1) return { error: "ambiguous" };
  const video = videos[0];
  const style = getComputedStyle(video);
  const r = video.getBoundingClientRect();
  const article = video.closest("article");
  const authorMatches =
    article &&
    [...article.querySelectorAll("a[href]")].some((link) => {
      try {
        return new URL(link.href, page.href).pathname === `/@${match[1]}`;
      } catch {
        return false;
      }
    });
  if (!authorMatches) return { error: "ambiguous" };
  // Reject overlays from outside the player article, including messages/toasts over the crop.
  if (
    [0.1, 0.5, 0.9].some((dx) =>
      [0.1, 0.5, 0.9].some((dy) => {
        const hit = document.elementFromPoint(r.left + r.width * dx, r.top + r.height * dy);
        return !hit || !article.contains(hit);
      }),
    )
  )
    return { error: "overlay" };
  if (
    video.readyState < 2 ||
    !video.videoWidth ||
    !video.videoHeight ||
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    video.duration > 90 ||
    !Number.isFinite(video.currentTime) ||
    video.currentTime < 0 ||
    video.currentTime > video.duration ||
    (window.visualViewport && window.visualViewport.scale !== 1)
  )
    return { error: "not-ready" };
  // Crop away contain/letterbox padding; cover is already clipped to the element.
  let width = r.width,
    height = r.height,
    x = r.left,
    y = r.top;
  if (style.objectFit === "contain") {
    if (style.objectPosition !== "50% 50%") return { error: "layout" };
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    width = video.videoWidth * scale;
    height = video.videoHeight * scale;
    x += (r.width - width) / 2;
    y += (r.height - height) / 2;
  } else if (!["cover", "fill"].includes(style.objectFit)) return { error: "layout" };
  return {
    url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`,
    durationSeconds: video.duration,
    timestampSeconds: video.currentTime,
    capturedAt: new Date().toISOString(),
    rect: { x, y, width, height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export function sameCaptureTarget(before, after) {
  return (
    !!before &&
    !!after &&
    !before.error &&
    !after.error &&
    before.url === after.url &&
    Math.abs(before.durationSeconds - after.durationSeconds) < 0.05 &&
    after.timestampSeconds >= before.timestampSeconds &&
    after.timestampSeconds - before.timestampSeconds <= 1 &&
    ["x", "y", "width", "height"].every(
      (key) => Math.abs(before.rect[key] - after.rect[key]) < 1,
    ) &&
    before.viewport.width === after.viewport.width &&
    before.viewport.height === after.viewport.height
  );
}

/** Crop locally. The surrounding page image is never retained, exported or transmitted. */
export async function cropVideoScreenshot(dataUrl, target) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const scaleX = bitmap.width / target.viewport.width;
    const scaleY = bitmap.height / target.viewport.height;
    if (!Number.isFinite(scaleX) || Math.abs(scaleX - scaleY) > 0.02 || scaleX <= 0)
      throw new Error("layout");
    const r = target.rect;
    if (
      r.x < 0 ||
      r.y < 0 ||
      r.width < 120 ||
      r.height < 120 ||
      r.x + r.width > target.viewport.width ||
      r.y + r.height > target.viewport.height
    )
      throw new Error("layout");
    const scale = Math.min(1, 960 / Math.max(r.width * scaleX, r.height * scaleY));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(r.width * scaleX * scale));
    canvas.height = Math.max(1, Math.round(r.height * scaleY * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(
      bitmap,
      r.x * scaleX,
      r.y * scaleY,
      r.width * scaleX,
      r.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    // Reject blank/uniform frames; no pixel content leaves this local crop function.
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let low = 255,
      high = 0;
    for (let i = 0; i < pixels.length; i += 64) {
      const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      low = Math.min(low, light);
      high = Math.max(high, light);
    }
    if (high - low < 8) throw new Error("blank");
    for (const quality of [0.82, 0.65, 0.48]) {
      const crop = canvas.toDataURL("image/jpeg", quality);
      if (crop.startsWith("data:image/jpeg;base64,") && crop.length <= 218475) return crop;
    }
    throw new Error("too-large");
  } finally {
    bitmap.close();
  }
}

export function appendCapturedFrame(capture, target, dataUrl) {
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || dataUrl.length > 218475)
    throw new Error("too-large");
  if (
    capture &&
    (capture.url !== target.url ||
      Math.abs(capture.durationSeconds - target.durationSeconds) > 0.05)
  )
    throw new Error("changed");
  if (capture?.frames.length >= 8) throw new Error("full");
  const previous = capture?.frames.at(-1);
  if (
    previous &&
    (target.timestampSeconds - previous.timestampSeconds < 0.1 ||
      capture.frames.some((frame) => frame.dataUrl === dataUrl))
  )
    throw new Error("repeat");
  return {
    version: 1,
    provenance: "browser-visible-video",
    platform: "tt",
    url: target.url,
    capturedAt: capture?.capturedAt ?? target.capturedAt,
    durationSeconds: target.durationSeconds,
    frames: [
      ...(capture?.frames ?? []),
      {
        timestampSeconds: target.timestampSeconds,
        capturedAt: target.capturedAt,
        dataUrl,
      },
    ],
  };
}
