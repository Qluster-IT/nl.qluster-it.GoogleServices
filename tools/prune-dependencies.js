'use strict';

// Removes type definitions, source maps, TypeScript sources and docs from production
// dependencies. The Homey CLI packs these from node_modules, but they are never loaded at runtime.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..');
const removable = /(\.d\.[cm]?ts|\.[cm]?ts|\.map|\.md|\.markdown)$/i;

function productionPackages() {
  let stdout;
  try {
    stdout = execSync('npm ls --parseable --all --omit=dev', { cwd: appPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    stdout = error.stdout || '';
  }
  return stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && path.resolve(line) !== appPath);
}

function prune(dir, stats) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      prune(file, stats);
    } else if (entry.isFile() && removable.test(entry.name)) {
      stats.bytes += fs.statSync(file).size;
      stats.files += 1;
      fs.unlinkSync(file);
    }
  }
}

const pkg = require(path.join(appPath, 'package.json'));
// Direct devDependencies (such as @types/node) are kept so editor tooling keeps working.
const keep = new Set(Object.keys(pkg.devDependencies || {}).map((name) => path.join(appPath, 'node_modules', name)));
const stats = { files: 0, bytes: 0 };

for (const dir of productionPackages()) {
  if (keep.has(path.resolve(dir)) || !fs.existsSync(dir)) continue;
  prune(dir, stats);
}

console.log(`Pruned ${stats.files} non-runtime files (${(stats.bytes / 1048576).toFixed(1)} MB) from production dependencies.`);
