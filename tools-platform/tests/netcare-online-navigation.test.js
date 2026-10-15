const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/f12-to-extension/netcare-rfc-word.js'), 'utf8');
const helperStart = source.indexOf('function netcareOnlineFrames(');
const helperEnd = source.indexOf('// Search/authorization uses shared site UI', helperStart);
const openStart = source.indexOf('  async function openOnline(order, doc, button, signal) {');
const openEnd = source.indexOf('  async function prepare(', openStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart && openStart >= 0 && openEnd > openStart);
const navigationCode = source.slice(helperStart, helperEnd) + source.slice(openStart, openEnd);
const order = 'NC20260218000069', otherOrder = 'NC20260114002616';
const onlineUrl = (rfc = order, host = 'de.kdp.gts.huawei.com') => `https://${host}/ows1/static/editor/IdpLiteView/OwsPage.html?docId=D${rfc}&order_id=${rfc}&type=NCReadOnly`;

function harness(options = {}) {
  const controller = new AbortController(), messages = [], logs = [], timers = new Map();
  let timerId = 0, clicks = 0;
  const makeDocument = () => ({
    baseURI: 'https://netcare.huawei.com/p/netcare/index.html', frames: [], backs: [],
    querySelectorAll(selector) { return selector === 'iframe' ? this.frames : selector === '.solution_normal_text' ? this.backs : []; }
  });
  const doc = makeDocument(), document = makeDocument();
  document.createElement = () => ({ style: {}, textContent: '' });
  document.createTextNode = textContent => ({ textContent });
  const online = {
    children: [], textContent: '',
    append(node) { this.children.push(node); this.textContent += node.textContent; },
    replaceChildren(...nodes) { this.children = nodes; this.textContent = nodes.map(node => node.textContent).join(''); }
  };
  const onlineRequests = new Map();
  const context = {
    URL, crypto, Map, Set, location: new URL(doc.baseURI), document, rows: new Map([[order, { online }]]), onlineRequests,
    currentBatch: { started: 1 }, visible: node => node.visible === true,
    netcareLog: entry => logs.push(entry), inspectPortalState: () => ({ phase: 'online' }),
    setTimeout(fn, ms) {
      const id = ++timerId; timers.set(id, { fn, ms });
      queueMicrotask(() => {
        const next = [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)[0];
        if (next) { timers.delete(next[0]); next[1].fn(); }
      });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    wait: async (fn, _timeout, signal, failure) => {
      for (let step = 0; step < 3; step++) {
        if (signal.aborted) throw Error('已停止等待');
        options.onWait?.(api, step);
        const value = fn();
        if (value) return value;
        await Promise.resolve();
      }
      throw Error(failure);
    },
    window: { postMessage(message, origin) {
      messages.push({ message, origin });
      if (options.relay === 'reject') onlineRequests.get(message.id)?.reject(Error('网站权限拒绝 / Site access denied'));
      else if (options.relay === 'abort') controller.abort();
      else if (options.relay !== 'timeout') onlineRequests.get(message.id)?.resolve();
    } }
  };
  const title = { click() { clicks++; options.onClick?.(api); } };
  const button = { closest: () => ({ querySelector: () => options.missingTitle ? null : title }) };
  vm.createContext(context); vm.runInContext(navigationCode, context);
  const api = {
    doc, document, messages, logs, online, onlineRequests, controller, context,
    get clicks() { return clicks; },
    addFrame(target = doc, values = {}) {
      const frame = { id: '', src: onlineUrl(), visible: true, isConnected: true, ownerDocument: target, ...values };
      frame.getAttribute = name => name === 'src' ? frame.src : null;
      target.frames.push(frame); return frame;
    },
    addBack(target = doc, values = {}) {
      const back = { textContent: '返回RFC/HC', visible: true, clicks: 0, click() { this.clicks++; }, ...values };
      target.backs.push(back); return back;
    },
    open: () => context.openOnline(order, doc, button, controller.signal)
  };
  return api;
}

test('online navigation recognizes a native portal SPA iframe and opens one validated independent tab', async () => {
  const h = harness({ onClick(h) { h.addFrame(h.document, { id: 'iframe-40' }); } });
  const unrelatedBack = h.addBack(h.document);
  await h.open();
  assert.equal(h.clicks, 1);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].message.source, 'TP_RFC_OPEN_REQUEST');
  assert.equal(h.messages[0].message.url, onlineUrl());
  assert.equal(h.messages[0].origin, 'https://netcare.huawei.com');
  assert.match(h.online.textContent, /Tab opened/);
  assert.equal(h.logs.find(entry => entry.action === 'online.entry.matched').data.scope, 'portal');
  assert.equal(unrelatedBack.clicks, 0);
  assert.equal(h.onlineRequests.size, 0);
});

test('all candidates are searched after hidden, malformed and other-RFC frames in both documents', async () => {
  const h = harness({ onClick(h) { h.addFrame(h.document, { id: 'iframe-448' }); } });
  h.addFrame(h.doc, { id: 'IdpFrame', visible: false });
  h.addFrame(h.doc, { src: onlineUrl(otherOrder) });
  h.addFrame(h.document, { id: 'IdpFrame', src: 'https://[' });
  h.addFrame(h.document, { src: onlineUrl(otherOrder) });
  await h.open();
  assert.equal(h.messages.length, 1);
  assert.equal(new URL(h.messages[0].message.url).searchParams.get('docId'), 'D' + order);
  assert.equal(h.logs.filter(entry => entry.action === 'online.entry.rejected').length, 2);
});

