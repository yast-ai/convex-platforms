# Walkthrough

[Watch the 90-second walkthrough](walkthrough.mp4). 1920×1080, 30 fps, silent with readable explanatory text.

The provider setup scenes are labeled diagrams. They are not account/dashboard recordings, and the illustrative commands do not claim a live deployment. Real dashboard stills are linked in the [onboarding guide](../docs/onboarding.md). The new-team setup recording and authenticated ChatGPT/Claude host verification remain pending.

The editable HyperFrames source lives in `walkthrough-source/`. Run its pinned package scripts to check or render. Fonts are redistributed under their included OFL licenses. The local GSAP runtime carries its copyright header and upstream README/license link. Video and its source are excluded from the npm package.

## Setup tour

[Watch the 72-second setup tour](setup-tour.mp4). It is silent, 1920×1080 at 30 fps, and has an editable HyperFrames project in `setup-tour-source/`.

Its source credits and evidence labels are deliberate:

- `new-team-setup-illustration.png` is an AI-generated **setup illustration**, copied from `docs/assets/`; it is never presented as a dashboard capture. Its prompt provenance is in `docs/assets/README.md`.
- `workos-connect-dashboard.jpg` and `convex-auth-dashboard.jpg` are **actual dashboard stills** from the configured demo, copied from `docs/assets/`. They document visible configuration only and do not prove a separate account, host installation, or QA state.
- `mcp-app-mock.jpg` is a **local UI mock** from `docs/assets/`, not a ChatGPT, Codex, or Claude installation.
- The local commands are source examples. The tour does not include credentials, the blocked QA-admin screen, or an Active-badge claim.

Run `bun run check` and `bun run render -- --quality high --output ../setup-tour.mp4` from `setup-tour-source/`. The bundled IBM Plex font license files and GSAP copyright header are retained under that source directory.
