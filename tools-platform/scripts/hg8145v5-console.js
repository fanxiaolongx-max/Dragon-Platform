// 在已登录的 HG8145V5 /index.asp 顶层 DevTools Console 中运行。
// hg8145v5.menu()                         列出当前菜单的页面
// await hg8145v5.get('waninfo')           读取单页
// await hg8145v5.scan()                   顺序读取菜单页面
// await hg8145v5.open('waninfo')         用固件菜单打开单页并采集
// hg8145v5.capture()                     保存当前 iframe 的渲染结果
// hg8145v5.watch() / hg8145v5.stopWatch()  随手动切换菜单保存渲染结果
// await hg8145v5.wan()                    读取首页 WAN 轮询状态
// hg8145v5.report() / hg8145v5.download() 查看报告或下载本地 JSON

(() => {
  'use strict';

  if (location.origin !== 'https://192.168.100.1' || window !== window.top ||
      location.pathname !== '/index.asp' || !document.querySelector('#menuIframe') ||
      typeof menulist !== 'object' || !menulist) {
    throw new Error('请在已登录的 https://192.168.100.1/index.asp 顶层 Console 运行。');
  }

  const secret = /pass(?:word|phrase|wd)?|pwd|psk|pre[\s_.-]*shared|sae[\s_.-]*key|(?:wep|wpa|encryption|private|secret|access|network|auth|api|wifi|wlan)[\s_.-]*(?:key|password)|key(?:index|[1-4]|value)|\bkey\b|credential|token|cookie|authorization|csrf|secret|community|\bpin\b|密码|密钥|令牌|رمز المرور|كلمة المرور/i;
  const operations = /^(?:\/[^/]+\/)*[^/]*(?:logout|login|reboot|restart|reset|restore|upload|download|backup|export|delete|factory)[^/]*$/i;
  const readings = new Map();
  const captures = new Map();
  let wanReading = null;
  let scanning = false;
  let opening = false;
  let timer = null;
  const frame = document.querySelector('#menuIframe');

  function pageURL(value) {
    const url = new URL(value, location.href);
    url.hash = '';
    if (url.origin !== location.origin || url.username || url.password ||
        !/^\/(?:html|CustomApp)\/[\w/.-]+\.asp$/i.test(url.pathname) ||
        operations.test(url.pathname) || !/^(?:|\?(?:2G|5G))$/.test(url.search)) {
      throw new Error('不在本次读取范围内');
    }
    return url;
  }

  const pages = Object.values(menulist).filter(item => item?.path && item.url && !item.hasChild)
    .map(item => {
      try {
        return { id: item.id, path: item.path, url: pageURL(item.url).href };
      } catch {
        return { id: item.id, path: item.path, skipped: '页面地址超出只读范围' };
      }
    });

  function menu() {
    return pages.map(page => ({ ...page, url: page.url && page.url.slice(location.origin.length) }));
  }

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function visible(node, rendered) {
    if (node.closest('[hidden], [aria-hidden="true"]')) return false;
    if (!rendered) return !node.closest('[style*="display:none" i], [style*="display: none" i]');
    return node.getClientRects().length > 0 && node.ownerDocument.defaultView
      .getComputedStyle(node).visibility === 'visible';
  }

  function readText(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('script, style, template, textarea, select, input, button, [hidden], [aria-hidden="true"]').forEach(child => child.remove());
    return clean(copy.textContent);
  }

  function extract(root, rendered) {
    const headings = [...root.querySelectorAll('title, h1, h2, h3, caption, legend, .PageTitle, .TitleText')]
      .filter(node => node.tagName === 'TITLE' || visible(node, rendered))
      .map(readText).filter(value => value && !secret.test(value));

    const tables = [...root.querySelectorAll('table')].flatMap(table => {
      const rows = [...table.rows]
        .filter(row => visible(row, rendered) && !row.querySelector('table'))
        .map(row => [...row.cells].filter(cell => visible(cell, rendered)).map(readText));
      const header = rows.find(row => row.filter(Boolean).length > 2) ?? [];
      const sensitiveColumns = new Set(header.flatMap((cell, index) => secret.test(cell) ? [index] : []));
      const data = rows.filter(row => row.filter(Boolean).length > 1).map(row => {
        if (secret.test(row[0])) return [row[0], ...row.slice(1).map(() => '[已隐藏]')];
        return row.map((cell, index) => sensitiveColumns.has(index) || secret.test(cell) ? '[已隐藏]' : cell);
      });
      return data.length ? [data] : [];
    });

    const fields = [...root.querySelectorAll('input, select, textarea')].flatMap(node => {
      if (['hidden', 'password', 'file', 'button', 'submit', 'reset', 'image'].includes(node.type) ||
          !visible(node, rendered)) return [];
      const name = node.name || node.id;
      const row = node.closest('tr');
      const cell = node.closest('td');
      const label = clean([...node.labels ?? []].map(readText).join(' ') ||
        node.getAttribute('aria-label') || (cell && cell === row?.cells[1] ? readText(row.cells[0]) : '') ||
        node.title || name);
      if (!label || secret.test([name, label, node.autocomplete, row?.cells[0] && readText(row.cells[0])].join(' '))) return [];
      let value;
      if (['checkbox', 'radio'].includes(node.type)) {
        value = rendered ? node.checked : node.hasAttribute('checked');
      } else if (node.tagName === 'SELECT') {
        const selected = rendered ? [...node.selectedOptions] : [...node.options].filter(option => option.defaultSelected);
        value = selected.map(option => clean(option.textContent));
      } else {
        value = clean(rendered ? node.value : node.defaultValue);
      }
      return [{ name, label, value }];
    });

    const overview = ['InterNetStatusTextDiv', 'ContectNumDetails'].flatMap(id => {
      const node = root.querySelector('#' + id);
      return node && visible(node, rendered) ? [readText(node)] : [];
    }).filter(Boolean);

    return { headings: [...new Set(headings)], overview, tables, fields,
      scriptCount: root.querySelectorAll('script').length };
  }

  async function fetchPage(url) {
    const response = await fetch(url, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return { status: response.status, text: await response.text() };
  }

  async function read(page) {
    if (page.skipped) return { path: page.path, skipped: page.skipped };
    try {
      const { status, text } = await fetchPage(page.url);
      // template 内容保持惰性，固件脚本、iframe 和其他资源不会运行或加载。
      const template = document.createElement('template');
      template.innerHTML = text;
      if (template.content.querySelector('form[action*="login" i], input[autocomplete="current-password"]') ||
          /\/index\.asp$/i.test(new URL(page.url).pathname)) {
        throw new Error('响应疑似登录页，请检查会话');
      }
      return { path: page.path, url: new URL(page.url).pathname + new URL(page.url).search,
        status, ...extract(template.content, false) };
    } catch (error) {
      return { path: page.path, error: error instanceof TypeError ? '请求失败或收到重定向' : error.message };
    }
  }

  function findPage(key) {
    const page = pages.find(item => item.path === key) ?? pages.find(item => item.id && item.id === key);
    if (!page) throw new Error('找不到该菜单入口，请先运行 hg8145v5.menu()。');
    return page;
  }

  async function get(key) {
    const page = findPage(key);
    const result = await read(page);
    readings.set(page.path, result);
    return result;
  }

  async function scan() {
    if (scanning) throw new Error('已有扫描正在运行。');
    scanning = true;
    const results = [];
    try {
      for (const page of pages) {
        const result = await get(page.path);
        results.push(result);
        if (results.length < pages.length) await new Promise(resolve => setTimeout(resolve, 300));
      }
      console.table(results.map(({ path, status, tables, fields, error, skipped }) =>
        ({ path, status, tables: tables?.length, fields: fields?.length, result: error ?? skipped ?? 'OK' })));
      return results;
    } finally {
      scanning = false;
    }
  }

  function capture() {
    const doc = frame.contentDocument;
    if (!doc?.body || doc.readyState !== 'complete') throw new Error('请等当前页面加载完成再采集。');
    const url = pageURL(doc.URL);
    const page = pages.find(item => item.url === url.href);
    const path = page?.path ?? url.pathname + url.search;
    const result = { path, url: url.pathname + url.search, capturedAt: new Date().toISOString(),
      ...extract(doc, true) };
    captures.set(path, result);
    return result;
  }

  async function open(key) {
    const page = findPage(key);
    if (!page.id || !page.url || typeof onMenuChange !== 'function') {
      throw new Error('请通过固件菜单打开该页，再运行 hg8145v5.capture()。');
    }
    if (opening) throw new Error('已有页面正在打开。');
    if (frame.contentDocument?.URL === page.url && frame.contentDocument.readyState === 'complete') {
      return capture();
    }

    opening = true;
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          frame.removeEventListener('load', onLoad);
          reject(new Error('页面未在 15 秒内加载。若界面仍在加载，可稍后运行 hg8145v5.capture()。'));
        }, 15000);

        function onLoad() {
          if (frame.contentDocument?.URL !== page.url) return;
          clearTimeout(timeout);
          frame.removeEventListener('load', onLoad);
          try { resolve(capture()); } catch (error) { reject(error); }
        }

        frame.addEventListener('load', onLoad);
        try { onMenuChange(page.id); } catch (error) {
          clearTimeout(timeout);
          frame.removeEventListener('load', onLoad);
          reject(error);
        }
      });
    } finally {
      opening = false;
    }
  }

  function captureAfterLoad() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { capture(); } catch { /* 加载中或离开目标页面时，可随后手动采集。 */ }
    }, 700);
  }

  async function wan() {
    const { status, text } = await fetchPage('/html/bbsp/common/wanStateMonitor.asp');
    const value = text.trim();
    wanReading = { status, capturedAt: new Date().toISOString(),
      value: /^(?:[0-9]{1,3}|true|false|up|down|normal|connected|disconnected)$/i.test(value) ? value : null };
    return wanReading;
  }

  function report() {
    return { source: location.origin, exportedAt: new Date().toISOString(), menu: menu(),
      responses: [...readings.values()], rendered: [...captures.values()], wan: wanReading };
  }

  function download() {
    const blobURL = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobURL;
    link.download = 'hg8145v5-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
  }

  window.hg8145v5?.stopWatch?.();
  window.hg8145v5 = { menu, get, scan, open, capture, watch() {
    frame.addEventListener('load', captureAfterLoad);
    captureAfterLoad();
  }, stopWatch() {
    frame.removeEventListener('load', captureAfterLoad);
    clearTimeout(timer);
  }, wan, report, download };

  console.info('HG8145V5 已就绪，菜单页面数 ' + pages.length + '。运行 await hg8145v5.scan() 开始读取。');
})();
