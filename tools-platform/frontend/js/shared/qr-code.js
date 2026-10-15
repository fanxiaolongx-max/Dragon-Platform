// 轻量二维码生成（字节模式、纠错等级 M、版本 1–40 自动选择），输出 SVG 字符串。
// 算法参考 ISO/IEC 18004 与 Nayuki QR Code generator（MIT）的公开实现思路。
// 用法：window.ToolsQrCode.toSvg('https://example.com', { scale: 4, border: 4 })
(function () {
    'use strict';

    const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
    const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
    const FORMAT_BITS_M = 0;

    function rawDataModules(ver) {
        let result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            const numAlign = Math.floor(ver / 7) + 2;
            result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7) result -= 36;
        }
        return result;
    }

    function dataCodewords(ver) {
        return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];
    }

    function gfMul(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i -= 1) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xFF;
    }

    function rsDivisor(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i += 1) {
            for (let j = 0; j < result.length; j += 1) {
                result[j] = gfMul(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = gfMul(root, 0x02);
        }
        return result;
    }

    function rsRemainder(data, divisor) {
        const result = divisor.map(() => 0);
        data.forEach(byte => {
            const factor = byte ^ result.shift();
            result.push(0);
            divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
        });
        return result;
    }

    function encodeData(bytes) {
        let ver = 1;
        for (; ver <= 40; ver += 1) {
            const ccBits = ver <= 9 ? 8 : 16;
            if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
        }
        if (ver > 40) throw new Error('二维码内容过长');
        const bits = [];
        const append = (value, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
        append(0x4, 4);
        append(bytes.length, ver <= 9 ? 8 : 16);
        bytes.forEach(byte => append(byte, 8));
        const capacity = dataCodewords(ver) * 8;
        append(0, Math.min(4, capacity - bits.length));
        append(0, (8 - bits.length % 8) % 8);
        for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
        const codewords = [];
        for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
        return { ver, codewords };
    }

    function addEccAndInterleave(ver, data) {
        const numBlocks = BLOCKS_M[ver];
        const blockEccLen = ECC_PER_BLOCK_M[ver];
        const rawCodewords = Math.floor(rawDataModules(ver) / 8);
        const numShortBlocks = numBlocks - rawCodewords % numBlocks;
        const shortBlockLen = Math.floor(rawCodewords / numBlocks);
        const divisor = rsDivisor(blockEccLen);
        const blocks = [];
        for (let i = 0, k = 0; i < numBlocks; i += 1) {
            const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
            k += dat.length;
            const ecc = rsRemainder(dat, divisor);
            if (i < numShortBlocks) dat.push(0);
            blocks.push(dat.concat(ecc));
        }
        const result = [];
        for (let i = 0; i < blocks[0].length; i += 1) {
            blocks.forEach((block, j) => {
                if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
            });
        }
        return result;
    }

    function alignmentPositions(ver, size) {
        if (ver === 1) return [];
        const numAlign = Math.floor(ver / 7) + 2;
        const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
        const result = [6];
        for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
        return result;
    }

    function maskHit(mask, x, y) {
        switch (mask) {
            case 0: return (x + y) % 2 === 0;
            case 1: return y % 2 === 0;
            case 2: return x % 3 === 0;
            case 3: return (x + y) % 3 === 0;
            case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            case 5: return (x * y) % 2 + (x * y) % 3 === 0;
            case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
            default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
    }

    function build(text) {
        const bytes = Array.from(new TextEncoder().encode(String(text)));
        const { ver, codewords } = encodeData(bytes);
        const size = ver * 4 + 17;
        const modules = Array.from({ length: size }, () => new Array(size).fill(false));
        const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
        const setFunction = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

        for (let i = 0; i < size; i += 1) {
            setFunction(6, i, i % 2 === 0);
            setFunction(i, 6, i % 2 === 0);
        }
        [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
            for (let dy = -4; dy <= 4; dy += 1) {
                for (let dx = -4; dx <= 4; dx += 1) {
                    const dist = Math.max(Math.abs(dx), Math.abs(dy));
                    const x = cx + dx;
                    const y = cy + dy;
                    if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4);
                }
            }
        });
        const align = alignmentPositions(ver, size);
        align.forEach((ay, i) => align.forEach((ax, j) => {
            const last = align.length - 1;
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            for (let dy = -2; dy <= 2; dy += 1) {
                for (let dx = -2; dx <= 2; dx += 1) setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }));
        const drawFormat = mask => {
            const data = (FORMAT_BITS_M << 3) | mask;
            let rem = data;
            for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const bits = ((data << 10) | rem) ^ 0x5412;
            const bit = i => ((bits >>> i) & 1) !== 0;
            for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
            setFunction(8, 7, bit(6));
            setFunction(8, 8, bit(7));
            setFunction(7, 8, bit(8));
            for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
            for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(i));
            for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(i));
            setFunction(8, size - 8, true);
        };
        drawFormat(0);
        if (ver >= 7) {
            let rem = ver;
            for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            const bits = (ver << 12) | rem;
            for (let i = 0; i < 18; i += 1) {
                const dark = ((bits >>> i) & 1) !== 0;
                const a = size - 11 + i % 3;
                const b = Math.floor(i / 3);
                setFunction(a, b, dark);
                setFunction(b, a, dark);
            }
        }

        const data = addEccAndInterleave(ver, codewords);
        let bitIndex = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert += 1) {
                for (let j = 0; j < 2; j += 1) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? size - 1 - vert : vert;
                    if (!isFunction[y][x] && bitIndex < data.length * 8) {
                        modules[y][x] = ((data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
                        bitIndex += 1;
                    }
                }
            }
        }

        const applyMask = mask => {
            for (let y = 0; y < size; y += 1) {
                for (let x = 0; x < size; x += 1) {
                    if (!isFunction[y][x] && maskHit(mask, x, y)) modules[y][x] = !modules[y][x];
                }
            }
        };
        const penalty = () => {
            let score = 0;
            const lineScore = get => {
                for (let a = 0; a < size; a += 1) {
                    let run = 1;
                    const line = [];
                    for (let b = 0; b < size; b += 1) line.push(get(a, b));
                    for (let b = 1; b <= size; b += 1) {
                        if (b < size && line[b] === line[b - 1]) run += 1;
                        else {
                            if (run >= 5) score += 3 + (run - 5);
                            run = 1;
                        }
                    }
                    const padded = [false, false, false, false, ...line, false, false, false, false];
                    for (let b = 0; b + 11 <= padded.length; b += 1) {
                        const s = padded.slice(b, b + 11).map(v => (v ? 1 : 0)).join('');
                        if (s === '10111010000' || s === '00001011101') score += 40;
                    }
                }
            };
            lineScore((a, b) => modules[a][b]);
            lineScore((a, b) => modules[b][a]);
            for (let y = 0; y < size - 1; y += 1) {
                for (let x = 0; x < size - 1; x += 1) {
                    const c = modules[y][x];
                    if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
                }
            }
            const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
            const total = size * size;
            score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
            return score;
        };
        let bestMask = 0;
        let bestScore = Infinity;
        for (let mask = 0; mask < 8; mask += 1) {
            applyMask(mask);
            drawFormat(mask);
            const score = penalty();
            if (score < bestScore) { bestScore = score; bestMask = mask; }
            applyMask(mask);
        }
        applyMask(bestMask);
        drawFormat(bestMask);
        return { size, modules };
    }

    function toSvg(text, { scale = 4, border = 4, dark = '#0f172a', light = '#ffffff' } = {}) {
        const { size, modules } = build(text);
        const full = size + border * 2;
        const parts = [];
        modules.forEach((row, y) => row.forEach((on, x) => { if (on) parts.push(`M${x + border},${y + border}h1v1h-1z`); }));
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * scale}" height="${full * scale}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="${light}"/><path d="${parts.join('')}" fill="${dark}"/></svg>`;
    }

    const api = { build, toSvg };
    if (typeof window !== 'undefined') window.ToolsQrCode = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
