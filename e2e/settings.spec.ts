import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { freshState, seedState } from "./helpers";

test("Training settings keep their own cards and have no accounts card (tools/20)", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await expect(page.locator("html")).toHaveAttribute("data-world", "training");
  await expect(page.getByTestId("accounts-card")).toHaveCount(0);
  await expect(page.getByTestId("apikey-youtube")).toBeVisible();
  await expect(page.getByTestId("apikey-scoutUrl")).toBeVisible();
  await expect(page.getByTestId("gear-list")).toBeVisible();
  await expect(page.getByTestId("export")).toBeVisible();
});

test("unchecking a gear item locks the skills that need it", async ({ page }) => {
  await freshState(page, "/settings/");

  // Default gear is phone + lights, so lighting-gear skills start unlocked.
  await page.goto("/skills/");
  await page.locator('[data-testid="program-card"][data-program="lighting"]').click();
  await expect(page.getByTestId("gear-lock-chip")).toHaveCount(0);

  // Uncheck "lights" in Settings.
  await page.goto("/settings/");
  await page.getByTestId("gear-lights").locator('input[type="checkbox"]').uncheck();

  // Every skill in the Lighting program now shows the locked chip.
  await page.goto("/skills/");
  await page.locator('[data-testid="program-card"][data-program="lighting"]').click();
  const rows = page.getByTestId("skill-row");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await expect(page.getByTestId("gear-lock-chip")).toHaveCount(rowCount);
});

test("export downloads a valid backup that contains completions", async ({ page }) => {
  await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");

  await page.goto("/settings/");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path).toBeTruthy();
  const text = await fs.readFile(path!, "utf-8");
  const json = JSON.parse(text);

  expect(json.app).toBe("3z-prod");
  expect(Array.isArray(json.state.completions)).toBe(true);
  expect(json.state.completions.length).toBeGreaterThan(0);
  expect(json.state.completions[0]).toHaveProperty("skillId");
  expect(json.state.completions[0]).toHaveProperty("quest");
});

test("reset clears all progress after confirming", async ({ page }) => {
  await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");

  await page.goto("/settings/");
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();

  await page.goto("/");
  await expect(page.getByTestId("flow-count")).toHaveText("0/3");
});

test("a custom edit genre can be added, survives a reload and can be removed", async ({ page }) => {
  await freshState(page, "/settings/");

  // The built-in genres are read-only chips; the owner has none of their own yet.
  const card = page.locator("#genres");
  await expect(card.getByTestId("genre-builtin")).toHaveCount(35);
  await expect(card.locator('[data-testid="genre-builtin"][data-genre="cars"]')).toBeVisible();
  await expect(card.getByTestId("genre-remove")).toHaveCount(0);

  // Empty fields keep the button off; both are needed.
  const add = page.getByTestId("genre-add");
  await expect(add).toBeDisabled();
  await page.getByTestId("genre-add-name").fill("Drift");
  await expect(add).toBeDisabled();
  await page.getByTestId("genre-add-query").fill("drift edit");
  await expect(add).toBeEnabled();
  await add.click();

  const chip = page.getByTestId("settings-genre-custom-drift");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Drift");
  await expect(chip).toContainText("drift edit");
  await expect(page.getByTestId("genre-add-name")).toHaveValue("");
  await expect(page.getByTestId("genre-add-query")).toHaveValue("");
  await expect(add).toBeDisabled();

  // The same name again (typed another way) is ignored, and so is a built-in name. The form says so in
  // words (not only a red border), and the sentence is the name field's description.
  const name = page.getByTestId("genre-add-name");
  const exists = page.getByTestId("genre-exists");
  await expect(exists).toHaveCount(0);
  await name.fill("  drift ");
  await page.getByTestId("genre-add-query").fill("other words");
  await expect(exists).toBeVisible();
  await expect(exists).toHaveAttribute("role", "status");
  await expect(exists).toHaveText(/\S/);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription((await exists.innerText()).trim());
  await add.click();
  await expect(exists).toBeVisible();
  await name.fill("Cars");
  await expect(exists).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await add.click();
  await expect(card.getByTestId("genre-remove")).toHaveCount(1);
  await expect(chip).toContainText("drift edit");

  // A free name clears the sentence and the mark.
  await name.fill("Drone");
  await expect(exists).toHaveCount(0);
  await expect(name).not.toHaveAttribute("aria-invalid");

  // Saved on the device: still there after a reload.
  await page.reload();
  await expect(chip).toBeVisible();

  await chip.getByTestId("genre-remove").click();
  await expect(chip).toHaveCount(0);
  await expect(card.getByTestId("genre-remove")).toHaveCount(0);
  await page.reload();
  await expect(card.getByTestId("genre-builtin")).toHaveCount(35);
  await expect(chip).toHaveCount(0);
});

