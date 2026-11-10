// 额度趋势曲线的分段与坐标：桌面版额度趋势窗口（desktop-pet/quota-trends.html）与网页顶部额度栏共用。
(function(host) {
    'use strict';

    function resolveMaxGap(options, step, points) {
        if (typeof options === 'number' && Number.isFinite(options) && options > 0) {
            return options;
        }
        const opt = (typeof options === 'object' && options) ? options : {};
        if (Number.isFinite(opt.maxGap) && opt.maxGap > 0) {
            return opt.maxGap;
        }
        const win = String(opt.windowId || '').toLowerCase();
        const duration = Number(opt.durationMinutes);

        // 周额度 (weekly / >= 24h)：7 天长周期，工作日跨夜及单日间隙属常态使用，允许最多 36 小时连续连线
        if (win.includes('week') || (Number.isFinite(duration) && duration >= 1440)) {
            return 36 * 3600 * 1000;
        }
        // 5 小时额度 (5h / 300m)：周期为 5 小时，允许 6 小时内连续连线，超过 6 小时说明整整一个周期未采样，方才断开
        if (win.includes('5h') || duration === 300) {
            return 6 * 3600 * 1000;
        }

        // 若调用方未显式传入窗口类型，尝试从采样点中的 resetsAt 倒推周期
        if (Array.isArray(points)) {
            for (const p of points) {
                if (p?.resetsAt && Number.isFinite(p.at)) {
                    const diff = Date.parse(p.resetsAt) - p.at;
                    if (diff > 24 * 3600 * 1000) return 36 * 3600 * 1000;
                    if (diff > 0 && diff <= 6 * 3600 * 1000) return 6 * 3600 * 1000;
                }
            }
        }

        // 默认兜底：至少 6 小时间隔内不生硬断线，避免白天正常工作空档被切成散点
        const stepGap = (Number.isFinite(step) && step > 0) ? step * 12 : 3600000;
        return Math.max(6 * 3600 * 1000, stepGap);
    }

    function segments(points, maxGap) {
        const result = [];
        let last = null;
        const gap = (Number.isFinite(maxGap) && maxGap > 0) ? maxGap : resolveMaxGap(maxGap, 60000, points);
        for (const point of points || []) {
            if (!Number.isFinite(point.at) || !Number.isFinite(point.remaining) || point.remaining < 0 || point.remaining > 100) continue;
            // 断开条件：
            // 1. 无前序有效点；
            // 2. 采样时间倒流；
            // 3. 超过最大容忍间隔（很久没数据）；
            // 4. 重置时间戳变更（进入新的一轮周期；排除服务商接口在各次轮询中的秒级/毫秒级微小抖动，变更大于 1 小时方计为真实周期重置）；
            // 5. 额度回升显著大于正常浮动（> 0.5%，通常为重置回满或充值）。
            const resetDiff = (point.resetsAt && last?.resetsAt) ? Math.abs(Date.parse(point.resetsAt) - Date.parse(last.resetsAt)) : 0;
            const isReset = Boolean(point.resetsAt && last?.resetsAt && Number.isFinite(resetDiff) && resetDiff > 3600 * 1000);
            const isRebound = Boolean(last && point.remaining > last.remaining + 0.5);
            const isLongGap = Boolean(last && (point.at - last.at > gap || point.at <= last.at));

            if (!last || isLongGap || isReset || isRebound) {
                result.push([]);
            }
            result[result.length - 1].push(point);
            last = point;
        }
        return result;
    }

    function smoothPath(pts) {
        if (!pts || !pts.length) return '';
        if (pts.length === 1) return 'M ' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2);
        if (pts.length === 2) {
            return 'M ' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2) + ' L ' + pts[1].x.toFixed(2) + ',' + pts[1].y.toFixed(2);
        }

        let d = 'M ' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2);
        const n = pts.length;
        for (let i = 0; i < n - 1; i++) {
            const p0 = i > 0 ? pts[i - 1] : pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = i < n - 2 ? pts[i + 2] : p2;

            // 基于 Catmull-Rom 切线张力因子 1/6 生成丝滑平滑贝塞尔曲线
            let cp1x = p1.x + (p2.x - p0.x) / 6;
            let cp1y = p1.y + (p2.y - p0.y) / 6;
            let cp2x = p2.x - (p3.x - p1.x) / 6;
            let cp2y = p2.y - (p3.y - p1.y) / 6;

            // 单调性钳位：杜绝上下假波动、杜绝穿过 0% 或 100% 边界
            const minY = Math.min(p1.y, p2.y);
            const maxY = Math.max(p1.y, p2.y);
            cp1y = Math.max(minY, Math.min(maxY, cp1y));
            cp2y = Math.max(minY, Math.min(maxY, cp2y));
            cp1x = Math.max(p1.x, Math.min(p2.x, cp1x));
            cp2x = Math.max(p1.x, Math.min(p2.x, cp2x));

            d += ' C ' + cp1x.toFixed(2) + ',' + cp1y.toFixed(2) + ' ' +
                 cp2x.toFixed(2) + ',' + cp2y.toFixed(2) + ' ' +
                 p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
        }
        return d;
    }

    function areaPath(pts, baselineY) {
        if (!pts || pts.length < 2) return '';
        const d = smoothPath(pts);
        const first = pts[0];
        const last = pts[pts.length - 1];
        return d + ' L ' + last.x.toFixed(2) + ',' + baselineY.toFixed(2) +
               ' L ' + first.x.toFixed(2) + ',' + baselineY.toFixed(2) + ' Z';
    }

    function paths(points, from, to, step, used = false, width = 712, height = 280, options) {
        const x = at => 56 + Math.max(0, Math.min(1, (at - from) / (to - from))) * (width - 80);
        const y = value => 22 + (100 - (used ? 100 - value : value)) * (height - 62) / 100;
        const baselineY = 22 + (height - 62);
        const gap = resolveMaxGap(options, step, points);

        return segments(points, gap).map(segment => {
            const mappedPoints = segment.map(p => ({
                ...p,
                x: x(p.at),
                y: y(p.remaining)
            }));
            return {
                d: smoothPath(mappedPoints),
                areaD: areaPath(mappedPoints, baselineY),
                points: mappedPoints
            };
        });
    }

    const api = { segments, paths, smoothPath, areaPath, resolveMaxGap };
    if (host) host.PetQuotaChart = api; else module.exports = api;
})(typeof window !== 'undefined' ? window : null);
