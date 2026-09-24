// Wrapper around @lingui/cli's extract command.
//
// Why this exists: @lingui/cli v6 guards its command entrypoints with
// `if (import.meta.main)`, which is only available on Node >= 22.18. On older
// Node versions `lingui extract` exits silently with code 0 and does nothing.
// Importing the command and invoking it directly works on any modern Node.
import { getConfig } from "@lingui/conf";
import command from "../node_modules/@lingui/cli/dist/lingui-extract.js";

const config = getConfig({});
const ok = await command(config, {
  verbose: true,
  clean: process.argv.includes("--clean"),
  overwrite: process.argv.includes("--overwrite"),
  locale: undefined,
  watch: false,
  files: undefined,
  // Disable worker threads (avoids the extra `lingui-extract` shim requirement).
  workersOptions: { poolSize: 0 },
});
if (!ok) process.exit(1);
