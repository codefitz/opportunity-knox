import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createUpdateChecker, isNewerVersion } from '../server/update-checker.mjs';

const source = readFileSync(new URL('../src/components/BuildVersion.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const module = { exports: {} };
new Function('require', 'exports', compiled)(createRequire(import.meta.url), module.exports);
const BuildVersion = module.exports.default;

test('installed build identifies development source, commit and local edits; links track latest release', () => {
  const commit = 'a'.repeat(40);
  const checker = createUpdateChecker({buildCommit: commit, buildDirty: true});
  const status = checker.getStatusSync();
  assert.equal(status.currentCommit, commit);
  assert.equal(status.buildDirty, true);
  const html = renderToStaticMarkup(createElement(BuildVersion, {status}));
  assert.match(html, /v0\.4\.7-dev\.0 \(development\)/);
  assert.match(html, new RegExp(`href="https://github.com/codefitz/opportunity-knox/commit/${commit}"`));
  assert.match(html, /<code>aaaaaaa<\/code>/);
  assert.match(html, /\+ local changes/);
  assert.match(html, /href="https:\/\/github.com\/codefitz\/opportunity-knox\/releases\/latest"/);
  const released = renderToStaticMarkup(createElement(BuildVersion, {status:{currentVersion:'0.4.6'}}));
  assert.match(released, /\(release\)/);
  assert.match(released, /Commit not recorded/);
  assert.doesNotMatch(released, /\/commit\/|local changes/);
  assert.equal(isNewerVersion('0.4.7-dev.0', '0.4.6'), false);
  assert.equal(isNewerVersion('0.4.7-dev.0', '0.4.7'), true);
  assert.equal(isNewerVersion('0.4.7', '0.4.7-dev.0'), false);
});
