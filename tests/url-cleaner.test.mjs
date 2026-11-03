import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanJobUrl } from '../server/url-cleaner.mjs';

test('cleanJobUrl strips Indeed tracking tokens while strictly preserving jk job identifier', () => {
  const dirty = 'https://uk.indeed.com/viewjob?jk=67bdb57bfedf4c87&tk=1k5qkv9cp2k7r001&from=jobi2a_jobmatch-reactivation-en-GB_email&rjptk=1k5qkv8klh2ab800&xpse=SoAC67I2cRcsfVQkn50LbzkdCdPP&xfps=353068bf-52a2-4bfe-99c1-10e98cc76eba&xkcb=SoAt67M2d6hyjCT0rJ0JbzkdCdPP';
  const clean = cleanJobUrl(dirty);
  assert.equal(clean, 'https://uk.indeed.com/viewjob?jk=67bdb57bfedf4c87');
});

test('cleanJobUrl strips Greenhouse gh_src referrer while strictly preserving gh_jid job identifier', () => {
  const dirty = 'https://teachforall.org/jobs-and-graduate-programs/jobs?gh_jid=7727042003&gh_src=h916zlja3us';
  const clean = cleanJobUrl(dirty);
  assert.equal(clean, 'https://teachforall.org/jobs-and-graduate-programs/jobs?gh_jid=7727042003');
});

test('cleanJobUrl strips LinkedIn tracking identifiers, trk, and trailing slash', () => {
  const dirty = 'https://www.linkedin.com/jobs/view/4012345678/?refId=abcdef123&trackingId=xyz987&trk=public_jobs_topcard-title';
  const clean = cleanJobUrl(dirty);
  assert.equal(clean, 'https://www.linkedin.com/jobs/view/4012345678');
});

test('cleanJobUrl strips UTM, Ad IDs, and tracking fragment hashes', () => {
  const dirty = 'https://example.com/careers/lead?utm_source=linkedin&utm_medium=cpc&utm_campaign=hire2026&gclid=abc123click&fbclid=fb456click#utm_term=devops';
  const clean = cleanJobUrl(dirty);
  assert.equal(clean, 'https://example.com/careers/lead');
});

test('cleanJobUrl preserves legitimate routing query parameters', () => {
  const url = 'https://jobs.example.com/view?id=998877&department=engineering';
  const clean = cleanJobUrl(url);
  assert.equal(clean, 'https://jobs.example.com/view?department=engineering&id=998877');
});

test('cleanJobUrl gracefully handles empty, invalid, and non-http inputs', () => {
  assert.equal(cleanJobUrl(''), '');
  assert.equal(cleanJobUrl('   '), '');
  assert.equal(cleanJobUrl(null), '');
  assert.equal(cleanJobUrl(undefined), '');
  assert.equal(cleanJobUrl('just some text'), 'just some text');
  assert.equal(cleanJobUrl('mailto:jobs@example.com'), 'mailto:jobs@example.com');
});
