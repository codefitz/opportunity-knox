import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  sortOpportunities,
} from '../src/lib/opportunity-columns.ts';

const oppA = {
  id: '1',
  role: 'Architect',
  company: 'Beta Corp',
  stage: 'identification',
  workMode: 'Remote',
  salary: '£80,000',
  deadline: '2026-12-01',
  datePosted: '2026-10-01',
  applicantCount: '10 applicants',
  priority: 'high',
  nextAction: 'Review JD',
  nextActionDate: '2026-11-10',
  applicationRoute: 'LinkedIn Easy Apply',
  tags: [],
  url: '',
  location: 'London',
  jobReference: '',
  employmentType: 'Full-time',
  contact: '',
  description: '',
  outcome: '',
  revision: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  stageEnteredAt: '2026-10-01T00:00:00Z',
};

const oppB = {
  ...oppA,
  id: '2',
  role: 'Developer',
  company: 'Alpha Corp',
  stage: 'submitted',
  workMode: 'Hybrid',
  salary: '£60,000',
  deadline: '2026-11-15',
  datePosted: '2026-10-15',
  applicantCount: '50 applicants',
  priority: 'low',
  nextAction: 'Prepare interview',
  nextActionDate: '2026-11-05',
  applicationRoute: 'Company Website',
  location: 'Manchester',
};

test('AVAILABLE_COLUMNS contains valid definitions with opportunity pinned', () => {
  assert.ok(AVAILABLE_COLUMNS.length >= 10);
  const oppCol = AVAILABLE_COLUMNS.find((c) => c.id === 'opportunity');
  assert.ok(oppCol);
  assert.equal(oppCol.required, true);
  assert.ok(DEFAULT_VISIBLE_COLUMNS.includes('opportunity'));
  assert.ok(DEFAULT_VISIBLE_COLUMNS.includes('stage'));
  assert.ok(DEFAULT_VISIBLE_COLUMNS.includes('salary'));
});

test('sortOpportunities sorts by role and company', () => {
  const sortedAsc = sortOpportunities([oppB, oppA], { column: 'opportunity', direction: 'asc' });
  assert.equal(sortedAsc[0].id, '1'); // Architect before Developer

  const sortedDesc = sortOpportunities([oppB, oppA], { column: 'opportunity', direction: 'desc' });
  assert.equal(sortedDesc[0].id, '2'); // Developer before Architect
});

test('sortOpportunities sorts by company', () => {
  const sortedAsc = sortOpportunities([oppA, oppB], { column: 'company', direction: 'asc' });
  assert.equal(sortedAsc[0].id, '2'); // Alpha before Beta

  const sortedDesc = sortOpportunities([oppA, oppB], { column: 'company', direction: 'desc' });
  assert.equal(sortedDesc[0].id, '1'); // Beta before Alpha
});

test('sortOpportunities sorts by stage progression', () => {
  const sortedAsc = sortOpportunities([oppB, oppA], { column: 'stage', direction: 'asc' });
  assert.equal(sortedAsc[0].id, '1'); // identification before submitted

  const sortedDesc = sortOpportunities([oppB, oppA], { column: 'stage', direction: 'desc' });
  assert.equal(sortedDesc[0].id, '2'); // submitted after identification
});

test('sortOpportunities sorts by priority (high > normal > low)', () => {
  const sortedDesc = sortOpportunities([oppB, oppA], { column: 'priority', direction: 'desc' });
  assert.equal(sortedDesc[0].id, '1'); // high before low
});

test('sortOpportunities sorts by deadline date', () => {
  const sortedAsc = sortOpportunities([oppA, oppB], { column: 'deadline', direction: 'asc' });
  assert.equal(sortedAsc[0].id, '2'); // 2026-11-15 before 2026-12-01
});
