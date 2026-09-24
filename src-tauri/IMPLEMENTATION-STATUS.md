# Desktop verification and remaining limits

Validated on Windows x64 using the repository's Rust toolchain and WebView2:

- `npm run build:web`: passed (TypeScript and production Vite build), including the bundled ManaBrew desktop boot screen.
- `npm run test:startup`: 3 tests passed (Vite port fallback, endpoint discovery and live proxy changes).
- Server `cargo check` and full `cargo test`: passed, 44 tests in the previous verification (before sibling Phase moved to v0.92.0).
- Desktop `cargo check` and `cargo test`: passed, 4 helper tests with the new auto-boot flow, including replacing an existing cache via `tokio::fs::rename` on Windows.
- `npm run build:app`: passed against sibling Phase v0.92.0. The current frontend, release sidecar, and Tauri shell produced both NSIS EXE and MSI installers under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`. The first cold build timed out while compiling the Phase v0.92.0 server; the incremental retry completed successfully.
- `node tools/native-gateway-smoke.mjs`: passed previously, with 3001 and 1420 occupied. Observed API 3003 and frontend 1421; checked API proxy, static files/404, cross-origin denial, card-image save/read and traversal rejection.
- `node tools/tauri-smoke.mjs`: passed with the new bundled ManaBrew auto-boot and an app-managed cached fixture against the freshly staged Phase v0.92.0 sidecar. It reached onboarding at port 1421 and closing the shell terminated the owned backend. The smoke checks that the loopback page cannot invoke desktop boot. The test temporarily enables CDP for its child process only; shipped apps do not enable a debug port. It restores any existing cached database afterward.

The first release compile had a Windows DLL initialization failure; retry compiled successfully. Packaging initially lacked an explicit ICO config entry; the configuration now includes the generated PNG and ICO icons, and both installer formats built successfully.

Not yet verified: a full official MTGJSON download and retry after network failure, installation/uninstallation, and Linux/macOS packaging. Download resume and an independent checksum/signature are not implemented. Native desktop does not implement the optional Scryfall SQLite cache route; it uses HTTPS/local card images. Optional draft pools and ManaBrew UI resources must be prepared before building to include them. The interactive smoke uses the small Phase fixture, not a full gameplay regression suite or a guarantee that every card works.

Binaries/installers are ignored build outputs, not committed source.
