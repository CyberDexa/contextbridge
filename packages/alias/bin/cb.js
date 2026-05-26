#!/usr/bin/env node
// Thin proxy — delegates to the real @cyberdexa/contextbridge-cli bundle.
// Node.js treats the shebang line as a comment in CJS, so require() works fine.
require('@cyberdexa/contextbridge-cli');
