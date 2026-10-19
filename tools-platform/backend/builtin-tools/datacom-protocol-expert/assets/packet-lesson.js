import { ETH, IP, FCS, ospfHeader, PAYLOADS, TYPE_NAMES } from './packet-data.js';
import { parseRfcDiagram } from './rfc-parser.js';
import { bitDiagram } from './diagram-kit.js';
const sources = [
    ['RFC 2328 · 报文与 LSA 格式', 'https://www.rfc-editor.org/rfc/rfc2328.html#appendix-A'],
    ['RFC 5709 · HMAC-SHA 认证', 'https://www.rfc-editor.org/rfc/rfc5709.html'],
];
function fieldLesson(layers, caution, bits = 32) {
    const parts = layers.flatMap((layer, li) =>
        layer.fields.map((f, i) => ({
            id: `l${li}-field-${i}`,
            name: f.name,
            desc: f.desc || '字段含义请结合原文与协议规范确认。',
            rows: [['所属层', layer.name], ['长度', `${f.bits} bit`], ...(f.value ? [['示例', f.value]] : [])],
        })),
    );
    return {
        steps: layers.map((l) => ({
            title: l.name,
            text: l.desc,
            result: `本图每行 ${bits} bit，字段宽度与位数成正比。点击字段查看含义。`,
        })),
        parts,
        diagram(index) {
            return bitDiagram(layers[index], -1, bits).replaceAll('data-part="field-', `data-part="l${index}-field-`);
        },
        takeaway: '报文类型决定载荷，公共头部负责标识。LSA 是链路状态信息，LSU 是运送它的报文。',
        caution,
    };
}
export const packetLesson = {
    id: 'packet-explode',
    title: 'OSPFv2 报文 · 按位读懂封装',
    subtitle: '从帧头到载荷，逐层检查字段的真实位置与长度。先选报文，再点击字段。',
    sources,
    options: [
        {
            id: 'type',
            label: '报文类型',
            value: 1,
            choices: Object.entries(TYPE_NAMES).map(([v, label]) => ({ value: Number(v), label })),
        },
        {
            id: 'auth',
            label: '认证',
            value: 'null',
            choices: [
                { value: 'null', label: '无认证' },
                { value: 'simple', label: '简单口令' },
                { value: 'crypto', label: 'HMAC-SHA256' },
            ],
        },
    ],
    build(o) {
        const layers = [ETH, IP, ospfHeader(o.type, o.auth), ...PAYLOADS[o.type]];
        if (o.auth === 'crypto')
            layers.push({
                name: '认证摘要（追加）',
                desc: '本例为 HMAC-SHA256，摘要追加在 OSPF 报文之后，长度不计入 OSPF Packet Length。',
                fields: [
                    {
                        name: 'Authentication digest',
                        bits: 256,
                        desc: '认证摘要由共享密钥和规定的报文内容计算；不同算法长度不同。',
                    },
                ],
            });
        layers.push(FCS);
        return fieldLesson(
            layers,
            '示例不含 VLAN 与 IP 选项；邻居、LSA 和链路描述块可重复，实际报文长度随内容变化。窄字段显示序号，点击可查看完整名称。',
        );
    },
};
export function rfcLesson(source, title = '报文字段') {
    const parsed = parseRfcDiagram(source);
    if (!parsed) return null;
    return {
        id: 'rfc-diagram',
        title: `${title} · 二维位图`,
        subtitle: '保留字段顺序与位宽；横向读位，纵向读偏移。',
        sources: [],
        build() {
            const layer = {
                name: title,
                desc: '从原文 ASCII 边界推断位宽，空白续行按原图合并。',
                fields: parsed.fields,
            };
            const result = fieldLesson(
                [layer],
                '自动解析仅反映原图排版，无法判断可变长字段的实际长度；请同时核对原文。',
                parsed.bitsPerRow,
            );
            result.takeaway = '顶部是行内位编号，左侧是起始 bit 偏移；跨行字段保持同一名称。';
            return result;
        },
    };
}
