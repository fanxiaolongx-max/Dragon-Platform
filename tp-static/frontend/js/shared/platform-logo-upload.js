(function (root) {
    'use strict';
    async function prepareFile(file) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('LOGO_FORMAT');
        if (file.size > 25 * 1024 * 1024) throw new Error('LOGO_SIZE');
        let image;
        try {
            if (root.createImageBitmap) image = await root.createImageBitmap(file);
            else image = await new Promise((resolve, reject) => {
                const url = URL.createObjectURL(file), element = new Image();
                element.onload = () => { URL.revokeObjectURL(url); resolve(element); };
                element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('LOGO_DECODE')); };
                element.src = url;
            });
        } catch (_) { throw new Error('LOGO_DECODE'); }
        try {
            const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
            if (!width || !height) throw new Error('LOGO_DECODE');
            const scale = Math.min(1, 2048 / Math.max(width, height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            // Browser decoding provides WEBP support without native modules or Python.
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('LOGO_DECODE');
            return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'logo'}.png`, { type: 'image/png' });
        } finally { image.close?.(); }
    }
    root.PlatformLogoUpload = { prepareFile };
    if (typeof module === 'object' && module.exports) module.exports = { prepareFile };
})(typeof window === 'object' ? window : globalThis);