test("a custom edit genre shows in Discover's genre row and leaves it when removed", async ({
  page,
}) => {
  await freshState(page, "/settings/");
  await page.getByTestId("genre-add-name").fill("Drift");
  await page.getByTestId("genre-add-query").fill("drift edit");
  await page.getByTestId("genre-add").click();
  await expect(page.getByTestId("settings-genre-custom-drift")).toBeVisible();

  // Discover lists the built-in genres first, then the owner's.
  await page.goto("/discover/");
  await expect(page.getByTestId("genre-cars")).toBeVisible();
  await expect(page.getByTestId("genre-custom-drift")).toContainText("Drift");

  await page.goto("/settings/");
  await page.getByTestId("settings-genre-custom-drift").getByTestId("genre-remove").click();
  await expect(page.getByTestId("settings-genre-custom-drift")).toHaveCount(0);

  await page.goto("/discover/");
  await expect(page.getByTestId("genre-cars")).toBeVisible();
  await expect(page.getByTestId("genre-custom-drift")).toHaveCount(0);
});

// DT-6B-2C-5B-R1: the restore counts only once its write is read back. A browser that can't save it says so and keeps
// the progress it had; an ordinary restore (Arabic, the default) still says it imported and replaces the progress.
test("import says when the browser couldn't save it, and an ordinary import still replaces progress", async ({
  page,
}) => {
  await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");
  await page.goto("/settings/");
  const state = await page.evaluate(
    () => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state,
  );
  const file = {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-10-17",
        state: { ...state, completions: [], xpEvents: [] },
      }),
    ),
  };
  await page.evaluate(() => {
    const w = window as unknown as { __set: Storage["setItem"] };
    w.__set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === "3z-prod-v1") throw new DOMException("full", "QuotaExceededError");
      return w.__set.call(this, k, v);
    };
  });
  await page.getByTestId("import-file").setInputFiles(file);
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  await expect(page.getByText("المتصفح ما قدر يحفظ الاستيراد، فما تغيّر شي.")).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as unknown as { __set: Storage["setItem"] }).__set;
  });
  await page.goto("/");
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");

  await page.goto("/settings/");
  await page.getByTestId("import-file").setInputFiles(file);
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  await expect(page.getByText("انستورد التقدم ✓")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("flow-count")).toHaveText("0/3");
});

// DT-7C-2A: the reset waits for its durable result under the shared lock. The Confirm button says it is working, a
// second Confirm or a Cancel does nothing, a failure is never shown as done, and a reset that keeps cloud recovery
// records says so (remote work is not cancelled). Arabic first, then English; isolated test storage only.
const messages = async (lang: "ar" | "en"): Promise<Record<string, string>> =>
  JSON.parse(await fs.readFile(`messages/${lang}.json`, "utf-8"));

/** Canonical JSON (sorted keys), as the journal digests it. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

/** One valid queued journal entry (as the store writes it), for the retained-records copy. */
function journalWithOneEntry() {
  const origin = "https://scout.example";
  const ownerKey = "wfo_" + "a".repeat(32);
  const executionAt = "2026-10-17T09:00:00.000Z";
  const body = {
    occurrenceId: "m1",
    ownerKey,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: "Flow" },
      trigger: { kind: "manual" },
      actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea" } }],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt,
  };
  return {
    v: 1,
    generation: 1,
    commitId: "e2e-c1",
    suppression: { epoch: 0, resetAt: null, commitId: null },
    entries: [
      {
        key: JSON.stringify([origin, ownerKey, "m1"]),
        authority: { origin, ownerKey },
        occurrenceId: "m1",
        body,
        payloadDigest: createHash("sha256").update(canonical(body)).digest("hex"),
        executionAt,
        commitId: "e2e-c1",
        state: "queued",
        observation: null,
      },
    ],
  };
}

async function openSettingsWithProgress(page: Page, lang: "ar" | "en", cloudJournal?: unknown) {
  if (cloudJournal) await seedState(page, "/", { cloudJournal });
  else await freshState(page, "/");
  await page.getByTestId("main-done").click();
  await expect(page.getByTestId("flow-count")).toHaveText("1/3");
  await page.goto("/settings/");
  if (lang === "en") await page.getByRole("radio", { name: "English" }).click();
}

