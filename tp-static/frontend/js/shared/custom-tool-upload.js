/* Direct import with an authenticated, encrypted chunk fallback. */
(function () {
    const CHUNK_BYTES = 512 * 1024;
    const WIRE_LIMIT = 1000000;
    const encoder = new TextEncoder();
    const en = () => document.documentElement.lang.toLowerCase().startsWith('en');
    const text = (zh, english) => en() ? english : zh;
    const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    function base64(bytes) {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        return btoa(binary);
    }
    function unbase64(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
    const retryable = error => error.name === 'TypeError' || error.name === 'AbortError'
        || (error.status === 403 && !error.body?.error && !error.body?.code && !error.body?.reasonCode)
        || (error.status === 413 && !error.body?.code)
        || [408, 429, 500, 502, 503, 504].includes(error.status);

    async function request(path, body, { method = 'POST', small = false, timeout = 90000 } = {}) {
        const headers = getAuthHeaders();
        const serialized = body === undefined ? undefined : JSON.stringify(body);
        if (small) {
            // Include actual application headers plus a generous reserve for
            // browser/proxy headers, cookies and HTTP framing.
            const wireBytes = encoder.encode(serialized || '').length
                + encoder.encode(JSON.stringify(headers) + path + method).length + 65536;
            if (wireBytes >= WIRE_LIMIT) throw new Error(text('分块请求连同包头超过 1 MB 限制', 'Chunk request including headers exceeds 1 MB'));
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(path, { method, headers, body: serialized, signal: controller.signal });
            return await handleResponse(res, { method, path });
        } finally { clearTimeout(timer); }
    }

    async function upload(payload, { onProgress = () => {}, endpoint = '/api/custom-tools', chunkAboveBytes = Infinity } = {}) {
        if (!['/api/custom-tools', '/api/topic-snapshots'].includes(endpoint)) throw new Error('Unsupported upload endpoint');
        const base = `${endpoint}/import-upload`;
        payload = { ...payload, importRequestId: hex(crypto.getRandomValues(new Uint8Array(16))) };
        const bytes = encoder.encode(JSON.stringify(payload));
        const report = (percent, message) => onProgress({ percent, message });
        if (bytes.length < chunkAboveBytes) {
            report(5, text('正在尝试直接上传…', 'Trying direct upload…'));
            try {
                const result = await request(endpoint, payload);
                report(100, text('直接上传成功，数据已保存。', 'Direct upload succeeded; data saved.'));
                return result;
            } catch (error) {
                if (!retryable(error)) throw error;
                report(5, text(`直接上传失败（${error.status || error.name}），切换加密分块。`, `Direct upload failed (${error.status || error.name}); switching to encrypted chunks.`));
            }
        } else {
            report(5, text(`数据 ${bytes.length} B，直接使用加密分块，避免大请求被网关拦截。`, `Payload ${bytes.length} B; using encrypted chunks to avoid large-request gateway limits.`));
        }
        if (!crypto.subtle) throw new Error(text('当前页面无法使用安全加密，请通过 HTTPS 或 localhost 打开后重试。', 'Secure encryption is unavailable. Open this page via HTTPS or localhost and retry.'));
        if (bytes.length > 50 * 1024 * 1024) throw new Error(text('导入数据超过 50 MB 限制', 'Import payload exceeds 50 MB'));
        report(7, text(`准备 ${bytes.length} 字节数据，计算 SHA-256 校验值…`, `Preparing ${bytes.length} bytes; computing SHA-256…`));
        const sha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
        report(8, text('整包校验值已计算，正在获取服务器公钥并加密会话密钥…', 'Payload checksum ready; fetching server public key and wrapping the session key…'));
        const { publicKey } = await request(`${base}/key`, undefined, { method: 'GET', small: true });
        const rsaKey = await crypto.subtle.importKey('spki', unbase64(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
        const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
        const encryptedKey = base64(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, await crypto.subtle.exportKey('raw', aesKey))));
        const totalChunks = Math.ceil(bytes.length / CHUNK_BYTES);
        const start = await request(`${base}/start`, {
            totalBytes: bytes.length, totalChunks, sha256, encryptedKey, importRequestId: payload.importRequestId
        }, { small: true });
        const uploadId = start.uploadId;
        report(10, text(`加密会话已建立：AES-256-GCM，${totalChunks} 块，每块原始数据最多 512 KiB。`, `AES-256-GCM session ready: ${totalChunks} chunks, at most 512 KiB of source data each.`));
        async function retry(path, body, label) {
            for (let attempt = 1; ; attempt++) {
                try { return await request(path, body, { small: true }); }
                catch (error) {
                    if (!retryable(error) || attempt >= 3) throw error;
                    report(undefined, text(`${label}发送失败，正在第 ${attempt} 次重试…`, `${label} failed; retry ${attempt}…`));
                    await new Promise(resolve => setTimeout(resolve, attempt * 500));
                }
            }
        }
        try {
            for (let index = 0; index < totalChunks; index++) {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
                const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
                    additionalData: encoder.encode(`${uploadId}:${index}:${totalChunks}`) }, aesKey, chunk);
                const body = { index, iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) };
                const bodyBytes = encoder.encode(JSON.stringify(body)).length;
                const label = text(`第 ${index + 1}/${totalChunks} 块`, `Chunk ${index + 1}/${totalChunks}`);
                report(undefined, text(`${label}已加密，请求正文 ${bodyBytes} B（另预留 64 KiB 包头）。`, `${label} encrypted; body ${bodyBytes} B (64 KiB reserved for headers).`));
                const began = performance.now();
                const ack = await retry(`${base}/${uploadId}/chunk`, body, label);
                if (ack.receivedChunks !== index + 1) throw new Error(text('服务器分块进度不一致', 'Server chunk progress mismatch'));
                report(10 + Math.round((index + 1) / totalChunks * 80), text(`${label}服务器已解密校验，耗时 ${Math.round(performance.now() - began)} ms。`, `${label} decrypted and verified by server in ${Math.round(performance.now() - began)} ms.`));
            }
            report(95, text('全部分块已接收，服务器正在合并、校验整包并导入…', 'All chunks received; server merging, verifying and importing…'));
            const result = await retry(`${base}/${uploadId}/complete`, {}, text('合并请求', 'Completion request'));
            report(100, text('整包校验通过，数据导入成功。', 'Payload verified; data imported successfully.'));
            return result;
        } catch (error) {
            await request(`${base}/${uploadId}`, undefined, { method: 'DELETE', small: true, timeout: 5000 }).catch(() => {});
            throw error;
        }
    }
    window.CustomToolUpload = { upload };
    window.EncryptedChunkUpload = window.CustomToolUpload;
})();
