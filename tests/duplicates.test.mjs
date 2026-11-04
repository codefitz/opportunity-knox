import test from 'node:test';
import assert from 'node:assert/strict';
import { areDuplicates, findDuplicateMap, findExistingDuplicate } from '../src/lib/duplicates.ts';

test('areDuplicates matches identical canonical URLs ignoring tracking parameters', () => {
  const a = { url: 'https://uk.indeed.com/viewjob?jk=12345&utm_source=email' };
  const b = { url: 'https://uk.indeed.com/viewjob?jk=12345&tk=token999&from=alert' };
  assert.equal(areDuplicates(a, b), true);

  const c = { url: 'https://uk.indeed.com/viewjob?jk=67890' };
  assert.equal(areDuplicates(a, c), false);
});

test('areDuplicates matches normalized Company and Role title', () => {
  const a = { company: 'Google Inc.', role: 'Senior Software Engineer' };
  const b = { company: 'google inc', role: 'senior software engineer' };
  assert.equal(areDuplicates(a, b), true);

  const c = { company: 'Google Inc', role: 'Staff Software Engineer' };
  assert.equal(areDuplicates(a, c), false);
});

test('findDuplicateMap maps two-way duplicates across an opportunity list', () => {
  const opps = [
    { id: '1', role: 'Architect', company: 'Acme Corp', url: 'https://example.com/job/1?utm=a' },
    { id: '2', role: 'Architect', company: 'Acme Corp', url: 'https://example.com/job/1?utm=b' },
    { id: '3', role: 'Designer', company: 'Acme Corp', url: 'https://example.com/job/2' },
  ];

  const map = findDuplicateMap(opps);
  assert.equal(map.get('1')?.length, 1);
  assert.equal(map.get('1')?.[0].id, '2');
  assert.equal(map.get('2')?.length, 1);
  assert.equal(map.get('2')?.[0].id, '1');
  assert.equal(map.has('3'), false);
});

test('findExistingDuplicate returns matching opportunity if duplicate exists', () => {
  const existing = [
    { id: '1', role: 'Principal Architect', company: 'Stripe', url: 'https://stripe.com/jobs/1' },
  ];

  const match = findExistingDuplicate(
    { role: 'Principal Architect', company: 'stripe', url: 'https://stripe.com/jobs/1?trk=123' },
    existing,
  );
  assert.ok(match);
  assert.equal(match.id, '1');

  const noMatch = findExistingDuplicate(
    { role: 'Staff Architect', company: 'stripe', url: 'https://stripe.com/jobs/2' },
    existing,
  );
  assert.equal(noMatch, null);
});