test('an existing hidden native frame is recognized when this click reveals it, including id fallback', async () => {
  let frame;
  const h = harness({ onClick() { frame.visible = true; } });
  frame = h.addFrame(h.doc, { id: 'IdpFrame', visible: false, src: onlineUrl().replace('docId=', 'id=') });
  await h.open();
  const url = new URL(h.messages[0].message.url);
  assert.equal(url.searchParams.get('docId'), 'D' + order);
  assert.equal(url.searchParams.get('order_id'), order);
});

test('a reused frame is recognized after its native URL changes to the selected RFC', async () => {
  let frame;
  const h = harness({ onClick() { frame.src = onlineUrl(); } });
  frame = h.addFrame(h.document, { id: 'IdpFrame', src: onlineUrl(otherOrder) });
  await h.open();
  assert.equal(h.messages.length, 1);
});

test('previous visible matching tabs are not mistaken for the result of this native click', async () => {
  const h = harness(); h.addFrame(h.document);
  await assert.rejects(h.open(), /Only an earlier solution is visible/);
  assert.equal(h.messages.length, 0);
  assert.match(h.online.textContent, /Online entry recognition failed/);
});

test('only a newly revealed detail Return control is used; other-RFC portal controls remain intact', async () => {
  for (const textContent of ['返回RFC/HC', 'Back to RFC/HC', 'Return to RFC']) {
    let back;
    const h = harness({ onClick(h) { h.addFrame(); back.visible = true; } });
    back = h.addBack(h.doc, { textContent, visible: false });
    const oldBack = h.addBack(h.doc), portalBack = h.addBack(h.document);
    await h.open();
    assert.equal(back.clicks, 1, textContent);
    assert.equal(oldBack.clicks, 0);
    assert.equal(portalBack.clicks, 0);
  }
});

test('ambiguous newly created Return controls are left for native user navigation', async () => {
  let backs;
  const h = harness({ onClick(h) { h.addFrame(); backs = [h.addBack(), h.addBack()]; } });
  await h.open();
  assert.ok(backs.every(back => back.clicks === 0));
});

test('cleanup does not navigate when the matched inline frame has changed to a different RFC', async () => {
  let frame, back;
  const h = harness({ onClick(h) { frame = h.addFrame(); back = h.addBack(); } });
  const postMessage = h.context.window.postMessage;
  h.context.window.postMessage = (...args) => { postMessage(...args); frame.src = onlineUrl(otherOrder); };
  await h.open();
  assert.equal(back.clicks, 0);
});

test('unsafe hosts, protocols, paths, credentials, ports and conflicting RFCs never reach the open relay', async () => {
  const rejectedUrls = [
    onlineUrl(order, 'de.kdp.gts.huawei.com.evil.example'),
    onlineUrl().replace('https:', 'http:'),
    onlineUrl().replace('/ows1/static/', '/other/'),
    onlineUrl().replace('https://', 'https://user:secret@'),
    onlineUrl().replace('.com/', '.com:8443/'),
    onlineUrl().replace('order_id=' + order, 'order_id=' + otherOrder)
  ];
  for (const src of rejectedUrls) {
    const h = harness({ onClick(h) { h.addFrame(h.document, { src }); } });
    await assert.rejects(h.open(), /their addresses or RFCs do not match/);
    assert.equal(h.messages.length, 0);
    assert.equal(h.logs.some(entry => JSON.stringify(entry).includes('secret')), false);
  }
});

test('hidden online frames and a missing native entry fail explicitly without misleading authorization advice', async () => {
  for (const onClick of [undefined, h => h.addFrame(h.document, { visible: false })]) {
    const h = harness({ onClick });
    await assert.rejects(h.open(), /No matching online entry appeared/);
    assert.equal(h.messages.length, 0);
    assert.doesNotMatch(h.online.textContent, /授权|Tab status unconfirmed/);
  }
});

test('native entry can arrive after a portal SPA update rather than during the click callback', async () => {
  const h = harness({ onWait(h, step) { if (step === 1) h.addFrame(h.document); } });
  await h.open();
  assert.equal(h.messages.length, 1);
});

test('extension rejection and timeout propagate to the workflow while retaining the manual native link', async () => {
  for (const relay of ['reject', 'timeout']) {
    const h = harness({ relay, onClick(h) { h.addFrame(h.document); } });
    await assert.rejects(h.open(), relay === 'reject' ? /Site access denied/ : /扩展未响应/);
    assert.equal(h.messages.length, 1);
    assert.equal(h.online.children[0].href, onlineUrl());
    assert.match(h.online.textContent, /Separate solution tab failed to open/);
    assert.doesNotMatch(h.online.textContent, /Tab opened/);
    assert.equal(h.onlineRequests.size, 0);
  }
});

test('stopping before native click, during discovery or during the relay never reports a successful open', async () => {
  const before = harness(); before.controller.abort();
  await assert.rejects(before.open(), /stopped/);
  assert.equal(before.clicks, 0);
  const discovery = harness({ onWait(h) { h.controller.abort(); } });
  await assert.rejects(discovery.open(), /已停止等待/);
  assert.equal(discovery.messages.length, 0);
  const relay = harness({ relay: 'abort', onClick(h) { h.addFrame(h.document); } });
  await assert.rejects(relay.open(), /已停止等待/);
  assert.equal(relay.onlineRequests.size, 0);
  assert.doesNotMatch(relay.online.textContent, /Tab opened/);
});

test('missing selected solution title fails before touching native navigation', async () => {
  const h = harness({ missingTitle: true });
  await assert.rejects(h.open(), /Selected solution entry not found/);
  assert.equal(h.clicks, 0);
  assert.equal(h.messages.length, 0);
});
