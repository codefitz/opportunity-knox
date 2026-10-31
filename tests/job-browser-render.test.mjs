import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBrowserExecutable,
  resetBrowserExecutableCache,
  renderJobPageWithBrowser,
  BrowserRenderError,
} from '../server/job-browser-render.mjs';

test('detectBrowserExecutable returns matched browser when runner succeeds', async () => {
  resetBrowserExecutableCache();
  const runner = async (cmd, args) => {
    if (args[0] === '--version') {
      return { stdout: 'Chromium 130.0.6723.69' };
    }
    return { stdout: '' };
  };

  const executable = await detectBrowserExecutable({
    runner,
    candidatePaths: ['chromium', 'google-chrome'],
  });
  assert.equal(executable, 'chromium');
});

test('detectBrowserExecutable returns null when no candidate passes', async () => {
  resetBrowserExecutableCache();
  const runner = async () => {
    throw new Error('command not found');
  };

  const executable = await detectBrowserExecutable({
    runner,
    candidatePaths: ['nonexistent-browser'],
  });
  assert.equal(executable, null);
});

test('renderJobPageWithBrowser renders HTML and sets rendered=true', async () => {
  resetBrowserExecutableCache();
  const runner = async (cmd, args) => {
    if (args[0] === '--version') {
      return { stdout: 'Google Chrome 130.0.0.0' };
    }
    if (args.includes('--dump-dom')) {
      return {
        stdout: '<!doctype html><html><body><h1>Platform Architect</h1><p>Senior role description</p></body></html>',
      };
    }
    return { stdout: '' };
  };

  const result = await renderJobPageWithBrowser('https://jobs.example.test/roles/1', {
    runner,
    browserExecutable: '/usr/bin/chromium',
  });

  assert.equal(result.rendered, true);
  assert.match(result.html, /Platform Architect/);
  assert.equal(result.browser, '/usr/bin/chromium');
});

test('renderJobPageWithBrowser throws JOB_PAGE_JS_REQUIRED when no browser is available', async () => {
  resetBrowserExecutableCache();
  const runner = async () => {
    throw new Error('not found');
  };

  await assert.rejects(
    () => renderJobPageWithBrowser('https://jobs.example.test/roles/1', {
      runner,
      browserExecutable: null,
    }),
    (err) => {
      assert.ok(err instanceof BrowserRenderError);
      assert.equal(err.code, 'JOB_PAGE_JS_REQUIRED');
      assert.match(err.message, /requires JavaScript to render/i);
      return true;
    },
  );
});

test('renderJobPageWithBrowser handles timeouts with 504 TIMEOUT', async () => {
  const runner = async () => {
    const error = new Error('timed out');
    error.killed = true;
    throw error;
  };

  await assert.rejects(
    () => renderJobPageWithBrowser('https://jobs.example.test/roles/1', {
      runner,
      browserExecutable: '/usr/bin/chromium',
    }),
    (err) => {
      assert.ok(err instanceof BrowserRenderError);
      assert.equal(err.code, 'TIMEOUT');
      assert.equal(err.status, 504);
      return true;
    },
  );
});
