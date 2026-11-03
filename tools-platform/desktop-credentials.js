'use strict';
const fs = require('fs');
const path = require('path');
let electronSafeStorage = null;
try {
    const electron = require('electron');
    electronSafeStorage = electron.safeStorage || null;
} catch (_) {}

function createDesktopCredentialsManager({ credentialsPath }) {
    function encryptSecret(text) {
        if (!text) return '';
        if (electronSafeStorage && typeof electronSafeStorage.isEncryptionAvailable === 'function' && electronSafeStorage.isEncryptionAvailable()) {
            try {
                return 'enc:' + electronSafeStorage.encryptString(text).toString('base64');
            } catch (_) {}
        }
        return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
    }

    function decryptSecret(cipher) {
        if (!cipher) return '';
        if (cipher.startsWith('enc:') && electronSafeStorage && typeof electronSafeStorage.isEncryptionAvailable === 'function' && electronSafeStorage.isEncryptionAvailable()) {
            try {
                return electronSafeStorage.decryptString(Buffer.from(cipher.slice(4), 'base64'));
            } catch (_) {}
        }
        if (cipher.startsWith('b64:')) {
            try {
                return Buffer.from(cipher.slice(4), 'base64').toString('utf8');
            } catch (_) {}
        }
        return cipher;
    }

    function getCredentials() {
        try {
            if (!fs.existsSync(credentialsPath)) return null;
            const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            if (!data || !data.username || !data.password) return null;
            return {
                username: data.username,
                password: decryptSecret(data.password),
                updatedAt: data.updatedAt
            };
        } catch (_) {
            return null;
        }
    }

    function saveCredentials({ username, password }) {
        try {
            if (!username || !password) return false;
            fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
            const payload = {
                username: String(username).trim(),
                password: encryptSecret(String(password)),
                updatedAt: new Date().toISOString()
            };
            fs.writeFileSync(credentialsPath, JSON.stringify(payload, null, 2), 'utf8');
            return true;
        } catch (_) {
            return false;
        }
    }

    function clearCredentials() {
        try {
            if (fs.existsSync(credentialsPath)) {
                fs.unlinkSync(credentialsPath);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    return {
        getCredentials,
        saveCredentials,
        clearCredentials,
        encryptSecret,
        decryptSecret
    };
}

module.exports = { createDesktopCredentialsManager };
