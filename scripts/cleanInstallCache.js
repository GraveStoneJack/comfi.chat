const fs = require('fs');
const path = require('path');

const packagesToRehydrate = [
    'express',
    'qs',
    'gopd',
    'get-intrinsic',
    'side-channel',
    'side-channel-map',
    'mongoose',
    'mongodb'
];

const nodeModulesDir = path.join(process.cwd(), 'node_modules');

if (fs.existsSync(nodeModulesDir)) {
    for (const packageName of packagesToRehydrate) {
        const packageDir = path.join(nodeModulesDir, packageName);
        if (fs.existsSync(packageDir)) {
            fs.rmSync(packageDir, { recursive: true, force: true });
            console.warn(`[install] Removed cached ${packageName}; npm will rehydrate it.`);
        }
    }

    fs.rmSync(path.join(nodeModulesDir, '.package-lock.json'), { force: true });
}
