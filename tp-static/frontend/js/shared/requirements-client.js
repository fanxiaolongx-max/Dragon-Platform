// Shared encrypted transport for requests and feedback.
(function () {
    const tText = (zh, en) => window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
    function base64(bytes) {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return btoa(binary);
    }

    window.RequirementsClient = {
        encryptPayload: async function(payload, method, path) {
            if (!window.crypto?.subtle) {
                throw new Error(tText('加密提交需要通过 HTTPS 或 localhost 打开页面', 'Encrypted submission requires HTTPS or localhost'));
            }
            const config = await this.smallRequest('GET', '/api/requirements/transport-key');
            if (config.version !== 1) throw new Error(tText('加密协议不兼容，请刷新页面', 'Encryption protocol mismatch. Refresh this page.'));
            const bytes = new TextEncoder().encode(JSON.stringify(payload));
            if (bytes.length > config.maxPlaintextBytes) {
                throw new Error(tText('需求内容过大，加密请求不能超过 50 MB', 'Request content is too large; the encrypted request must fit within 50 MB'));
            }
            const rsaKey = await crypto.subtle.importKey('spki', Uint8Array.from(atob(config.publicKey), char => char.charCodeAt(0)),
                { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
            const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const aad = new TextEncoder().encode(JSON.stringify([config.version, method, path, config.context]));
            const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, aesKey, bytes);
            const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, await crypto.subtle.exportKey('raw', aesKey));
            return { encryptedPayload: {
                version: config.version, keyId: config.keyId, iv: base64(iv),
                encryptedKey: base64(new Uint8Array(encryptedKey)), ciphertext: base64(new Uint8Array(ciphertext))
            } };
        },

        requestBytes: function(method, path, body) {
            const encoder = new TextEncoder();
            const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders() : { 'Content-Type': 'application/json' };
            const bodyBytes = encoder.encode(body === undefined ? '' : JSON.stringify(body)).length;
            // Reserve 64 KiB for browser/proxy headers and HTTP framing, in addition to application headers.
            const wireBytes = bodyBytes + encoder.encode(JSON.stringify(headers) + method + path).length + 65536;
            return { bodyBytes, wireBytes };
        },

        smallRequest: async function(method, path, body) {
            const size = this.requestBytes(method, path, body);
            if (size.bodyBytes > 800000 || size.wireBytes >= 1000000) {
                throw new Error(tText('提交请求连同包头预留超过 1 MB 限制', 'Submission exceeds the 1 MB limit including reserved headers'));
            }
            return API[method.toLowerCase()](path, body);
        },

        submitPayload: async function(payload, method, path, onProgress = () => {}) {
            if (!window.crypto?.subtle) {
                throw new Error(tText('加密提交需要通过 HTTPS 或 localhost 打开页面', 'Encrypted submission requires HTTPS or localhost'));
            }
            const encoder = new TextEncoder();
            const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
            const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([method, path, payload])))));
            const retryable = error => ['TypeError', 'AbortError'].includes(error.name)
                || [408, 429, 500, 502, 503, 504].includes(error.status)
                || (error.status === 403 && !error.body?.error && !error.body?.code && !error.body?.reasonCode);
            const retry = async (url, body) => {
                for (let attempt = 1; ; attempt++) {
                    try { return await this.smallRequest('POST', url, body); }
                    catch (error) {
                        if (attempt >= 3 || !retryable(error)) throw error;
                        await new Promise(resolve => setTimeout(resolve, attempt * 300));
                    }
                }
            };
            const finish = async pending => {
                try {
                    onProgress(tText('正在校验并保存…', 'Verifying and saving…'));
                    const result = await retry(`/api/requirements/uploads/${pending.uploadId}/complete`, {});
                    this.pendingRequirementUpload = null;
                    return result;
                } catch (error) {
                    if (!retryable(error)) this.pendingRequirementUpload = null;
                    throw error;
                }
            };
            // If a completion response was lost, the same form retries the existing receipt.
            if (this.pendingRequirementUpload?.fingerprint === fingerprint) return finish(this.pendingRequirementUpload);
            this.pendingRequirementUpload = null;

            const encrypted = await this.encryptPayload(payload, method, path);
            const size = this.requestBytes(method, path, encrypted);
            if (size.bodyBytes <= 800000 && size.wireBytes < 1000000) return this.smallRequest(method, path, encrypted);

            // The encrypted envelope is ASCII JSON. Random boundaries cannot split source Unicode characters.
            const serialized = JSON.stringify(encrypted);
            const sizes = [];
            for (let offset = 0; offset < serialized.length;) {
                const random = crypto.getRandomValues(new Uint32Array(1))[0];
                const length = Math.min(serialized.length - offset, 256 * 1024 + random % (256 * 1024 + 1));
                sizes.push(length);
                offset += length;
            }
            const sha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(serialized))));
            const start = await this.smallRequest('POST', '/api/requirements/uploads/start', {
                method, requirementId: method === 'PUT' ? Number(path.split('/').pop()) : null,
                totalBytes: size.bodyBytes, totalChunks: sizes.length, sha256
            });
            const uploadId = start.uploadId;
            let completionStarted = false;
            try {
                let offset = 0;
                for (let index = 0; index < sizes.length; index++) {
                    onProgress(tText(`上传分块 ${index + 1}/${sizes.length}…`, `Uploading chunk ${index + 1}/${sizes.length}…`));
                    const data = serialized.slice(offset, offset + sizes[index]);
                    const ack = await retry(`/api/requirements/uploads/${uploadId}/chunk`, { index, data });
                    if (ack.receivedChunks !== index + 1) throw new Error(tText('服务器分块进度不一致', 'Server chunk progress mismatch'));
                    offset += sizes[index];
                }
                completionStarted = true;
                this.pendingRequirementUpload = { uploadId, fingerprint };
                return await finish(this.pendingRequirementUpload);
            } catch (error) {
                if (!completionStarted) await this.smallRequest('DELETE', `/api/requirements/uploads/${uploadId}`).catch(() => {});
                throw error;
            }
        },

        async compressImage(file, options = {}) {
            const maxWidth = options.maxWidth || 1920;
            const maxHeight = options.maxHeight || 1920;
            const quality = options.quality !== undefined ? options.quality : 0.82;
            const minSizeToCompress = options.minSizeToCompress || 150 * 1024;

            if (!file || file.type === 'image/gif') {
                return {
                    name: file?.name || 'image',
                    type: file?.type || 'image/png',
                    bytes: new Uint8Array(await file.arrayBuffer())
                };
            }

            if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
                return {
                    name: file.name,
                    type: file.type,
                    bytes: new Uint8Array(await file.arrayBuffer())
                };
            }

            try {
                let source = null;
                let width = 0;
                let height = 0;
                let cleanup = () => {};

                if (typeof createImageBitmap === 'function') {
                    try {
                        const bitmap = await createImageBitmap(file);
                        width = bitmap.width;
                        height = bitmap.height;
                        source = bitmap;
                        cleanup = () => bitmap.close?.();
                    } catch {
                        // Fall back to Image
                    }
                }

                if (!source && typeof Image !== 'undefined') {
                    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
                    if (url) {
                        try {
                            source = await new Promise((resolve, reject) => {
                                const img = new Image();
                                img.onload = () => resolve(img);
                                img.onerror = () => reject(new Error('Image decode failed'));
                                img.src = url;
                            });
                            width = source.naturalWidth || source.width;
                            height = source.naturalHeight || source.height;
                            cleanup = () => URL.revokeObjectURL(url);
                        } catch {
                            URL.revokeObjectURL(url);
                        }
                    }
                }

                if (!source || !width || !height) {
                    return {
                        name: file.name,
                        type: file.type,
                        bytes: new Uint8Array(await file.arrayBuffer())
                    };
                }

                try {
                    // Skip compression if already small and dimensions are within bounds
                    if (file.size <= minSizeToCompress && width <= maxWidth && height <= maxHeight) {
                        return {
                            name: file.name,
                            type: file.type,
                            bytes: new Uint8Array(await file.arrayBuffer())
                        };
                    }

                    let targetWidth = width;
                    let targetHeight = height;
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        targetWidth = Math.max(1, Math.round(width * ratio));
                        targetHeight = Math.max(1, Math.round(height * ratio));
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        return {
                            name: file.name,
                            type: file.type,
                            bytes: new Uint8Array(await file.arrayBuffer())
                        };
                    }

                    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

                    // Prefer WebP; fallback to JPEG
                    let targetType = 'image/webp';
                    try {
                        if (typeof canvas.toDataURL === 'function' && !canvas.toDataURL('image/webp').startsWith('data:image/webp')) {
                            targetType = 'image/jpeg';
                        }
                    } catch {
                        targetType = 'image/jpeg';
                    }

                    const blob = await new Promise(resolve => {
                        if (typeof canvas.toBlob === 'function') {
                            canvas.toBlob(resolve, targetType, quality);
                        } else {
                            resolve(null);
                        }
                    });

                    // If conversion failed or inflated an already small file
                    if (!blob || (blob.size >= file.size && file.size <= 4 * 1024 * 1024 && width <= maxWidth && height <= maxHeight)) {
                        return {
                            name: file.name,
                            type: file.type,
                            bytes: new Uint8Array(await file.arrayBuffer())
                        };
                    }

                    let name = file.name;
                    const newExt = targetType === 'image/webp' ? '.webp' : '.jpg';
                    if (!name.toLowerCase().endsWith(newExt)) {
                        name = name.replace(/\.[^.]+$/, '') + newExt;
                    }

                    return {
                        name,
                        type: targetType,
                        bytes: new Uint8Array(await blob.arrayBuffer())
                    };
                } finally {
                    cleanup();
                }
            } catch {
                return {
                    name: file.name,
                    type: file.type,
                    bytes: new Uint8Array(await file.arrayBuffer())
                };
            }
        },

        validImages(files, existing = 0, { maxFileSize = 20 * 1024 * 1024 } = {}) {
            return files.length + existing <= 6 && files.every(file =>
                /^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size > 0 && file.size <= maxFileSize);
        },

        async encodeImages(files) {
            return Promise.all(files.map(async file => {
                const compressed = await this.compressImage(file);
                return {
                    name: compressed.name,
                    type: compressed.type,
                    data: base64(compressed.bytes)
                };
            }));
        }
    };
})();
