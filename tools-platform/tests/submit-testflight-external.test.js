const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareBuildsAscending,
  cleanupSupersededWaitingBuilds
} = require('../scripts/submit-testflight-external');

test('compareBuildsAscending orders numeric build numbers and uploaded dates deterministically', () => {
  const b727 = { id: 'id_727', attributes: { version: '727', uploadedDate: '2026-11-16T10:00:00Z' } };
  const b729 = { id: 'id_729', attributes: { version: '729', uploadedDate: '2026-11-16T12:00:00Z' } };
  const b731 = { id: 'id_731', attributes: { version: '731', uploadedDate: '2026-11-16T14:00:00Z' } };
  assert.ok(compareBuildsAscending(b727, b729) < 0);
  assert.ok(compareBuildsAscending(b729, b731) < 0);
  assert.ok(compareBuildsAscending(b731, b727) > 0);
});

test('cleanupSupersededWaitingBuilds proactively unlinks from G2 and expires older WAITING_FOR_REVIEW builds across different versions while keeping APPROVED builds alive', async () => {
  const targetBuild = { id: 'b731', attributes: { version: '731', processingState: 'VALID', uploadedDate: '2026-11-16T14:00:00Z', expired: false } };
  const activeBuilds = [
    targetBuild,
    { id: 'b729', attributes: { version: '729', processingState: 'VALID', uploadedDate: '2026-11-16T12:00:00Z', expired: false } },
    { id: 'b727', attributes: { version: '727', processingState: 'VALID', uploadedDate: '2026-11-16T10:00:00Z', expired: false } },
    { id: 'b720', attributes: { version: '720', processingState: 'VALID', uploadedDate: '2026-11-15T10:00:00Z', expired: false } }
  ];
  const reviewStates = {
    b729: 'WAITING_FOR_REVIEW',
    b727: 'WAITING_FOR_REVIEW',
    b720: 'APPROVED'
  };
  const calls = [];
  const mockRequest = async (endpoint, _token, options = {}) => {
    calls.push({ endpoint, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (endpoint.startsWith('/v1/builds?')) {
      return { ok: true, status: 200, data: { data: activeBuilds } };
    }
    const subMatch = endpoint.match(/^\/v1\/builds\/([^/]+)\/betaAppReviewSubmission$/);
    if (subMatch) {
      const id = subMatch[1];
      return { ok: true, status: 200, data: { data: { id: `sub_${id}`, attributes: { betaReviewState: reviewStates[id] } } } };
    }
    return { ok: true, status: 200, data: {} };
  };

  const result = await cleanupSupersededWaitingBuilds({
    appId: 'app_1',
    targetBuild,
    g2GroupId: 'group_g2',
    token: 'tok',
    request: mockRequest
  });

  assert.equal(result.hasNewerBuild, false);
  assert.deepEqual(result.expiredIds, ['b729', 'b727']);

  // Both 729 and 727 were unlinked from G2 and expired; approved 720 and target 731 untouched.
  const deletedFromG2 = calls.filter(c => c.method === 'DELETE' && c.endpoint === '/v1/betaGroups/group_g2/relationships/builds')
    .flatMap(c => c.body.data.map(d => d.id));
  assert.deepEqual(deletedFromG2, ['b729', 'b727']);

  const patchedExpired = calls.filter(c => c.method === 'PATCH').map(c => c.body.data);
  assert.deepEqual(patchedExpired, [
    { type: 'builds', id: 'b729', attributes: { expired: true } },
    { type: 'builds', id: 'b727', attributes: { expired: true } }
  ]);
});

test('cleanupSupersededWaitingBuilds aborts if a newer VALID build already exists in App Store Connect', async () => {
  const olderBuild = { id: 'b729', attributes: { version: '729', processingState: 'VALID', uploadedDate: '2026-11-16T12:00:00Z', expired: false } };
  const newerBuild = { id: 'b731', attributes: { version: '731', processingState: 'VALID', uploadedDate: '2026-11-16T14:00:00Z', expired: false } };
  const calls = [];
  const result = await cleanupSupersededWaitingBuilds({
    appId: 'app_1',
    targetBuild: olderBuild,
    g2GroupId: 'group_g2',
    token: 'tok',
    request: async (endpoint, _token, options = {}) => {
      calls.push({ endpoint, method: options.method || 'GET' });
      return { ok: true, status: 200, data: { data: [newerBuild, olderBuild] } };
    }
  });
  assert.equal(result.hasNewerBuild, true);
  assert.deepEqual(result.expiredIds, []);
  assert.equal(calls.length, 1, 'should not unlink or expire anything when target build is already stale');
});
