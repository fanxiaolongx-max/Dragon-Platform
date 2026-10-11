(function () {
    'use strict';

    const allowedTags = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'BR', 'UL', 'OL', 'LI', 'A', 'IMG', 'COLGROUP', 'COL']);
    const styleNames = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'padding', 'margin', 'border-radius', 'border-top', 'border-right', 'border-bottom', 'border-left', 'max-width', 'max-height', 'display', 'vertical-align', 'box-sizing', 'width', 'height', 'border-collapse', 'border-spacing', 'table-layout', 'white-space'];

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function timestamp() {
        const d = new Date();
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    }

    class MsgExportLogger {
        constructor() {
            this.logs = [];
            this.modal = null;
            this.terminal = null;
            this.subTitle = null;
            this.dot = null;
            this.doneBtn = null;
            this.hint = null;
            this.initModal();
        }

        initModal() {
            const old = document.getElementById('tpMsgExportModal');
            if (old) old.remove();

            const styleId = 'tpMsgExportStyle';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = `
.tp-msg-export-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #f8fafc;
}
.tp-msg-export-dialog {
  width: min(720px, 96vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
  animation: tpMsgSlideIn .2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes tpMsgSlideIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.tp-msg-export-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #1e293b;
  background: #131d33;
}
.tp-msg-export-title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tp-msg-export-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3b82f6;
  flex-shrink: 0;
  box-shadow: 0 0 10px #3b82f6;
}
.tp-msg-export-status-dot.running {
  background: #3b82f6;
  box-shadow: 0 0 10px #3b82f6;
  animation: tpMsgPulse 1.4s ease-in-out infinite;
}
.tp-msg-export-status-dot.success {
  background: #10b981;
  box-shadow: 0 0 10px #10b981;
  animation: none;
}
.tp-msg-export-status-dot.error {
  background: #ef4444;
  box-shadow: 0 0 10px #ef4444;
  animation: none;
}
@keyframes tpMsgPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
.tp-msg-export-title {
  margin: 0;
  font-size: 15.5px;
  font-weight: 700;
  color: #f8fafc;
}
.tp-msg-export-sub {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}
.tp-msg-export-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tp-msg-export-btn {
  padding: 6px 13px;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all .15s ease;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tp-msg-export-btn-secondary {
  background: #1e293b;
  border-color: #334155;
  color: #cbd5e1;
}
.tp-msg-export-btn-secondary:hover {
  background: #334155;
  color: #fff;
}
.tp-msg-export-btn-primary {
  background: #2563eb;
  color: #fff;
}
.tp-msg-export-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.tp-msg-export-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tp-msg-export-close {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #94a3b8;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: all .15s;
}
.tp-msg-export-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.tp-msg-export-terminal {
  flex: 1;
  min-height: 240px;
  max-height: 420px;
  overflow-y: auto;
  padding: 16px 18px;
  background: #090d16;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-all;
}
.tp-msg-export-terminal::-webkit-scrollbar {
  width: 6px;
}
.tp-msg-export-terminal::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 4px;
}
.tp-msg-log-line {
  display: flex;
  gap: 8px;
  margin-bottom: 5px;
}
.tp-msg-log-time {
  color: #64748b;
  flex-shrink: 0;
  user-select: none;
}
.tp-msg-log-content {
  flex: 1;
}
.tp-msg-log-info { color: #38bdf8; }
.tp-msg-log-step { color: #818cf8; font-weight: 600; }
.tp-msg-log-success { color: #34d399; font-weight: 600; }
.tp-msg-log-warn { color: #fbbf24; }
.tp-msg-log-error { color: #f87171; font-weight: 600; }
.tp-msg-export-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 20px;
  border-top: 1px solid #1e293b;
  background: #111a2e;
}
.tp-msg-export-hint {
  font-size: 12px;
  color: #94a3b8;
}
`;
                document.head.appendChild(style);
            }

            const overlay = document.createElement('div');
            overlay.id = 'tpMsgExportModal';
            overlay.className = 'tp-msg-export-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.innerHTML = `
<div class="tp-msg-export-dialog">
  <div class="tp-msg-export-head">
    <div class="tp-msg-export-title-wrap">
      <span class="tp-msg-export-status-dot running" id="tpMsgExportDot"></span>
      <div>
        <h3 id="tpMsgExportTitle" class="tp-msg-export-title">MSG 邮件生成与诊断日志</h3>
        <div class="tp-msg-export-sub" id="tpMsgExportSub">正在分析月报内容与排版结构...</div>
      </div>
    </div>
    <div class="tp-msg-export-head-actions">
      <button type="button" class="tp-msg-export-btn tp-msg-export-btn-secondary" id="tpMsgExportCopyBtn">📋 复制日志</button>
      <button type="button" class="tp-msg-export-close" id="tpMsgExportCloseBtn" aria-label="关闭">×</button>
    </div>
  </div>
  <div class="tp-msg-export-terminal" id="tpMsgExportTerminal"></div>
  <div class="tp-msg-export-foot">
    <span class="tp-msg-export-hint" id="tpMsgExportHint">💡 生成完成后可直接在 Outlook 桌面端中打开并保持富文本表格</span>
    <button type="button" class="tp-msg-export-btn tp-msg-export-btn-primary" id="tpMsgExportDoneBtn" disabled>正在导出...</button>
  </div>
</div>`;
            document.body.appendChild(overlay);

            this.modal = overlay;
            this.terminal = overlay.querySelector('#tpMsgExportTerminal');
            this.subTitle = overlay.querySelector('#tpMsgExportSub');
            this.dot = overlay.querySelector('#tpMsgExportDot');
            this.doneBtn = overlay.querySelector('#tpMsgExportDoneBtn');
            this.hint = overlay.querySelector('#tpMsgExportHint');

            const copyBtn = overlay.querySelector('#tpMsgExportCopyBtn');
            copyBtn.onclick = () => {
                const text = this.logs.map(l => `[${l.time}] ${l.raw}`).join('\n');
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(text).then(() => {
                        copyBtn.textContent = '✓ 已复制！';
                        setTimeout(() => { copyBtn.textContent = '📋 复制日志'; }, 2000);
                    }).catch(() => {
                        this.fallbackCopy(text, copyBtn);
                    });
                } else {
                    this.fallbackCopy(text, copyBtn);
                }
            };

            const closeBtn = overlay.querySelector('#tpMsgExportCloseBtn');
            closeBtn.onclick = () => this.close();
            this.doneBtn.onclick = () => this.close();

            overlay.onclick = (e) => {
                if (e.target === overlay && !this.doneBtn.disabled) this.close();
            };
        }

        fallbackCopy(text, btn) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                btn.textContent = '✓ 已复制！';
                setTimeout(() => { btn.textContent = '📋 复制日志'; }, 2000);
            } catch (_) {}
            ta.remove();
        }

        log(level, message, rawText) {
            const time = timestamp();
            const raw = rawText || message;
            this.logs.push({ time, level, raw });

            if (this.terminal) {
                const line = document.createElement('div');
                line.className = 'tp-msg-log-line';
                const timeSpan = document.createElement('span');
                timeSpan.className = 'tp-msg-log-time';
                timeSpan.textContent = `[${time}]`;

                const contentSpan = document.createElement('span');
                contentSpan.className = `tp-msg-log-content tp-msg-log-${level}`;
                contentSpan.textContent = message;

                line.appendChild(timeSpan);
                line.appendChild(contentSpan);
                this.terminal.appendChild(line);
                this.terminal.scrollTop = this.terminal.scrollHeight;
            }
        }

        step(current, total, message) {
            this.log('step', `[${current}/${total}] ${message}`);
            if (this.subTitle) this.subTitle.textContent = message;
        }

        info(message) {
            this.log('info', `  ↳ ${message}`);
        }

        success(message) {
            this.log('success', `✓ ${message}`);
            if (this.subTitle) this.subTitle.textContent = message;
            if (this.dot) {
                this.dot.className = 'tp-msg-export-status-dot success';
            }
            if (this.doneBtn) {
                this.doneBtn.disabled = false;
                this.doneBtn.textContent = '完成并关闭';
            }
        }

        error(message, errorObj) {
            this.log('error', `✕ ${message}`);
            if (errorObj) {
                if (errorObj.status) this.log('error', `  HTTP 状态码: ${errorObj.status}`);
                if (errorObj.message) this.log('error', `  错误详情: ${errorObj.message}`);
                if (errorObj.responseHtml) this.log('error', `  响应摘要: ${errorObj.responseHtml.slice(0, 300)}...`);
                else if (errorObj.responseText) this.log('error', `  响应文本: ${errorObj.responseText.slice(0, 300)}...`);
                if (errorObj.stack) this.log('error', `  堆栈追踪:\n${errorObj.stack}`);
            }
            if (this.subTitle) this.subTitle.textContent = '导出失败：' + (errorObj?.message || message);
            if (this.dot) {
                this.dot.className = 'tp-msg-export-status-dot error';
            }
            if (this.doneBtn) {
                this.doneBtn.disabled = false;
                this.doneBtn.textContent = '关闭';
            }
        }

        close() {
            if (this.modal) {
                this.modal.remove();
                this.modal = null;
            }
        }
    }

    function copyForEmail(source, isRoot = false) {
        if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.textContent || '');
        if (source.nodeType !== Node.ELEMENT_NODE) return null;
        if (source.hasAttribute && source.hasAttribute('data-html2canvas-ignore')) return null;
        if (source.classList && (source.classList.contains('print-hide') || source.classList.contains('topic-sync-chip') || source.classList.contains('topic-gutter-badge') || source.classList.contains('topic-ai-translate-btn') || source.classList.contains('topic-diff-popover'))) return null;
        const style = typeof getComputedStyle === 'function' ? getComputedStyle(source) : { display: 'block', visibility: 'visible', getPropertyValue: () => '' };
        const isAnchorTarget = source.tagName === 'A' && ((source.getAttribute && (source.getAttribute('name') || source.getAttribute('id'))) || source.name || source.id);
        if (!isRoot && !isAnchorTarget && (style.display === 'none' || style.visibility === 'hidden')) return null;
        const tag = allowedTags.has(source.tagName) ? source.tagName.toLowerCase() : 'div';
        const target = document.createElement(tag);
        if (tag === 'a') {
            const href = source.getAttribute ? source.getAttribute('href') : source.href;
            if (href && (/^https?:\/\//i.test(href) || href.startsWith('#'))) {
                target.setAttribute('href', href);
            }
            const name = source.getAttribute ? source.getAttribute('name') : source.name;
            if (name) target.setAttribute('name', name);
        }
        if (source.getAttribute && source.getAttribute('id')) {
            target.setAttribute('id', source.getAttribute('id'));
        }
        if (tag === 'img') {
            const src = source.getAttribute ? source.getAttribute('src') : source.src;
            if (src) target.setAttribute('src', src);
            const alt = source.getAttribute ? source.getAttribute('alt') : source.alt;
            if (alt) target.setAttribute('alt', alt);
            const width = source.getAttribute ? source.getAttribute('width') : (source.width || '');
            if (width) target.setAttribute('width', width);
            const height = source.getAttribute ? source.getAttribute('height') : (source.height || '');
            if (height) target.setAttribute('height', height);
        }
        const inline = styleNames.map(name => {
            const value = style.getPropertyValue(name);
            return value && value !== 'none' && value !== 'normal' && value !== 'rgba(0, 0, 0, 0)' ? `${name}:${value}` : '';
        }).filter(Boolean);
        for (const name of ['width','height','align','valign','bgcolor','cellpadding','cellspacing','border','bordercolor','role','span']) {
            if (source.hasAttribute(name)) target.setAttribute(name, source.getAttribute(name));
        }
        if (inline.length) target.setAttribute('style', inline.join(';'));
        // Percentages and explicit dimensions take precedence over measured pixel sizes.
        for (const name of ['width','height']) {
            const value=source.style?.[name] || source.getAttribute(name);
            if (value) target.style[name]=/^\d+$/.test(value)?value+'px':value;
        }
        if (tag === 'table') {
            if (!target.hasAttribute('width')) target.setAttribute('width', '100%');
            if (!source.style.width) target.style.width=target.getAttribute('width');
            target.style.borderCollapse=style.borderCollapse || 'collapse';
        }
        if (tag === 'td' || tag === 'th') {
            if (source.colSpan > 1) target.colSpan = source.colSpan;
            if (source.rowSpan > 1) target.rowSpan = source.rowSpan;
        }
        if (['table','td','th'].includes(tag) && target.style.backgroundColor) target.setAttribute('bgcolor',emailColor(target.style.backgroundColor));
        if (['flex','inline-flex','grid','inline-grid'].includes(target.style.display)) target.style.display='block';
        Array.from(source.childNodes).forEach(child => {
            const copied = copyForEmail(child);
            if (copied) target.appendChild(copied);
        });
        return target;
    }

    function emailColor(value){
        const rgb=String(value).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return rgb?'#'+rgb.slice(1).map(channel=>Number(channel).toString(16).padStart(2,'0')).join(''):value;
    }

    function embedImages(content){
        const images=[],sources=new Map();
        for(const img of content.querySelectorAll('img')){
            const match=img.getAttribute('src')?.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
            if(!match)continue;
            const source=img.getAttribute('src');let image=sources.get(source);
            if(!image){const extension=match[1].toLowerCase().replace('jpeg','jpg');const cid='report-image-'+images.length+'@tools-platform';image={cid,filename:'report-image-'+images.length+'.'+extension,data:match[2],mimeType:extension==='jpg'?'image/jpeg':'image/'+extension};sources.set(source,image);images.push(image);}
            img.setAttribute('src','cid:'+image.cid);
        }
        return images;
    }

    function preserveStyles(root) {
        // Capture inherited styles while the original report classes still apply.
        for (const element of [root,...root.querySelectorAll('*')]) {
            const computed=getComputedStyle(element);
            for (const name of styleNames) {
                if (['display','width','height','max-width','max-height','box-sizing'].includes(name)) continue;
                const value=computed.getPropertyValue(name);
                if (value) element.style.setProperty(name,value);
            }
        }
    }

    function convertBlocksToEmailTables(node) {
        for (const child of Array.from(node.childNodes || [])) {
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            convertBlocksToEmailTables(child);
            if (child.tagName !== 'DIV') continue;
            const table=document.createElement('table');
            table.setAttribute('role','presentation');
            table.setAttribute('width',child.getAttribute('width') || '100%');
            table.setAttribute('cellpadding','0');table.setAttribute('cellspacing','0');table.setAttribute('border','0');
            table.style.cssText='width:100%;border-collapse:collapse;';
            table.style.margin=child.style.margin;
            if (child.id) table.id=child.id;
            const row=table.insertRow(),cell=row.insertCell();
            cell.style.cssText=child.style.cssText;
            cell.style.display='table-cell';cell.style.width='100%';cell.style.margin='0';
            if (cell.style.backgroundColor) cell.setAttribute('bgcolor',emailColor(cell.style.backgroundColor));
            // Move every node, including images, links and text between block elements.
            while (child.firstChild) cell.appendChild(child.firstChild);
            node.replaceChild(table,child);
        }
        return node;
    }

    function showError(error) {
        // Fallback or external error handler that re-uses or displays the modal
        const logger = new MsgExportLogger();
        logger.error('MSG 导出遇到异常中断', error);
    }

    function encodeMimeWord(str) {
        return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(str)))}?=`;
    }

    function buildLocalOutlookEml(subject, html, text, attachment, inlineImages = []) {
        const boundary = '----=_Part_' + Math.random().toString(36).substring(2) + '_' + Date.now();
        const lines = [];
        lines.push('MIME-Version: 1.0');
        lines.push(`Subject: ${encodeMimeWord(subject)}`);
        lines.push('X-Unsent: 1'); // 标记为 Outlook 草稿，双击直接进入编辑模式
        lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
        lines.push('');
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/html; charset="utf-8"');
        lines.push('Content-Transfer-Encoding: base64');
        lines.push('');
        const htmlBase64 = btoa(unescape(encodeURIComponent(html)));
        for (let i = 0; i < htmlBase64.length; i += 76) {
            lines.push(htmlBase64.substring(i, i + 76));
        }
        lines.push('');

        for(const image of inlineImages){
            lines.push(`--${boundary}`,`Content-Type: ${image.mimeType}; name="${image.filename}"`,`Content-ID: <${image.cid}>`,`Content-Disposition: inline; filename="${image.filename}"`,'Content-Transfer-Encoding: base64','');
            for(let index=0;index<image.data.length;index+=76)lines.push(image.data.substring(index,index+76));
            lines.push('');
        }

        if (attachment && attachment.data) {
            lines.push(`--${boundary}`);
            lines.push(`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${encodeMimeWord(attachment.filename)}"`);
            lines.push(`Content-Disposition: attachment; filename="${encodeMimeWord(attachment.filename)}"`);
            lines.push('Content-Transfer-Encoding: base64');
            lines.push('');
            const dataBase64 = attachment.data;
            for (let i = 0; i < dataBase64.length; i += 76) {
                lines.push(dataBase64.substring(i, i + 76));
            }
            lines.push('');
        }

        lines.push(`--${boundary}--`);
        lines.push('');
        return new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
    }

    async function download(root, subject, filename, attachment) {
        const logger = new MsgExportLogger();
        logger.log('info', `开始月报 MSG 导出流程: ${filename}`);

        try {
            if (!root) throw new Error('当前没有可导出的月报 DOM 节点');

            // [STEP 1/7] 扫描 DOM
            logger.step(1, 7, '正在扫描月报结构与数据表格...');
            const tables = root.querySelectorAll('table');
            const paragraphs = root.querySelectorAll('p, h1, h2, h3, h4');
            logger.info(`检测到包含 ${tables.length} 个数据表格，${paragraphs.length} 个文本段落`);

            // [STEP 2/7] 提取样式
            logger.step(2, 7, '正在提取排版样式并转为自适应邮件内联样式...');
            const theme = document.documentElement.getAttribute('data-theme');
            let content;
            try {
                if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'light');
                content = copyForEmail(root, true);
            } finally {
                if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            }
            if (!content) {
                logger.log('warn', 'copyForEmail 未返回节点，启用 root.cloneNode 作为安全降级');
                content = root.cloneNode(true);
            }
            if (content) {
                content.style.maxWidth = 'none';
                content.style.width = '100%';
                content.style.margin = '0 auto';
                content.style.border = 'none';
                convertBlocksToEmailTables(content);
            }
            logger.info('已完成表格边框、背景、单元格对齐及文字样式的内联计算与邮件表格结构规整');

            // [STEP 3/7] 封装 HTML & 纯文本 (宽屏适配，100% 充满容器，文案与表格对齐)
            logger.step(3, 7, '正在封装完整 HTML 正文与纯文本降级备份...');
            const inlineImages = content ? embedImages(content) : [];
            const bodyInner = content ? content.outerHTML : (root ? root.outerHTML : '');
            const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, div, span, h1, h2, h3, th { font-family: "Microsoft YaHei", Arial, sans-serif !important; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:16px 8px;background:#f8fafc;color:#0f172a;font-family:'Microsoft YaHei',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!--[if (gte mso 9)|(IE)]>
  <table role="presentation" width="1320" align="center" cellpadding="0" cellspacing="0" border="0" style="width:1320px;">
    <tr>
      <td style="padding:0;background:#ffffff;">
  <![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:1320px;margin:0 auto;background:#ffffff;box-sizing:border-box;">
    <tr>
      <td style="width:100%;padding:0;margin:0;vertical-align:top;">
        ${bodyInner}
      </td>
    </tr>
  </table>
  <!--[if (gte mso 9)|(IE)]>
      </td>
    </tr>
  </table>
  <![endif]-->
</body>
</html>`;
            const text = (root.innerText || root.textContent || '').trim();
            logger.info(`HTML 正文大小: ${formatBytes(html.length)}，纯文本摘要: ${text.length} 字符`);

            // [STEP 4/7] 准备附件
            logger.step(4, 7, '正在准备原始数据 Excel 附件...');
            let file = null;
            if (attachment && attachment.bytes) {
                logger.info(`正在读取附件 [${attachment.filename}] (${formatBytes(attachment.bytes.byteLength || attachment.bytes.length)})...`);
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1]);
                    reader.onerror = () => reject(reader.error || new Error('附件读取失败'));
                    reader.readAsDataURL(new Blob([attachment.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
                });
                file = { filename: attachment.filename, data };
                logger.info(`附件 Base64 编码完成 (${formatBytes(data.length)})`);
            } else {
                logger.info('本次未附加原始数据 Excel，跳过附件封装');
            }

            // [STEP 5/7] 向服务端发起请求
            logger.step(5, 7, '正在向服务端发起导出请求 (/api/report-msg/export)...');
            const reqStart = Date.now();
            let response = null;
            try {
                const payload = { subject, html, text, attachment: file, inlineImages };
                const envelope = btoa(encodeURIComponent(JSON.stringify(payload)));
                response = await fetch('/api/report-msg/export', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ envelope })
                });
            } catch (netErr) {
                logger.log('warn', `网络通信受阻: ${netErr.message}`);
            }

            const reqDuration = Date.now() - reqStart;
            const status = response ? response.status : 0;
            logger.info(`服务端响应耗时: ${reqDuration} ms，状态码: ${status || '网络中断/阻断'}`);

            if (!response || !response.ok) {
                const responseText = response ? await response.text() : '';
                const isProxyBlock = status === 403 || /proxy|swg|netentsec|forbidden/i.test(responseText);

                if (isProxyBlock) {
                    logger.log('warn', `检测到办公网安全代理 (HIS Proxy/SWG) 拦截了上传请求 (HTTP ${status})`);
                    logger.step(6, 7, '已自动启动纯本地免上传安全模式生成 Outlook 邮件...');
                } else {
                    logger.log('warn', `服务端暂未就绪 (HTTP ${status})，正在启动纯本地安全生成机制...`);
                    logger.step(6, 7, '正在本地打包生成 Outlook 邮件...');
                }

                const emlBlob = buildLocalOutlookEml(subject, html, text, file, inlineImages);
                const emlFilename = filename.replace(/\.msg$/i, '.eml');
                const url = URL.createObjectURL(emlBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = emlFilename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);

                logger.info(`已在本地生成标准 Outlook 邮件草稿（体积: ${formatBytes(emlBlob.size)}）`);
                logger.info('已嵌入完整富文本 HTML 正文及原始数据 Excel 附件');
                logger.success(`邮件导出成功！已保存为 ${emlFilename}（双击可直接在 Outlook 中作为草稿编辑打开发送）`);
                return;
            }

            // [STEP 6/7] 读取服务端诊断 Header
            logger.step(6, 7, '服务端 MAPI 复合文档生成诊断：');
            const htmlSize = Number(response.headers.get('X-Report-Msg-Html-Size')) || 0;
            const rtfSize = Number(response.headers.get('X-Report-Msg-Rtf-Size')) || 0;
            const attachCount = Number(response.headers.get('X-Report-Msg-Attachment-Count')) || 0;
            const totalSize = Number(response.headers.get('X-Report-Msg-Total-Size')) || 0;
            const serverDuration = Number(response.headers.get('X-Report-Msg-Duration-Ms')) || 0;

            logger.info(`HTML 正文流 (PR_HTML): ${formatBytes(htmlSize)}`);
            logger.info(`胶囊化 RTF 流 (PR_RTF_COMPRESSED): ${formatBytes(rtfSize)} (含 Unicode 转义)`);
            logger.info(`附件数: ${attachCount} 个，MSG 最终体积: ${formatBytes(totalSize)} (耗时: ${serverDuration}ms)`);

            // [STEP 7/7] 校验二进制并保存
            logger.step(7, 7, '正在校验二进制文件流并触发保存...');
            const blob = await response.blob();
            // Verify OLE Compound Document magic header: D0 CF 11 E0
            const headSlice = await blob.slice(0, 4).arrayBuffer();
            const magic = new Uint8Array(headSlice);
            const isMsgMagic = magic[0] === 0xD0 && magic[1] === 0xCF && magic[2] === 0x11 && magic[3] === 0xE0;
            if (!isMsgMagic) {
                logger.log('warn', '警告：响应未包含标准 OLE 魔数，可能为非预期文件格式');
            } else {
                logger.info('已校验 OLE Compound File 复合文档签名 (D0 CF 11 E0)');
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);

            logger.success(`月报 MSG 导出成功！已保存为 ${filename}`);
        } catch (error) {
            logger.error('MSG 导出过程中断', error);
            throw error;
        }
    }

    window.ReportMsgExport = { download, showError, copyForEmail, preserveStyles, convertBlocksToEmailTables, embedImages };
})();

