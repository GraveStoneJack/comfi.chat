const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const checks = [
    { request: 'gopd/gOPD', packageName: 'gopd' },
    { request: 'mongoose/lib/drivers/node-mongodb-native/bulkWriteResult', packageName: 'mongoose' },
    { request: 'mongodb/lib/cursor/explainable_cursor', packageName: 'mongodb' },
    { request: 'express', packageName: 'express' },
    { request: 'qs', packageName: 'qs' }
];

function findMissingRuntimeDependency() {
    for (const check of checks) {
        try {
            require.resolve(check.request);
        } catch (_error) {
            return check;
        }
    }
    return null;
}

function packageRoot(packageName) {
    try {
        return path.dirname(require.resolve(`${packageName}/package.json`));
    } catch (_error) {
        return null;
    }
}

function removePackage(packageName) {
    const root = packageRoot(packageName);
    if (!root) return;
    fs.rmSync(root, { recursive: true, force: true });
    console.warn(`[install] Removed damaged package directory: ${packageName}`);
}

const missing = findMissingRuntimeDependency();
if (missing) {
    console.warn(`[install] Missing runtime dependency file "${missing.request}". Reifying node_modules from package-lock.json.`);
    for (const packageName of new Set(checks.map(check => check.packageName))) {
        removePackage(packageName);
    }
    fs.rmSync(path.join(process.cwd(), 'node_modules', '.package-lock.json'), { force: true });
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online', '--force'], {
        stdio: 'inherit'
    });
}
