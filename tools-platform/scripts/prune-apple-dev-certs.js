#!/usr/bin/env node

/**
 * Automatically prunes stale "Created via API" development certificates
 * from Apple Developer account to prevent hitting certificate quota limits
 * during CI/CD builds.
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
    exp: Math.floor(Date.now() / 1000) + 1200, // 20 minutes expiration
    aud: 'appstoreconnect-v1'
  };

  const signInput = `${base64url(header)}.${base64url(payload)}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signInput);
  signer.end();
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signInput}.${base64url(signature)}`;
}

async function main() {
  const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  let keyPath = process.env.APP_STORE_CONNECT_KEY_FILE;

  if (!keyId || !issuerId) {
    console.log('[AppleCertCleanup] APP_STORE_CONNECT_KEY_ID or ISSUER_ID not set. Skipping certificate pruning.');
    return;
  }

  if (!keyPath) {
    const defaultPath = path.join(os.homedir(), '.private_keys', `AuthKey_${keyId}.p8`);
    const altPath = path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`);
    if (fs.existsSync(defaultPath)) {
      keyPath = defaultPath;
    } else if (fs.existsSync(altPath)) {
      keyPath = altPath;
    }
  }

  if (!keyPath || !fs.existsSync(keyPath)) {
    console.log('[AppleCertCleanup] Private key file not found. Skipping certificate pruning.');
    return;
  }

  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const token = createJwt(keyId, issuerId, privateKeyPem);

  console.log('[AppleCertCleanup] Querying Apple Developer certificates via App Store Connect API...');
  const res = await fetch('https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=DEVELOPMENT&limit=50', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`[AppleCertCleanup] Failed to fetch certificates: HTTP ${res.status} - ${errorText}`);
    return;
  }

  const json = await res.json();
  const certs = json.data || [];
  console.log(`[AppleCertCleanup] Total DEVELOPMENT certificates found: ${certs.length}`);

  // Only target certificates created automatically by CI API Key (name usually contains 'Created via API')
  const apiCerts = certs.filter(c => {
    const name = (c.attributes?.name || '') + ' ' + (c.attributes?.displayName || '');
    return name.toLowerCase().includes('created via api');
  });

  console.log(`[AppleCertCleanup] Found ${apiCerts.length} CI-generated "Created via API" certificates.`);

  // If there are 2 or more CI-generated certificates, delete older ones and leave at most 1
  if (apiCerts.length >= 2) {
    // Sort descending by createdDate or expirationDate (newest first)
    apiCerts.sort((a, b) => {
      const dateA = new Date(a.attributes?.createdDate || a.attributes?.expirationDate || 0).getTime();
      const dateB = new Date(b.attributes?.createdDate || b.attributes?.expirationDate || 0).getTime();
      return dateB - dateA;
    });

    // Keep the newest 1, revoke the rest
    const certsToRevoke = apiCerts.slice(1);
    console.log(`[AppleCertCleanup] Revoking ${certsToRevoke.length} stale CI certificates to keep slots free...`);

    for (const cert of certsToRevoke) {
      try {
        const certName = cert.attributes?.name || cert.attributes?.displayName || cert.id;
        console.log(`[AppleCertCleanup] Revoking stale cert ${cert.id} (${certName})...`);
        const delRes = await fetch(`https://api.appstoreconnect.apple.com/v1/certificates/${cert.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (delRes.status === 204 || delRes.ok) {
          console.log(`[AppleCertCleanup] -> Successfully revoked cert ${cert.id}`);
        } else {
          const errBody = await delRes.text();
          console.warn(`[AppleCertCleanup] -> Failed to revoke cert ${cert.id}: HTTP ${delRes.status} ${errBody}`);
        }
      } catch (revokeErr) {
        console.warn(`[AppleCertCleanup] Error revoking cert ${cert.id}:`, revokeErr.message);
      }
    }
  } else {
    console.log('[AppleCertCleanup] CI certificate count is healthy (less than 2). No cleanup needed.');
  }

  console.log('[AppleCertCleanup] Certificate cleanup check completed successfully.');
}

main().catch(err => {
  console.warn('[AppleCertCleanup] Unexpected warning during cert pruning:', err.message);
  // Do not exit with error so the main build is not blocked
  process.exit(0);
});
