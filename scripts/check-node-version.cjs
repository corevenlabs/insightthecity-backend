// Keep CI/build/runtime on the reviewed security patch in .nvmrc.
const fs = require('node:fs');
const path = require('node:path');
const expected = fs.readFileSync(path.join(__dirname, '..', '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const [major, minor, patch] = expected.split('.').map(Number);
if (major !== 22 || !(minor > 23 || (minor === 23 && patch >= 4)) || process.versions.node !== expected) {
  console.error(`Use patched Node.js ${expected}; current runtime is ${process.versions.node}.`);
  process.exit(1);
}
console.log(`Verified patched Node.js ${process.versions.node}`);