const storedJournal = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1") ?? "{}").state?.cloudJournal);

for (const lang of ["ar", "en"] as const) {
  test(`reset (${lang}) waits for the shared lock, ignores a second Confirm and a Cancel, then says it is done`, async ({
    page,
  }) => {
    const m = await messages(lang);
    await openSettingsWithProgress(page, lang);
    // Another holder of the shared lock (as another tab's commit would be).
    await page.evaluate(
      () =>
        new Promise<void>((held) => {
          void navigator.locks.request(
            "3z-prod-articles",
            () =>
              new Promise<void>((release) => {
                (window as unknown as { __release: () => void }).__release = release;
                held();
              }),
          );
        }),
    );
    await page.getByTestId("reset").click();
    await expect(page.locator("#confirm-body")).toHaveText(m["settings.resetConfirm"]);
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-ok")).toHaveText(m["settings.resetBusy"]);
    await page.getByTestId("confirm-ok").click();
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
    await expect(page.getByText(m["settings.resetOk"])).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(page.getByText(m["settings.resetOk"])).toBeVisible();
    // Exactly one reset ran: the suppression marker advanced once.
    expect((await storedJournal(page)).suppression.epoch).toBe(1);
    await page.goto("/");
    await expect(page.getByTestId("flow-count")).toHaveText("0/3");
  });

  test(`reset (${lang}) never says done when the browser couldn't save it, and keeps the progress`, async ({
    page,
  }) => {
    const m = await messages(lang);
    await openSettingsWithProgress(page, lang);
    await page.evaluate(() => {
      const w = window as unknown as { __set: Storage["setItem"] };
      w.__set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
        if (k === "3z-prod-v1") throw new DOMException("full", "QuotaExceededError");
        return w.__set.call(this, k, v);
      };
    });
    await page.getByTestId("reset").click();
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(page.getByText(m["settings.resetNotSaved"])).toBeVisible();
    await expect(page.getByText(m["settings.resetOk"])).toHaveCount(0);
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as unknown as { __set: Storage["setItem"] }).__set;
    });
    await page.goto("/");
    await expect(page.getByTestId("flow-count")).toHaveText("1/3");
  });

  test(`reset (${lang}) explains that cloud recovery records stay and remote work is not cancelled`, async ({
    page,
  }) => {
    const m = await messages(lang);
    await openSettingsWithProgress(page, lang, journalWithOneEntry());
    await page.getByTestId("reset").click();
    await expect(page.locator("#confirm-body")).toContainText(m["settings.resetConfirm"]);
    await expect(page.locator("#confirm-body")).toContainText(m["settings.resetRetained"]);
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    await expect(page.getByText(m["settings.resetOkRetained"])).toBeVisible();
    const journal = await storedJournal(page);
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].state).toBe("suppressed");
    await page.goto("/");
    await expect(page.getByTestId("flow-count")).toHaveText("0/3");
  });
}

test("a setting change waiting for the shared lock keeps the cloud records another tab wrote while holding it", async ({
  page,
  context,
}) => {
  // DT-7C-2A-R1 with real Web Locks: another tab (a plain same-origin document, no app code) holds
  // `3z-prod-articles` and, inside its hold, writes what its journal commit would: its own (older) view of the
  // ordinary state with a newer journal. This tab's ordinary save waits, then keeps that journal byte for byte
  // and still writes its own change.
  await openSettingsWithProgress(page, "en", journalWithOneEntry());
  await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
  const other = await context.newPage();
  await other.route("**/api/__e2e_other_tab__", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body>other tab</body>" }),
  );
  await other.goto("/api/__e2e_other_tab__");
  const theirs = await other.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("3z-prod-v1")!);
    raw.state.cloudJournal = { ...raw.state.cloudJournal, generation: 5, commitId: "other-tab" };
    return JSON.stringify(raw);
  });
  await other.evaluate(
    () =>
      new Promise<void>((held) => {
        void navigator.locks.request(
          "3z-prod-articles",
          () =>
            new Promise<void>((release) => {
              (window as unknown as { __release: () => void }).__release = release;
              held();
            }),
        );
      }),
  );
  await page.getByRole("radio", { name: "العربي" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.locks.query()).pending?.filter((l) => l.name === "3z-prod-articles")
            .length,
      ),
    )
    .toBeGreaterThan(0);
  await other.evaluate((v) => localStorage.setItem("3z-prod-v1", v), theirs);
  await other.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1")!).state.settings.lang),
    )
    .toBe("ar");
  expect(JSON.stringify(await storedJournal(page))).toBe(
    JSON.stringify(JSON.parse(theirs).state.cloudJournal),
  );
  await other.close();
});

