const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_PREFIX = 'DSKL1';
const ATTESTATION_PREFIX = 'DSKT1';
// v2 起 License 必须绑定设备：载荷含本机指纹 machineId 与有效期，均受签名保护，
// 离线时即可在本地完成「验签 + 指纹比对 + 有效期」判断；v1 通用 License 不再接受。
const TOKEN_VERSION = 2;
const MACHINE_ID_PATTERN = /^[a-f0-9]{32}$/;

function decode(value) {
    return Buffer.from(String(value || ''), 'base64url');
}

function digest(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('base64url');
}

// fetchImpl：桌面端传入 Electron 的 net.fetch（走 Chromium 网络栈，遵循系统代理/PAC），
// 否则企业内网需代理上网时，Node 自带 fetch 会直连失败，导致在线校验与一键申请不可用。
function createDesktopLicenseClient({ configPath, statePath, publicStatusPath, requestStatePath = '', machineIdentity = null, fetchImpl = null }) {
    const httpFetch = typeof fetchImpl === 'function' ? fetchImpl : (...args) => fetch(...args);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const publicKey = crypto.createPublicKey({ key: config.publicKeyJwk, format: 'jwk' });
    let machine = machineIdentity;

    // 主进程启动后异步采集设备指纹，采集完成前不做任何授权判断
    function setMachineIdentity(identity) {
        machine = identity || null;
    }

    function currentMachineId() {
        return machine && MACHINE_ID_PATTERN.test(String(machine.machineId || '')) ? machine.machineId : '';
    }

    function readState() {
        try {
            return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
        } catch (_) {
            return {};
        }
    }

    function writeJson(file, value, secret = false) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: secret ? 0o600 : 0o644 });
        fs.renameSync(temp, file);
        if (secret) try { fs.chmodSync(file, 0o600); } catch (_) {}
    }

    function verifySigned(value, prefix) {
        const parts = String(value || '').trim().split('.');
        if (parts.length !== 3 || parts[0] !== prefix) return { valid: false, reasonCode: 'INVALID_FORMAT' };
        try {
            const valid = crypto.verify('sha256', Buffer.from(parts[1]), {
                key: publicKey,
                dsaEncoding: 'ieee-p1363'
            }, decode(parts[2]));
            if (!valid) return { valid: false, reasonCode: 'INVALID_SIGNATURE' };
            return { valid: true, payload: JSON.parse(decode(parts[1]).toString('utf8')) };
        } catch (_) {
            return { valid: false, reasonCode: 'VERIFICATION_FAILED' };
        }
    }

    function inspectToken(token) {
        const checked = verifySigned(token, TOKEN_PREFIX);
        if (!checked.valid) return checked;
        const payload = checked.payload;
        if (!payload || payload.productId !== config.productId || !payload.licenseId || !Number.isFinite(payload.issuedAt)) {
            return { valid: false, reasonCode: 'PRODUCT_MISMATCH' };
        }
        // 旧版通用 License（v1，无设备绑定）一律拒绝
        if (payload.version !== TOKEN_VERSION || !MACHINE_ID_PATTERN.test(String(payload.machineId || ''))) {
            return { valid: false, reasonCode: 'LEGACY_LICENSE' };
        }
        if (!Number.isFinite(payload.notBefore) || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= payload.notBefore) {
            return { valid: false, reasonCode: 'INVALID_FORMAT' };
        }
        const machineId = currentMachineId();
        if (!machineId) return { valid: false, reasonCode: 'MACHINE_UNAVAILABLE' };
        if (payload.machineId !== machineId) return { valid: false, reasonCode: 'MACHINE_MISMATCH' };
        return { ...checked, locallyVerifiable: true };
    }

    function verifyAttestation(attestation, token, expectedNonce) {
        const checked = verifySigned(attestation, ATTESTATION_PREFIX);
        if (!checked.valid) return checked;
        const payload = checked.payload || {};
        if (payload.version !== 1 || payload.productId !== config.productId) return { valid: false, reasonCode: 'PRODUCT_MISMATCH' };
        if (expectedNonce && payload.nonce !== expectedNonce) return { valid: false, reasonCode: 'NONCE_MISMATCH' };
        if (payload.machineId !== currentMachineId()) return { valid: false, reasonCode: 'MACHINE_MISMATCH' };
        if (payload.tokenDigest !== digest(token)) return { valid: false, reasonCode: 'TOKEN_MISMATCH' };
        if (!Number.isFinite(payload.checkedAt) || !Number.isFinite(payload.attestationExpiresAt)
            || !Number.isFinite(payload.offlineUntil) || !Number.isFinite(payload.expiresAt)) {
            return { valid: false, reasonCode: 'INVALID_FORMAT' };
        }
        return payload.valid ? { valid: true, payload } : { valid: false, reasonCode: payload.reasonCode || 'VERIFICATION_FAILED', payload };
    }

    function toPublicStatus(result) {
        return {
            enabled: true,
            valid: Boolean(result && result.valid),
            licenseId: result && result.licenseId || null,
            expiresAt: result && Number(result.expiresAt) || 0,
            trustedNow: result && Number(result.trustedNow) || Date.now(),
            online: Boolean(result && result.online),
            reasonCode: result && result.reasonCode || null,
            updatedAt: new Date().toISOString()
        };
    }

    function publish(result) {
        writeJson(publicStatusPath, toPublicStatus(result));
        return result;
    }

    async function online(token) {
        const nonce = crypto.randomBytes(18).toString('base64url');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
            const response = await httpFetch(config.validationUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, productId: config.productId, nonce, machineId: currentMachineId() }),
                cache: 'no-store',
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body.attestation) throw new Error(body.error || 'ONLINE_UNAVAILABLE');
            const checked = verifyAttestation(body.attestation, token, nonce);
            const localCheckedAt = Date.now();
            if (!checked.valid) {
                // 已通过服务器签名的失效/过期结果必须覆盖旧的成功缓存，
                // 否则攻击者可在撤销后断网，重新利用之前的离线凭证。
                if (checked.payload) {
                    writeJson(statePath, {
                        token,
                        attestation: body.attestation,
                        localCheckedAt,
                        lastObservedLocalTime: localCheckedAt,
                        lastTrustedTime: checked.payload.checkedAt
                    }, true);
                }
                return publish({ valid: false, reasonCode: checked.reasonCode, online: true });
            }
            const state = {
                token,
                attestation: body.attestation,
                localCheckedAt,
                lastObservedLocalTime: localCheckedAt,
                lastTrustedTime: checked.payload.checkedAt
            };
            writeJson(statePath, state, true);
            return publish({
                valid: true,
                licenseId: checked.payload.licenseId,
                expiresAt: checked.payload.expiresAt,
                trustedNow: checked.payload.checkedAt,
                online: true
            });
        } finally {
            clearTimeout(timer);
        }
    }

    function offlineSignedToken(token, tokenPayload) {
        const state = readState();
        const localNow = Date.now();
        const sameTokenState = state.token === token ? state : {};
        const floor = Math.max(
            Number(sameTokenState.lastObservedLocalTime) || 0,
            Number(sameTokenState.lastTrustedTime) || 0
        );
        if (localNow < floor - 120000) {
            return publish({ valid: false, reasonCode: 'CLOCK_ROLLBACK', trustedNow: floor });
        }

        // 如果这把密钥曾收到服务器签名的撤销/归档结果，断网后也不回退到本地成功。
        if (sameTokenState.attestation) {
            const serverState = verifyAttestation(sameTokenState.attestation, token);
            if (!serverState.valid && serverState.payload) {
                return publish({
                    valid: false,
                    reasonCode: serverState.reasonCode,
                    trustedNow: Math.max(localNow, floor)
                });
            }
        }

        let trustedNow = Math.max(localNow, floor);
        if (sameTokenState.attestation && Number.isFinite(sameTokenState.localCheckedAt)) {
            const serverState = verifyAttestation(sameTokenState.attestation, token);
            if (serverState.valid) {
                trustedNow = Math.max(
                    trustedNow,
                    Number(serverState.payload.checkedAt)
                        + Math.max(0, localNow - Number(sameTokenState.localCheckedAt))
                );
            }
        }
        if (trustedNow < Number(tokenPayload.notBefore)) {
            return publish({ valid: false, reasonCode: 'NOT_YET_VALID', trustedNow });
        }
        if (trustedNow >= Number(tokenPayload.expiresAt)) {
            return publish({ valid: false, reasonCode: 'EXPIRED', trustedNow });
        }

        writeJson(statePath, {
            ...sameTokenState,
            token,
            lastObservedLocalTime: localNow,
            lastTrustedTime: trustedNow
        }, true);
        return publish({
            valid: true,
            licenseId: tokenPayload.licenseId,
            expiresAt: tokenPayload.expiresAt,
            trustedNow,
            online: false,
            localSignature: true
        });
    }

    async function validate(token, { onProgress = null } = {}) {
        const report = (stage, percent) => {
            if (typeof onProgress === 'function') {
                try { onProgress({ stage, percent }); } catch (_) {}
            }
        };

        report('PARSE_TOKEN', 25);
        const inspected = inspectToken(token);
        if (!inspected.valid) return publish({ valid: false, reasonCode: inspected.reasonCode });

        report('CHECK_SIGNATURE', 50);

        try {
            report('CONNECT_SERVER', 75);
            const onlineResult = await online(token);
            if (onlineResult && onlineResult.valid) {
                report('FINALIZE', 100);
            }
            return onlineResult;
        } catch (_) {
            report('OFFLINE_VERIFY', 85);
            const fallbackResult = offlineSignedToken(token, inspected.payload);
            if (fallbackResult && fallbackResult.valid) {
                report('FINALIZE', 100);
            }
            return fallbackResult;
        }
    }

    async function validateStored() {
        const state = readState();
        if (!state.token) return publish({ valid: false, reasonCode: 'LICENSE_REQUIRED' });
        return validate(state.token);
    }

    function getMachineIdentity() {
        return machine ? { ...machine } : null;
    }

    // ── 一键申请 License：提交 → 本地保存申请状态（跨重启恢复）→ 轮询 → 审批通过后自动激活 ──
    const serviceBase = String(config.requestsBaseUrl || config.validationUrl || '').replace(/\/validate\/?$/, '');

    async function callService(pathname, { method = 'POST', body, timeout = 7000 } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await httpFetch(`${serviceBase}${pathname}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                cache: 'no-store',
                signal: controller.signal
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { code: data.code || `HTTP_${response.status}`, status: response.status });
            return data;
        } catch (error) {
            if (!error.code) error.code = 'ONLINE_UNAVAILABLE';
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    function readRequestState() {
        if (!requestStatePath) return null;
        try {
            const saved = fs.existsSync(requestStatePath) ? JSON.parse(fs.readFileSync(requestStatePath, 'utf8')) : null;
            // 申请只对提交时的设备有效；换机或指纹变化后丢弃旧申请
            return saved && saved.requestId && saved.machineId === currentMachineId() ? saved : null;
        } catch (_) {
            return null;
        }
    }

    function saveRequestState(value) {
        if (!requestStatePath) return;
        if (value) writeJson(requestStatePath, value, true);
        else try { fs.rmSync(requestStatePath, { force: true }); } catch (_) {}
    }

    function publicRequestState(saved = readRequestState()) {
        if (!saved) return null;
        const { secret, token, ...rest } = saved;
        return rest;
    }

    let lastProbeError = '';
    async function probeRequestService() {
        try {
            const data = await callService('/ping', { method: 'GET', timeout: 6000 });
            const ok = Boolean(data && data.requests && data.productId === config.productId);
            lastProbeError = ok ? '' : 'UNEXPECTED_RESPONSE';
            return ok;
        } catch (error) {
            lastProbeError = `${error.code || 'ERROR'}: ${error.message || error}`;
            return false;
        }
    }

    async function submitLicenseRequest({ applicantName, applicantNote, clientVersion } = {}) {
        if (!machine || !currentMachineId()) throw Object.assign(new Error('本机设备信息尚未就绪'), { code: 'MACHINE_UNAVAILABLE' });
        const data = await callService('/requests', {
            body: { productId: config.productId, machineCode: machine.machineCode, applicantName, applicantNote, clientVersion }
        });
        const request = data.request || {};
        const saved = {
            requestId: request.requestId,
            secret: request.secret,
            machineId: currentMachineId(),
            status: request.status || 'pending',
            applicantName: String(applicantName || '').trim(),
            applicantNote: String(applicantNote || '').trim(),
            createdAt: request.createdAt || Date.now(),
            lastCheckedAt: Date.now(),
            rejectReason: ''
        };
        saveRequestState(saved);
        return publicRequestState(saved);
    }

    // 查询一次申请状态；审批通过时取回 License 并完成本地激活（License 同样经过签名与设备指纹校验）
    async function pollLicenseRequest() {
        const saved = readRequestState();
        if (!saved || saved.status !== 'pending') return { request: publicRequestState(saved), license: null };
        let data;
        try {
            data = await callService(`/requests/${encodeURIComponent(saved.requestId)}/status`, {
                body: { secret: saved.secret, machineId: currentMachineId() }
            });
        } catch (error) {
            if (error.code === 'REQUEST_NOT_FOUND') {
                saveRequestState(null);
                return { request: null, license: null, error: error.code };
            }
            saved.lastError = error.code;
            saved.lastCheckedAt = Date.now();
            saveRequestState(saved);
            return { request: publicRequestState(saved), license: null, error: error.code };
        }
        const remote = data.request || {};
        const next = { ...saved, status: remote.status || saved.status, lastCheckedAt: Date.now(), lastError: '', rejectReason: remote.rejectReason || '', decidedAt: remote.decidedAt || null };
        if (remote.status === 'approved' && remote.token) {
            const license = await validate(remote.token);
            if (license && license.valid) {
                saveRequestState(null); // 已激活，申请流程结束
                return { request: { ...publicRequestState(next), status: 'activated' }, license };
            }
            next.status = 'pending';
            next.lastError = license && license.reasonCode || 'VERIFICATION_FAILED';
        }
        saveRequestState(next);
        return { request: publicRequestState(next), license: null };
    }

    async function cancelLicenseRequest() {
        const saved = readRequestState();
        if (saved && saved.status === 'pending') {
            await callService(`/requests/${encodeURIComponent(saved.requestId)}/cancel`, {
                body: { secret: saved.secret, machineId: currentMachineId() }
            }).catch(() => null);
        }
        saveRequestState(null);
        return null;
    }

    function clearLicenseRequest() {
        saveRequestState(null);
    }

    return {
        config, readState, validate, validateStored, setMachineIdentity, getMachineIdentity,
        probeRequestService, submitLicenseRequest, pollLicenseRequest, cancelLicenseRequest, clearLicenseRequest,
        getLicenseRequest: () => publicRequestState(),
        getLastProbeError: () => lastProbeError
    };
}

module.exports = { createDesktopLicenseClient };
