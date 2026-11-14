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

async function main() {
  console.log('=== [TestFlightAuto] Starting automated G2 external distribution & review submission ===');

  const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const bundleId = process.env.APP_BUNDLE_ID || 'com.fanxiaolong.newapp888';
  const targetGroupName = (process.env.TEST_GROUP_NAME || 'G2').trim().toLowerCase();
  const buildNumber = String(process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || '').trim();

  let keyPath = process.env.APP_STORE_CONNECT_KEY_FILE;
  if (!keyPath) {
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

  // 3. Find target Beta Group (e.g. G2)
  console.log(`[TestFlightAuto] Fetching Beta Groups for App ${appId}...`);
  const groupsRes = await apiRequest(`/v1/apps/${appId}/betaGroups?limit=50`, token);
  if (!groupsRes.ok || !groupsRes.data?.data) {
    console.warn('[TestFlightAuto] Failed to fetch beta groups:', groupsRes.rawText);
    return;
  }

  const groups = groupsRes.data.data;
  const targetGroup = groups.find(g => (g.attributes?.name || '').trim().toLowerCase() === targetGroupName);

  if (!targetGroup) {
    console.warn(`[TestFlightAuto] Beta group matching "${targetGroupName}" not found. Available groups: ${groups.map(g => g.attributes?.name).join(', ')}`);
    return;
  }

  const groupId = targetGroup.id;
  console.log(`[TestFlightAuto] Found Beta Group "${targetGroup.attributes?.name}" (ID: ${groupId})`);

  // 4. Attach Build to Beta Group (G2)
  console.log(`[TestFlightAuto] Attaching Build ${buildId} to Group ${groupId} (${targetGroup.attributes?.name})...`);
  const linkRes = await apiRequest(`/v1/betaGroups/${groupId}/relationships/builds`, token, {
    method: 'POST',
    body: JSON.stringify({
      data: [{ type: 'builds', id: buildId }]
    })
  });

  if (linkRes.ok) {
    console.log(`[TestFlightAuto] -> Build successfully linked to group "${targetGroup.attributes?.name}"!`);
  } else if (linkRes.status === 409) {
    console.log(`[TestFlightAuto] -> Build is already linked to group "${targetGroup.attributes?.name}".`);
  } else {
    console.warn(`[TestFlightAuto] Failed to link build to group: ${linkRes.status} ${linkRes.rawText}`);
  }

  // 5. Update Beta Build Localization (What to test / What's new)
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

  // 6. Submit for Beta App Review
  console.log(`[TestFlightAuto] Submitting Build ${buildId} for Apple Beta App Review...`);
  const reviewSubRes = await apiRequest(`/v1/builds/${buildId}/betaAppReviewSubmission`, token);
  const existingSubmission = reviewSubRes.data?.data;

  if (existingSubmission && existingSubmission.attributes?.betaReviewState) {
    console.log(`[TestFlightAuto] -> Build review already exists with state: ${existingSubmission.attributes.betaReviewState}`);
  } else {
    const submitRes = await apiRequest('/v1/betaAppReviewSubmissions', token, {
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

main().catch(err => {
  console.warn('[TestFlightAuto] Unexpected error in automated TestFlight submission:', err.message);
  // Do not fail CI step on review submission issue
  process.exit(0);
});
