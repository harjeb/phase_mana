// The hosted-room check owns an isolated local API and native engine, so it
// never stops a room or alters a game in the developer's running application.
// Requires: npm run dev, npm run host:build, and a built server debug binary.
import './tools/waiting-room-smoke.mjs';