// DT-7C-2A-R2 with real Web Locks and the actual app pages: a Website page's New article (a locked commit) and this
// Settings page's queued reminder change, in both orders while a third same-origin document holds `3z-prod-articles`.
// Whatever order they run in, the committed article, the setting and the cloud records all stay.
for (const cmsFirst of [true, false]) {
  test(`a queued setting change keeps the article another page committed (${cmsFirst ? "article first" : "setting first"})`, async ({
    page,
    context,
  }) => {
    await openSettingsWithProgress(page, "en", journalWithOneEntry());
    const journal = JSON.stringify(await storedJournal(page));
    const cms = await context.newPage();
    await cms.goto("/social/website/");
    await expect(cms.getByTestId("website-new")).toBeVisible();
    const holder = await context.newPage();
    await holder.route("**/api/__e2e_lock_holder__", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><body>lock holder</body>" }),
    );
    await holder.goto("/api/__e2e_lock_holder__");
    await holder.evaluate(
      () =>
        new Promise<void>((held) => {
          void navigator.locks.request(
            "3z-prod-articles",
            () =>
              new Promise<void>((release) => {
                (window as unknown as { __release: () => void }).__release = release;
                held();
              }),
          );
        }),
    );
    const pending = () =>
      holder.evaluate(
        async () =>
          (await navigator.locks.query()).pending?.filter((l) => l.name === "3z-prod-articles")
            .length,
      );
    const reminder = page.locator('input[type="time"]');
    if (cmsFirst) {
      await cms.getByTestId("website-new").click();
      await expect.poll(pending).toBe(1);
      await reminder.fill("05:15");
    } else {
      await reminder.fill("05:15");
      await expect.poll(pending).toBe(1);
      await cms.getByTestId("website-new").click();
    }
    await expect.poll(pending).toBe(2);
    await holder.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(cms).toHaveURL(/#a=/); // the article was committed (addArticle answered ok)
    const id = decodeURIComponent(new URL(cms.url()).hash.slice(3));
    await expect.poll(pending).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1")!).state.articles),
      )
      .toEqual([expect.objectContaining({ id })]);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("3z-prod-v1")!).state);
    expect(state.settings.reminderTime).toBe("05:15");
    expect(JSON.stringify(state.cloudJournal)).toBe(journal);
    await expect(cms.getByTestId("website-gone")).toHaveCount(0);
    await holder.close();
    await cms.close();
  });
}

test("Delete stored messages asks first, then sends one DELETE /social/inbox and says it is done", async ({
  page,
}) => {
  const WORKER = "https://scout.test";
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  };
  const wipes: string[] = [];
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.method() === "DELETE" && url.pathname === "/social/inbox") {
      wipes.push(req.headers()["authorization"] ?? "");
      return json({ ok: true });
    }
    // The accounts card's own status and data pulls.
    if (url.pathname === "/social/status") return json({ platforms: {} });
    return json({ accounts: [], snapshots: [], postStats: [], demographics: [], syncedAt: {} });
  });

  await freshState(page, "/social/settings/");
  // No Worker yet: the button is there, off.
  const wipe = page.getByTestId("accounts-wipe-inbox");
  await expect(wipe).toBeDisabled();

  await page.getByTestId("apikey-scoutUrl-input").fill(WORKER);
  await page.getByTestId("apikey-scoutUrl-input").press("Enter");
  await page.getByTestId("apikey-scoutToken-input").fill("fake-scout-token");
  await page.getByTestId("apikey-scoutToken-input").press("Enter");
  await expect(wipe).toBeEnabled();

  // Cancel sends nothing.
  await wipe.click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  expect(wipes).toHaveLength(0);

  await wipe.click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  await expect.poll(() => wipes.length).toBe(1);
  expect(wipes[0]).toBe("Bearer fake-scout-token");
  const toast = page.locator('[data-testid="toast"][data-kind="notice"]');
  await expect(toast.first()).toContainText("انحذفت الرسائل المخزنة");
  await expect(wipe).toBeEnabled();
  expect(wipes).toHaveLength(1);
});
