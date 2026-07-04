// Plain JS (not .ts) so jest can parse the config without needing ts-node,
// which isn't hoisted to the workspace root.
const { nestConfig } = require('@repo/jest-config');

module.exports = nestConfig;
