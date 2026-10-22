import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import en from "../messages/en.json";
import ar from "../messages/ar.json";
import { seedState } from "./helpers";

// Synthetic browser-only state: no connection, token, provider or remote workflow execution.
const authority = { origin: "https://reconciliation.invalid", ownerKey: "wfo_" + "a".repeat(32) };
const occurrenceId = "retired-test";
const outputId = `wf:${occurrenceId}:idea`;
const beforeReset = "2025-01-01T00:00:00.000Z";

function reconciliation() {
  return {
    v: 1,
    generation: 1,
    commitId: "commit-test",
    authorities: [
      {
        key: JSON.stringify([authority.origin, authority.ownerKey]),
        authority,
        cursor: 3,
        retired: 1,
      },
    ],
    proofs: [],
    tombstones: [
      {
        key: JSON.stringify([authority.origin, authority.ownerKey, occurrenceId]),
        authority,
        occurrenceId,
        payloadDigest: "a".repeat(64),
        prunedAt: "2025-04-01T00:00:00.000Z",
        executionAt: beforeReset,
        changeSeq: 3,
        owned: [outputId],
        deleted: [],
      },
    ],
    pending: [],
    runs: [],
  };
}

async function exportFile(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const path = await (await pending).path();
  expect(path).toBeTruthy();
  return {
    name: "private-test-backup.json",
    mimeType: "application/json",
    buffer: await fs.readFile(path!),
  };
}

async function importFile(page: Page, file: Awaited<ReturnType<typeof exportFile>>) {
  await page.getByTestId("import-file").setInputFiles(file);
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
}

async function disk(page: Page) {
  return page.evaluate(() => localStorage.getItem("3z-prod-v1"));
}

for (const lang of ["en", "ar"] as const) {
  const messages = lang === "en" ? en : ar;
  test.beforeEach(async ({ context }) => {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "localhost" || url.hostname === "127.0.0.1"
        ? route.continue()
        : route.abort();
    });
  });

  test(`retired backup after a reset never restores old drafts (${lang})`, async ({ page }) => {
    await seedState(page, "/settings/", {
      settings: { lang },
      cloudReconciliation: reconciliation(),
      ideas: [
        { id: outputId, text: "Old cloud draft", source: "workflow", createdAt: beforeReset },
        { id: "ordinary-test", text: "My ordinary draft", source: "me", createdAt: beforeReset },
      ],
    });
    const old = await exportFile(page);
    // Another device reset before it learned this retired marker.
    await seedState(page, "/settings/", { settings: { lang } });
    await page.getByTestId("reset").click();
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("confirm-dialog")).toBeHidden();
    // Reset restores the default Arabic setting. Select the scenario language before importing.
    if (lang === "en") await page.getByRole("radio", { name: "English", exact: true }).click();
    await importFile(page, old);
    await expect(page.getByText(messages["settings.importOk"], { exact: true })).toBeVisible();
    const state = JSON.parse((await disk(page))!).state;
    expect(state.ideas.some((x: { id: string }) => x.id === outputId)).toBe(false);
    expect(state.ideas.some((x: { id: string }) => x.id === "ordinary-test")).toBe(true);
    expect(state.cloudReconciliation.tombstones[0]).toMatchObject({
      owned: [],
      deleted: [outputId],
    });
    await page.reload();
    await expect(page.locator("#main")).toBeVisible();
    expect(
      JSON.parse((await disk(page))!).state.ideas.some((x: { id: string }) => x.id === outputId),
    ).toBe(false);
  });

  test(`retained deletion defeats a genuine older export (${lang})`, async ({ page }) => {
    const recon = reconciliation();
    await seedState(page, "/settings/", {
      settings: { lang },
      cloudReconciliation: recon,
      ideas: [{ id: outputId, text: "Old draft", source: "workflow", createdAt: beforeReset }],
    });
    const old = await exportFile(page);
    // Durable state produced by a recorded removal, independent of the backup being restored.
    await seedState(page, "/settings/", {
      settings: { lang },
      ideas: [],
      cloudReconciliation: {
        ...recon,
        generation: 2,
        commitId: "deleted-test",
        tombstones: recon.tombstones.map((t) => ({ ...t, owned: [], deleted: [outputId] })),
      },
    });
    await importFile(page, old);
    await expect(page.getByText(messages["settings.importOk"], { exact: true })).toBeVisible();
    expect(JSON.parse((await disk(page))!).state.ideas).toEqual([]);
    expect(JSON.parse((await disk(page))!).state.cloudReconciliation.tombstones[0].deleted).toEqual(
      [outputId],
    );
  });

  test(`legacy watermark refuses restore and preserves durable bytes (${lang})`, async ({
    page,
  }) => {
    await seedState(page, "/settings/", { settings: { lang } });
    const ordinaryBackup = await exportFile(page);
    const recon = reconciliation();
    await seedState(page, "/settings/", {
      settings: { lang },
      cloudReconciliation: {
        ...recon,
        tombstones: [],
        authorities: recon.authorities.map((a) => ({ ...a, watermark: 3 })),
      },
    });
    const before = await disk(page);
    await importFile(page, ordinaryBackup);
    await expect(
      page.getByText(messages["settings.importJournalRefused"], { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(messages["settings.importOk"], { exact: true })).toHaveCount(0);
    expect(await disk(page)).toBe(before);
  });
}
