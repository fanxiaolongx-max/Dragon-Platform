#!/usr/bin/env node

/**
 * submit-testflight-external.js
 *
 * Automatically monitors the uploaded iOS build in App Store Connect,
 * waits for Apple backend processing (PROCESSING -> VALID),
 * attaches the build to external beta testing group 'G2',
 * populates the release notes (whatsNew),
 * and automatically submits for Beta App Review.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input));
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJwt(keyId, issuerId, privateKeyPem) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    exp: Math.floor(Date.now() / 1000) + 1200, // 20 minutes
    aud: 'appstoreconnect-v1'
  };

  const signInput = `${base64url(header)}.${base64url(payload)}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signInput);
  signer.end();
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signInput}.${base64url(signature)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(endpoint, token, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.appstoreconnect.apple.com${endpoint}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  return {
    ok: res.ok,
    status: res.status,
    data: json,
    rawText: text
  };
}

function getWhatsNewText() {
  try {
    const releaseNotesPath = path.resolve(__dirname, '../frontend/assets/release-notes.json');
    if (fs.existsSync(releaseNotesPath)) {
      const data = JSON.parse(fs.readFileSync(releaseNotesPath, 'utf8'));
      if (Array.isArray(data.zh) && data.zh.length > 0) {
        return data.zh.join('\n');
      }
    }
  } catch (err) {
    console.warn('[TestFlightAuto] Could not parse release-notes.json:', err.message);
  }
  return '常规性能优化与体验改进，支持移动端会话列表置顶及跨设备实时云同步。';
}

function parseBuildVersionNumber(build) {
  const raw = String(build?.attributes?.version || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) ? num : null;
}

function compareBuildsAscending(a, b) {
  const numA = parseBuildVersionNumber(a);
  const numB = parseBuildVersionNumber(b);
  if (numA !== null && numB !== null && numA !== numB) {
    return numA - numB;
  }
  const timeA = Date.parse(a?.attributes?.uploadedDate || '') || 0;
  const timeB = Date.parse(b?.attributes?.uploadedDate || '') || 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Proactively unlinks (from external group G2) and expires older non-expired builds
 * that are still WAITING_FOR_REVIEW, so multiple versions (e.g. 1.0.638, 1.0.639, 1.0.640)
 * never stack in Apple's "Waiting for Review" queue simultaneously.
 * Returns { hasNewerBuild: boolean, expiredIds: string[] }.
 */
