const fs = require('fs');
const path = require('path');

function ensureGopdCaseSensitiveEntry() {
    let packagePath;
    try {
        packagePath = require.resolve('gopd/package.json');
    } catch (_error) {
        return;
    }

    const packageDir = path.dirname(packagePath);
    const expectedPath = path.join(packageDir, 'gOPD.js');
    if (fs.existsSync(expectedPath)) return;

    const shim = `'use strict';\n\n/** @type {import('./gOPD')} */\nmodule.exports = Object.getOwnPropertyDescriptor;\n`;
    fs.writeFileSync(expectedPath, shim);
    console.warn('[startup] Repaired missing node_modules/gopd/gOPD.js from a stale dependency cache.');
}

ensureGopdCaseSensitiveEntry();
