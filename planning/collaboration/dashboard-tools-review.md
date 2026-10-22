# Dashboard tools — independent Codex review

## DT-1 first review — changes required

Claude remains the implementation owner until its handoff explicitly freezes. This is
review/test evidence, not source ownership or approval of Discover packet 30.

Reviewed DT-1 registry/screen fingerprints:

```text
8ca3f85e7651f0540c03b28b3afba37136dc87970a41ac46132f7247b5b6f608  lib/tools.ts
59535bbf4c89d49471da8fe65c31ad3110f5bf3f167cdb53705357daf3f9c274  components/tools/ToolsScreen.tsx
34ed3a1f634fbe85b10a57312fc41357fb94b7c64b266d6089a670762df73774  messages/tools.ar.json
c6654a066a5a7da84631e01f56eed74e155f17ea9fdd8327332a190b25a50067  messages/tools.en.json
```

### Findings

1. **P2 — Auto-posting mislabels missing status time as a permission problem.**
   `lib/tools.ts:129–137`: with a valid synthetic Worker configuration, connected
   Instagram with `canPublish: true`, and `statusAt: null`, the account row is unknown
   but Auto-posting becomes `attention`. The screen then says “Allow posting” even
   though posting permission is present. Preserve `unknown` when usable status time
   is absent; do not infer a permission failure. Add a test for this case.
2. **P2 — Permission-specific actions are also shown for unrelated connection errors.**
   `components/tools/ToolsScreen.tsx:117`: every attention state selects the tool's
   permission label. With `canReply: true` and either an expired token or `lastError`,
   Auto replies says “Needs reply permission”; Auto-posting similarly says “Allow
   posting” with `canPublish: true`. Use the specific label only for a demonstrated
   missing permission; generic errors/expiry should offer Check/Verify. Keep generic
   error handling distinct from permission checks and test both languages/rendered UI.
3. **P2 — Configured helper/MCP entries lose their only navigation link.**
   `components/tools/ToolsScreen.tsx:18` omits a configured-state action, while these
   two registry entries have only `setupHref`, not `href`. Once a helper ID or Worker
   configuration is saved, the row becomes noninteractive, so its controls cannot be
   reopened to inspect/change setup. Keep a neutral Open/Manage action for configured
   setup-only entries and test their rendered links with synthetic saved configuration.
   Independently confirmed by the second reviewer on the same hashes.

The first two cases were reproduced with a standalone read-only domain probe, exit 0:
`C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/readiness-probe.ts`.
The probe uses synthetic credentials and does not invoke a provider. It printed
`attention` with the permission message key for each erroneous case above.

### Direct browser observations on the rebuilt localhost:3000 export

- More → Tools works in the existing in-app browser session.
- Arabic query `الرُّدود` finds Auto replies in the English interface.
- English query `replies` finds الردود التلقائية in the Arabic interface; RTL rendering
  was inspected at the default narrow viewport.
- Search `backup` → Backup reaches `/settings/#data` and the existing data controls.
- Planned features remain explicitly labeled. No owner credentials were entered,
  exported or changed; no live post, reply or connection operation was tested.

### Preserved-work check

The older Discover Freeze 24 manifest is not a current whole-worktree fingerprint:
six research component/test hashes already differ, with modification times 12:58–13:01
AST, before DT-1 started. These pre-existing changes are outside DT-1.
Do not restore them or use Freeze 24 as proof of the current export. DT-1 review is
limited to its companion handoff's files; Discover acceptance remains separate.

After these bounded repairs, freeze with owner none and updated hashes/check evidence.
Codex will independently recheck the affected logic and UI before DT-2 starts.

## DT-1 repair recheck — validation passed, final freeze pending

All three findings are closed in the repaired source. A second independent reader
confirmed the fixes and found no new consequential issue within this scope.

- Independently ran `pnpm exec vitest run lib/tools.test.ts components/tools
  components/shell messages`: **6 files, 139 passed, exit 0** (13:58 AST).
- Independently ran `pnpm exec playwright test e2e/tools.spec.ts --workers=2`:
  **10 passed, 0 failed, exit 0**, phone and desktop, against the existing :3000 export.
- Re-ran the standalone readiness probe: both missing-time rows now return `unknown`;
  expiry/provider-error cases remain `attention` without permission-specific actions.
  Rendered AR/EN tests verify generic Check and retained configured Manage links.
- Source fingerprints agree with the six repair hashes. The served Tools export is
  `71b4b4e9bab0aed692a89bdb2fe565a87a4cbf81d885efe1f65963de3105c8dd`.
- 13 of the 14 recorded DT-1 file hashes agree. `SettingsScreen.tsx` now has only the
  approved `id="data"` addition plus Prettier expansion of the existing export button.
  Current hash is `942e352ec181f5f4ebc1a871c606589ddbe2bfe5042104f3779c0512556b02a8`;
  the final freeze must record this actual file rather than the earlier formatting hash.
- Claude's additional recorded checks: lint, app/Worker typecheck, build, scoped
  formatting and Tools/World/Settings E2E **53 passed, 1 expected viewport skip**.
  Codex did not rerun these unchanged broader checks.

Independent logs: `C:/Users/AORUS/AppData/Local/Temp/dashboard-audit-2026-10-16-root/`
(`dt1-vitest.log`, `dt1-e2e.log`, `dt1-e2e.json`, `dt1-browser-results/`).
Browser captures: `tools-ar-phone.jpg` and `tools-en-desktop.jpg` in the same directory.
Observed CSS content widths were 375 and 1265 px (390/1280 viewport minus scrollbar),
with equal scrollWidth/clientWidth and correct RTL/LTR direction.

Waiting only for the planner's owner-none freeze and final hash agreement before
recording ready for user acceptance and transferring ownership for DT-2.

## DT-1 final verdict — ready for user acceptance

The final handoff records **Implementation owner: none**. Independently verified all
**14 final source/test/dictionary hashes match**, including the Settings formatting
correction, and the served Tools export matches the tested build. The independent
139-unit/10-browser results above apply to this exact candidate. All three findings
are closed; no unresolved blocking issue remains in DT-1.

One documentation precision: the handoff's statement that every `unknown` action goes
to Accounts is broader than the implementation. `attention` and `lastKnown` go there;
`unknown` uses the tool's existing setup/page destination. This is acceptable: the
posting/replies pages expose their own checks/setup, while account rows open Accounts.

DT-2 may now be planned and implemented by one Claude writer, following the acceptance
outline in the audit document. This review approves only local DT-1 behavior, not live
provider delivery, deployment, or the separate Discover work.