async function cleanupSupersededWaitingBuilds({
  appId,
  targetBuild,
  g2GroupId = null,
  token,
  request = apiRequest
}) {
  const expiredIds = [];
  const buildsRes = await request(
    `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[expired]=false&sort=-uploadedDate&limit=50`,
    token
  );
  if (!buildsRes.ok || !Array.isArray(buildsRes.data?.data)) {
    return { hasNewerBuild: false, expiredIds };
  }

  const activeBuilds = buildsRes.data.data;
  const targetId = targetBuild.id;

  const newerBuild = activeBuilds.find(b =>
    b.id !== targetId &&
    b.attributes?.processingState === 'VALID' &&
    compareBuildsAscending(targetBuild, b) < 0
  );
  if (newerBuild) {
    return { hasNewerBuild: true, newerBuild, expiredIds };
  }

  for (const oldBuild of activeBuilds) {
    if (oldBuild.id === targetId) continue;
    if (oldBuild.attributes?.expired) continue;
    if (compareBuildsAscending(oldBuild, targetBuild) >= 0) continue;

    const subRes = await request(`/v1/builds/${oldBuild.id}/betaAppReviewSubmission`, token);
    const sub = subRes.data?.data;
    const reviewState = sub?.attributes?.betaReviewState;
    if (reviewState !== 'WAITING_FOR_REVIEW') {
      continue;
    }

    console.log(
      `[TestFlightAuto] Found superseded waiting build ${oldBuild.attributes?.version} (${oldBuild.id}). Removing from G2 & expiring...`
    );

    if (g2GroupId) {
      await request(`/v1/betaGroups/${g2GroupId}/relationships/builds`, token, {
        method: 'DELETE',
        body: JSON.stringify({ data: [{ type: 'builds', id: oldBuild.id }] })
      });
    }

    const expRes = await request(`/v1/builds/${oldBuild.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        data: {
          type: 'builds',
          id: oldBuild.id,
          attributes: { expired: true }
        }
      })
    });
    if (expRes.ok) {
      expiredIds.push(oldBuild.id);
      console.log(`[TestFlightAuto] -> Expired older waiting Build ${oldBuild.attributes?.version}.`);
    } else {
      console.warn(`[TestFlightAuto] Failed to expire older Build ${oldBuild.attributes?.version}: ${expRes.status} ${expRes.rawText}`);
    }
  }

  return { hasNewerBuild: false, expiredIds };
}

async function main() {
  console.log('=== [TestFlightAuto] Starting automated G2 external distribution & review submission ===');

  const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const bundleId = process.env.APP_BUNDLE_ID || 'com.fanxiaolong.newapp888';
  const targetGroupName = (process.env.TEST_GROUP_NAME || 'G2').trim().toLowerCase();
  const buildNumber = String(process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '').trim();

  let keyPath = process.env.APP_STORE_CONNECT_KEY_FILE;
  if (!keyPath || !fs.existsSync(keyPath)) {
    const defaultPath = path.join(os.homedir(), '.private_keys', `AuthKey_${keyId}.p8`);
    const altPath = path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`);
    if (fs.existsSync(defaultPath)) {
      keyPath = defaultPath;
    } else if (fs.existsSync(altPath)) {
      keyPath = altPath;
    }
  }

  if (!keyId || !issuerId || !keyPath || !fs.existsSync(keyPath)) {
    console.log('[TestFlightAuto] Missing App Store Connect API credentials. Skipping automated distribution.');
    return;
  }

  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const token = createJwt(keyId, issuerId, privateKeyPem);

  // 1. Locate App ID
  console.log(`[TestFlightAuto] Locating App in App Store Connect with bundleId: ${bundleId}...`);
  const appsRes = await apiRequest(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, token);
  if (!appsRes.ok || !appsRes.data?.data?.[0]?.id) {
    console.warn(`[TestFlightAuto] App with bundleId ${bundleId} not found in App Store Connect.`);
    return;
  }
  const appId = appsRes.data.data[0].id;
  console.log(`[TestFlightAuto] Found App: ID ${appId}`);

  // 2. Poll for the Build to complete processing (PROCESSING -> VALID)
  console.log(`[TestFlightAuto] Monitoring build (Build Number: ${buildNumber || 'latest'})...`);
  let targetBuild = null;
  const maxAttempts = 36; // 36 * 25s = ~15 minutes
  const pollIntervalMs = 25000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const buildsEndpoint = buildNumber
      ? `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}&sort=-uploadedDate&limit=3`
      : `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=1`;

    const buildsRes = await apiRequest(buildsEndpoint, token);
    if (buildsRes.ok && buildsRes.data?.data?.length > 0) {
      const build = buildsRes.data.data[0];
      const state = build.attributes?.processingState;
      console.log(`[TestFlightAuto] [Attempt ${attempt}/${maxAttempts}] Build ${build.attributes?.version} state: ${state}`);

      if (state === 'VALID') {
        targetBuild = build;
        break;
      } else if (state === 'FAILED' || state === 'INVALID') {
        console.warn(`[TestFlightAuto] Build processing failed in Apple backend (state: ${state}).`);
        return;
      }
    } else {
      console.log(`[TestFlightAuto] [Attempt ${attempt}/${maxAttempts}] Build not yet visible in App Store Connect API. Waiting...`);
    }

    if (attempt < maxAttempts) {
      await sleep(pollIntervalMs);
    }
  }

  if (!targetBuild) {
    console.warn('[TestFlightAuto] Timed out waiting for build to become VALID. It may still be processing in Apple backend.');
    console.log('[TestFlightAuto] TestFlight will still automatically distribute to Internal Testers (G1) once processing finishes.');
    return;
  }

  const buildId = targetBuild.id;
  console.log(`[TestFlightAuto] Build ${targetBuild.attributes?.version} (ID: ${buildId}) is VALID and ready!`);

  // 3. Find Beta Groups (G1 internal & G2 external)
  console.log(`[TestFlightAuto] Fetching Beta Groups for App ${appId}...`);
  const groupsRes = await apiRequest(`/v1/apps/${appId}/betaGroups?limit=50`, token);
  if (!groupsRes.ok || !groupsRes.data?.data) {
    console.warn('[TestFlightAuto] Failed to fetch beta groups:', groupsRes.rawText);
    return;
  }

  const groups = groupsRes.data.data;
  console.log(`[TestFlightAuto] Available beta groups: ${groups.map(g => `${g.attributes?.name} (Internal: ${g.attributes?.isInternalGroup})`).join(', ')}`);

  const g1Group = groups.find(g => (g.attributes?.name || '').trim().toLowerCase() === 'g1' || g.attributes?.isInternalGroup);
  const g2Group = groups.find(g => (g.attributes?.name || '').trim().toLowerCase() === targetGroupName);

  // 4. Proactively expire superseded WAITING_FOR_REVIEW builds BEFORE linking G2 or submitting.
  // Apple permits concurrent submissions across different marketing versions (1.0.638, 1.0.639, 1.0.640)
  // without throwing 422 SUBMISSION_LIMIT_REACHED, so cleanup cannot be gated on HTTP 422.
  try {
    const cleanup = await cleanupSupersededWaitingBuilds({
      appId,
      targetBuild,
      g2GroupId: g2Group?.id || null,
      token
    });
    if (cleanup.hasNewerBuild) {
      console.log(
        `[TestFlightAuto] Newer valid Build ${cleanup.newerBuild?.attributes?.version} already exists. Skipping stale G2 review submission for Build ${targetBuild.attributes?.version}.`
      );
      return;
    }
  } catch (cleanupErr) {
    console.warn('[TestFlightAuto] Warning during proactive older waiting build cleanup:', cleanupErr.message);
  }

  // 5a. Attach Build to G1 (Internal Testing - Instant 0-wait distribution)
  if (g1Group) {
    if (g1Group.attributes?.hasAccessToAllBuilds) {
      console.log(`[TestFlightAuto] Internal Group "${g1Group.attributes?.name}" already has automatic access to all builds (hasAccessToAllBuilds: true).`);
    } else {
      console.log(`[TestFlightAuto] Attaching Build ${buildId} to Internal Group "${g1Group.attributes?.name}" (ID: ${g1Group.id})...`);
      const linkG1Res = await apiRequest(`/v1/betaGroups/${g1Group.id}/relationships/builds`, token, {
        method: 'POST',
        body: JSON.stringify({
          data: [{ type: 'builds', id: buildId }]
        })
      });
      if (linkG1Res.ok) {
        console.log(`[TestFlightAuto] -> Build successfully linked to Internal Group "${g1Group.attributes?.name}" (INSTANT DISTRIBUTION)!`);
      } else if (linkG1Res.status === 409) {
        console.log(`[TestFlightAuto] -> Build is already linked to Internal Group "${g1Group.attributes?.name}".`);
      } else {
        console.warn(`[TestFlightAuto] Warning linking to G1: ${linkG1Res.status} ${linkG1Res.rawText}`);
      }
    }
  }

  // 5b. Attach Build to G2 (External Testing)
  if (g2Group) {
    console.log(`[TestFlightAuto] Attaching Build ${buildId} to External Group "${g2Group.attributes?.name}" (ID: ${g2Group.id})...`);
    const linkG2Res = await apiRequest(`/v1/betaGroups/${g2Group.id}/relationships/builds`, token, {
      method: 'POST',
      body: JSON.stringify({
        data: [{ type: 'builds', id: buildId }]
      })
    });
    if (linkG2Res.ok) {
      console.log(`[TestFlightAuto] -> Build successfully linked to External Group "${g2Group.attributes?.name}"!`);
    } else if (linkG2Res.status === 409) {
      console.log(`[TestFlightAuto] -> Build is already linked to External Group "${g2Group.attributes?.name}".`);
    } else {
      console.warn(`[TestFlightAuto] Warning linking to G2: ${linkG2Res.status} ${linkG2Res.rawText}`);
    }
  } else {
    console.warn(`[TestFlightAuto] Beta group matching "${targetGroupName}" not found.`);
  }

  // 6. Update Beta Build Localization (What to test / What's new)
  const whatsNewText = getWhatsNewText();
  console.log(`[TestFlightAuto] Setting Beta Build What's New notes: "${whatsNewText.slice(0, 80)}..."`);
  try {
    const locRes = await apiRequest(`/v1/builds/${buildId}/betaBuildLocalizations`, token);
    const existingLoc = locRes.data?.data?.find(l => l.attributes?.locale === 'zh-Hans' || l.attributes?.locale === 'en-US');

    if (existingLoc) {
      await apiRequest(`/v1/betaBuildLocalizations/${existingLoc.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          data: {
            type: 'betaBuildLocalizations',
            id: existingLoc.id,
            attributes: { whatsNew: whatsNewText.slice(0, 4000) }
          }
        })
      });
      console.log('[TestFlightAuto] -> Updated existing localization successfully.');
    } else {
      await apiRequest('/v1/betaBuildLocalizations', token, {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'betaBuildLocalizations',
            attributes: { locale: 'zh-Hans', whatsNew: whatsNewText.slice(0, 4000) },
            relationships: { build: { data: { type: 'builds', id: buildId } } }
          }
        })
      });
      console.log('[TestFlightAuto] -> Created new localization successfully.');
    }
  } catch (locErr) {
    console.warn('[TestFlightAuto] Note: setting whatsNew had warning:', locErr.message);
  }

  // 7. Submit for Beta App Review
  console.log(`[TestFlightAuto] Submitting Build ${buildId} for Apple Beta App Review...`);
  const reviewSubRes = await apiRequest(`/v1/builds/${buildId}/betaAppReviewSubmission`, token);
  const existingSubmission = reviewSubRes.data?.data;

  if (existingSubmission && existingSubmission.attributes?.betaReviewState) {
    console.log(`[TestFlightAuto] -> Build review already exists with state: ${existingSubmission.attributes.betaReviewState}`);
  } else {
    let submitRes = await apiRequest('/v1/betaAppReviewSubmissions', token, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: {
            build: {
              data: { type: 'builds', id: buildId }
            }
          }
        }
      })
    });

    if (submitRes.status === 422 && submitRes.rawText?.includes('SUBMISSION_LIMIT_REACHED')) {
      console.log('[TestFlightAuto] Review slot limit reached on submit. Re-running older waiting build cleanup and retrying...');
      try {
        await cleanupSupersededWaitingBuilds({
          appId,
          targetBuild,
          g2GroupId: g2Group?.id || null,
          token
        });
      } catch (cancelErr) {
        console.warn('[TestFlightAuto] Warning during retry older build expiration:', cancelErr.message);
      }

      submitRes = await apiRequest('/v1/betaAppReviewSubmissions', token, {
        method: 'POST',
        body: JSON.stringify({
          data: {
            type: 'betaAppReviewSubmissions',
            relationships: {
              build: {
                data: { type: 'builds', id: buildId }
              }
            }
          }
        })
      });
    }

    if (submitRes.ok || submitRes.status === 201) {
      console.log('[TestFlightAuto] -> SUCCESS: Build is now submitted for Beta App Review (WAITING_FOR_REVIEW)!');
    } else if (submitRes.status === 409) {
      console.log('[TestFlightAuto] -> Build is already in review or approved.');
    } else {
      console.warn(`[TestFlightAuto] Submission returned ${submitRes.status}: ${submitRes.rawText}`);
    }
  }

  console.log('=== [TestFlightAuto] Automated TestFlight workflow completed successfully! ===');
}

if (require.main === module) {
  main().catch(err => {
    console.warn('[TestFlightAuto] Unexpected error in automated TestFlight submission:', err.message);
    // Do not fail CI step on review submission issue
    process.exit(0);
  });
}

module.exports = {
  parseBuildVersionNumber,
  compareBuildsAscending,
  cleanupSupersededWaitingBuilds
};
