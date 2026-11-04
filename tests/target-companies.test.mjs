import test from 'node:test';
import assert from 'node:assert/strict';
import { createTargetCompanies } from '../server/target-companies.mjs';

test('createTargetCompanies manages wishlist lifecycle: create, list, update, remove', () => {
  let stored = {};
  const getConfig = (k) => stored[k];
  const putConfig = (k, v) => { stored[k] = v; };

  const targets = createTargetCompanies({ getConfig, putConfig });

  assert.deepEqual(targets.list(), []);

  // Create
  const created = targets.create({
    name: 'Anthropic',
    targetRoles: 'Member of Technical Staff, Research Engineer',
    tier: 'dream',
    status: 'watching',
    careersUrl: 'https://anthropic.com/careers',
    notes: 'Focus on model reliability and safety engineering.',
  });

  assert.ok(created.id);
  assert.equal(created.name, 'Anthropic');
  assert.equal(created.tier, 'dream');
  assert.equal(created.status, 'watching');
  assert.equal(targets.list().length, 1);

  // Update
  const updated = targets.update(created.id, {
    status: 'reached-out',
    notes: 'Contacted team via referral on LinkedIn.',
  });

  assert.equal(updated.status, 'reached-out');
  assert.match(updated.notes, /referral on LinkedIn/);

  // Remove
  const result = targets.remove(created.id);
  assert.equal(result.deleted, true);
  assert.equal(targets.list().length, 0);
});

test('createTargetCompanies validates required company name', () => {
  let stored = {};
  const targets = createTargetCompanies({ getConfig: (k) => stored[k], putConfig: (k, v) => { stored[k] = v; } });

  assert.throws(
    () => targets.create({ name: '   ' }),
    (err) => err.status === 400 && /Company name is required/.test(err.message),
  );
});
