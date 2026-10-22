# DT-2 — independent Codex review and verification

Claude owns implementation. Codex owns this review record. DT-1 was accepted locally
on its final fourteen hashes; this document does not change the separate Discover status.

## Baseline before the shared-shell change

Existing E2E selection: **15 passed, 1 intentional desktop skip, exit 0**, 16.9 seconds.
Tests covered post popup/hash/Back, player Back, player over a skill sheet, Notes
autocomplete Enter/Escape, both worlds, remembered Social More, AR/EN header controls,
and the phone Social compact header. The new Quick Actions component did not exist yet.

Command:
```text
pnpm exec playwright test e2e/calendar.spec.ts e2e/player.spec.ts e2e/notes.spec.ts e2e/world.spec.ts e2e/layout.spec.ts e2e/social-look.spec.ts --grep 'the post popup and history|Back closes only the player|a saved reference plays|typing .* suggests skills|the world switch moves|Social More opens|Arabic RTL by default|Social shell: glass tab bar' --workers=2
```

Logs and JSON: `C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/`
(`dt2-existing-baseline.log`, `dt2-existing-baseline.json`).

## Review targets

- Navigation is exactly once and opens the visibly selected/focused result, including
  a result reached with Tab; filtering cannot activate an obsolete selection.
- Existing editors and modal dialogs keep their keyboard handling. Dismissal is
  available on phones as well as keyboards; focus returns on dismissal and the page
  remains usable after selecting a route or same-page anchor.
- Both world headers fit at phone width and both text directions. Opening does not
  alter history or settings; only choosing a destination navigates.
- No provider request or credential-dependent state is introduced into the palette.
  Compare the frozen source/build hashes, then run new tests and the baseline above.

Final verdict is recorded below, after the initial findings and repair evidence.

## Early review before freeze

**P2 — mixed Tab/Arrow navigation desynchronizes selection from activation.**
In the initial `QuickActions.tsx`, arrows update `sel` on any dialog descendant, but
Enter on a focused Link deliberately follows that Link. Reproduction: open, Tab from
input to Today, ArrowDown highlights Skills, Enter still opens Today. Tab alone also
leaves `aria-selected` on the earlier row. Keep focus, selection and activation coherent:
when a result owns focus, arrows should move focus and selection together, or scope
active-descendant arrow handling to the input. Add mixed Tab → Arrow → Enter coverage
in the browser, not only input-arrow and edge-Tab tests. Independently confirmed by
two reviewers before freeze.

Provide a labeled Close button in the dialog header for mobile/assistive use, included
in focus containment and dismissal restoration tests. The current nearly full-height
phone overlay offers only its narrow backdrop edge when no hardware Escape key is
available. Keep this inside the current dialog scope; no shared modal changes needed.

## Amendment A review

Both initial findings are addressed in source and new unit/browser cases. One additional
P2 was found before freeze: `QuickActionsProvider.open()` opens unconditionally; the
other-modal guard is only in the shortcut listener. The existing SkillSheet focuses
its panel but does not contain Tab, so a keyboard user can Shift+Tab to the covered
header launcher and press Enter, opening Quick Actions over the skill. Escape then
also reaches SkillSheet's document listener and closes both. Put the other-modal guard
in the shared `open()` callback (and ignore duplicate opens) so every entry point has
the same protection. Cover launcher activation while a modal exists. No shared-modal
change is necessary. Independent source review confirmed the reachable path.

Direct IAB reproduction on the 14:19 export confirmed the issue: Skills → Camera →
Steady handheld → Ctrl+K correctly leaves Quick Actions closed; Shift+Tab out of the
skill panel and through the page reaches the header launcher; Enter yields one skill
dialog plus one quick dialog. Escape leaves zero of each. The same browser also
confirmed Amendment A's mixed Tab → ArrowDown → Enter now opens Skills correctly.

## Final independent verification — 16 October 2026, 14:26 AST

**Final verdict: ready for user acceptance.** All three findings are resolved. The
planner set implementation owner to none and froze DT-2 at 14:27 AST. Codex verified
all eleven final freeze fingerprints (eight source/test/dictionary files and three
exports), with zero mismatches. No additional source change is required.

- **165 unit tests across 7 files passed**, exit 0, 2.46 seconds. Command:
  `pnpm exec vitest run lib/tools.test.ts components/shell components/tools messages`.
  Captured all eight source fingerprints before the run; all remained identical to
  the final handoff fingerprints after the unit and browser runs.
- **32 new-tools browser checks passed**, exit 0, 27.97 seconds, no failures/flakes:
  `pnpm exec playwright test e2e/quick-actions.spec.ts e2e/tools.spec.ts --workers=2`.
  This includes 22 Quick Actions and 10 Tools hub cases across phone/desktop.
- **15 existing-shell browser checks passed, 1 intentional desktop skip**, exit 0,
  21.23 seconds, no failures/flakes. Same baseline command as above; calendar history,
  player overlays/Back, Notes autocomplete, world restoration and responsive shell
  behavior stayed green after the shared AppShell change.
- **Manual IAB:** reproduced the modal collision before repair, then repeated the
  identical Camera/skill/backward-Tab sequence on the final build. Enter and Ctrl+K
  both leave Quick Actions closed; Escape closes the skill alone. Mixed Tab/arrow/
  Enter opens Skills; Social → Notes enters Training. English `notes` finds the
  Arabic Notes row; Arabic `ملاحظات` finds the English row. At 375 CSS pixels,
  scroll width equals client width, Close measures 44×44, dismissal preserves the
  route and restores launcher focus. Temporary viewport override reset afterward.
- All **8 source + 2 export hashes** in the executor's final record matched disk.
  The ten DT-1 files excluded from DT-2's permitted extensions still match the
  accepted DT-1 hashes. Shared registry/dictionary changes are the intended DT-2
  extensions. `out/tools/index.html` now hashes to
  `db861fa3495fc4521dbf657ae82e2373c1ea288e682a1b9fe8ed66500cdad5c8`.

Independent evidence directory:
`C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/`.
Files: `dt2-vitest.log`, `dt2-e2e.log`/`.json`, `dt2-existing-final.log`/`.json`,
`dt2-start-hashes.json`, `quick-actions-ar-phone.jpg`,
`quick-actions-desktop-accepted.jpg`. JSON reports show zero unexpected or flaky tests.

Claude separately records successful lint, app/Worker typecheck, formatting, build,
87 browser cases plus 1 expected skip, and the 15-case shell baseline. Codex did not
repeat those broader checks after the passing focused verification. No commit, push,
deployment, real post/DM, provider grant or live connection test was performed. The
existing Discover packet and planned CMS/workflow/inbox capabilities remain separate.

Passing outcome delivered once to the existing Claude Training Page session at 14:27
AST and visible as a submitted message. DT-1/DT-2 stay frozen for user acceptance;
the Discover completion hook was not emitted or rebound.
