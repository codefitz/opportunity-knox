import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/WorkspaceSections.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const module = { exports: {} };
new Function('require', 'exports', compiled)(createRequire(import.meta.url), module.exports);
const WorkspaceSections = module.exports.default;

test('workspace sections support deep links, safe fallback and mounted inactive drafts', () => {
  const previous = globalThis.window;
  try {
    for (const [query, selected] of [['', 'profile'], ['?section=storage', 'storage'], ['?section=missing', 'profile']]) {
      globalThis.window = { location: { hash: '#/settings' + query } };
      const markup = renderToStaticMarkup(createElement(WorkspaceSections, {
        label: 'Settings sections', sections: [
          { id: 'profile', label: 'Profile', content: createElement('input', { defaultValue: 'Unsaved profile' }) },
          { id: 'storage', label: 'Storage', content: 'Storage controls' },
        ],
      }));
      assert.match(markup, new RegExp(`href="#/settings\\?section=${selected}" aria-current="page"`));
      assert.equal((markup.match(/ hidden=""/g) || []).length, 1);
      assert.match(markup, /value="Unsaved profile"/);
      assert.match(markup, /Storage controls/);
    }
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
