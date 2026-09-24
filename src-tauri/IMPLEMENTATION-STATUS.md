# Desktop verification and remaining limits

Validated on Windows x64 using the repository's Rust toolchain and WebView2:

- `npm run build:web`: passed (TypeScript and production Vite build).
- `npm run test:startup`: 3 tests passed (Vite port fallback, endpoint discovery and live proxy changes).
- Server `cargo check` and full `cargo test`: passed, 44 tests.
- Desktop `cargo check` and `cargo test`: passed, 3 helper tests.
- Release server staging and Tauri release build: completed. Both NSIS EXE and MSI installers generated under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`.
- `node tools/native-gateway-smoke.mjs`: passed, with 3001 and 1420 occupied. Observed API 3003 and frontend 1421; checked API proxy, static files/404, cross-origin denial, card-image save/read and traversal rejection.
- `node tools/tauri-smoke.mjs`: passed using actual WebView2. Bundled setup IPC started the sidecar with the local fixture; frontend reached onboarding at port 1421. Closing the test shell terminated its owned backend. This opt-in test temporarily enables CDP for its child process only; shipped apps do not enable a debug port. Saved database preferences are restored afterward.

The first release compile had a Windows DLL initialization failure; retry compiled successfully. Packaging initially lacked an explicit ICO config entry; the configuration now includes the generated PNG and ICO icons, and both installer formats built successfully.

Not yet verified: interactive native file/folder dialogs, a full official MTGJSON download, running the installers through installation/uninstallation, and Linux/macOS packaging. Database-download errors and retry UI exist, but download resume and an independent checksum/signature are not implemented. Native desktop does not implement the optional Scryfall SQLite cache route; it uses HTTPS/local card images. Optional draft pools and ManaBrew UI resources must be prepared before building to include them. This verification uses the small Phase fixture, not a full gameplay regression suite or a guarantee that every card works.

Binaries/installers are ignored build outputs, not committed source.
