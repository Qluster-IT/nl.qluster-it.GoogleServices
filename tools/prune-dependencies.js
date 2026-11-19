'use strict';

// Removes files from production dependencies that are never loaded at runtime: type definitions,
// source maps, TypeScript sources, docs, minified browser bundles, examples and tests. The Homey
// CLI packs node_modules regardless of .homeyignore, so these would otherwise ship with the app.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..');
const removableFile = /(\.d\.[cm]?ts|\.[cm]?ts|\.map|\.md|\.markdown|\.min\.[cm]?js)$/i;
const removableDir = new Set(['example', 'examples', 'test', 'tests', '__tests__']);

// Verified unused by this app: browser bundles, the protobufjs CLI, XML samples, and the generated
// protos.js files that are only loaded through the package roots (the app loads the v1/v3 clients).
const appSpecific = [
  'node-forge/dist',
  'protobufjs/dist',
  'protobufjs/cli',
  'xml2js/canon.xml',
  'xml2js/text.xml',
  '@google-cloud/text-to-speech/build/protos/protos.js',
  '@google-cloud/translate/build/protos/protos.js',
];

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

function entryFiles(dir) {
  const entries = new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const add = (value) => {
      if (typeof value === 'string') entries.add(path.resolve(dir, value));
      else if (value && typeof value === 'object') Object.values(value).forEach(add);
    };
    add(pkg.main || 'index.js');
    add(pkg.exports);
  } catch (_) { /* no package.json */ }
  return entries;
}

function size(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1 };
  return fs.readdirSync(target).reduce((total, name) => {
    const child = size(path.join(target, name));
    return { bytes: total.bytes + child.bytes, files: total.files + child.files };
  }, { bytes: 0, files: 0 });
}

function remove(target, stats) {
  const removed = size(target);
  stats.bytes += removed.bytes;
  stats.files += removed.files;
  fs.rmSync(target, { recursive: true, force: true });
}

function prune(dir, entries, stats) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (removableDir.has(entry.name.toLowerCase()) && ![...entries].some((file) => file.startsWith(target + path.sep))) remove(target, stats);
      else prune(target, entries, stats);
    } else if (entry.isFile() && removableFile.test(entry.name) && !entries.has(target)) {
      remove(target, stats);
    }
  }
}

const stats = { files: 0, bytes: 0 };
for (const dir of productionPackages()) {
  if (fs.existsSync(dir)) prune(dir, entryFiles(dir), stats);
}
for (const relative of appSpecific) {
  const target = path.join(appPath, 'node_modules', ...relative.split('/'));
  if (fs.existsSync(target)) remove(target, stats);
}

console.log(`Pruned ${stats.files} non-runtime files (${(stats.bytes / 1048576).toFixed(1)} MB) from production dependencies.`);
