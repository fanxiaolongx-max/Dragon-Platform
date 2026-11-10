const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('requirements image upload supports incremental addition, limit of 6, deletion, and preview navigation', () => {
    const urlsCreated = [];
    const urlsRevoked = [];

    const elements = {
        reqImagesInput: { value: '', files: [] },
        reqUploadDropzone: { classList: { add() {}, remove() {} }, addEventListener() {} },
        reqImagesCount: { textContent: '' },
        reqImagesPicker: { style: {} },
        reqImagesSection: { hidden: false },
        reqImagesList: { children: [], replaceChildren(...nodes) { this.children = nodes; }, append(node) { this.children.push(node); } },
        reqPreviewModal: { style: { display: 'none' } },
        reqPreviewFilename: { textContent: '' },
        reqPreviewIndex: { textContent: '' },
        reqPreviewImage: { src: '' },
        reqPreviewPrev: { disabled: false },
        reqPreviewNext: { disabled: false },
        reqModal: { style: { display: 'flex' } },
        modalTitle: { textContent: '' },
        manageRow: { style: {} },
        remarkGroup: { style: {} },
        flowchartContainer: { style: {} },
        logsSection: { style: {} },
        btnDeleteReq: { style: {} },
        reqTitleInput: { value: 'Test title', disabled: false },
        reqCategorySelect: { value: '全局通用', disabled: false },
        reqDescInput: { value: 'Test description', disabled: false },
        reqStatusSelect: { value: '提交', disabled: false },
        reqAssigneeInput: { value: '', disabled: false },
        reqRemarkInput: { value: '', disabled: false },
        reqUrgentInput: { checked: false, disabled: false },
        btnSaveReq: { textContent: '保存', disabled: false, style: {} }
    };

    const notices = [];
    const context = {
        window: {
            addEventListener() {},
            crypto: { subtle: {} }
        },
        document: {
            addEventListener() {},
            getElementById: id => elements[id] || { style: {}, addEventListener() {} },
            createElement: tag => ({
                tagName: tag.toUpperCase(),
                className: '',
                style: {},
                children: [],
                setAttribute(k, v) { this[k] = v; },
                append(...args) { this.children.push(...args); },
                addEventListener() {}
            })
        },
        URL: {
            createObjectURL: file => {
                const url = `blob:test-${file.name}`;
                urlsCreated.push(url);
                return url;
            },
            revokeObjectURL: url => {
                urlsRevoked.push(url);
            }
        },
        showToast: (msg, type) => notices.push({ msg, type }),
        API: {}
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/requirements-client.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/requirements.js'), 'utf8'), context);

    const ReqApp = vm.runInContext('ReqApp', context);
    assert.ok(ReqApp);

    // Initial render in create mode
    ReqApp.openCreateModal();
    assert.equal(ReqApp.pendingImages.length, 0);
    assert.equal(ReqApp.existingImages.length, 0);
    assert.equal(elements.reqImagesCount.textContent, '(0/6)');
    assert.equal(elements.reqImagesPicker.style.display, 'flex');

    // Add 2 images
    const file1 = { name: 'img1.png', size: 1024, type: 'image/png', lastModified: 1000 };
    const file2 = { name: 'img2.jpg', size: 2048, type: 'image/jpeg', lastModified: 2000 };
    ReqApp.handleFilesSelected([file1, file2]);

    assert.equal(ReqApp.pendingImages.length, 2);
    assert.equal(elements.reqImagesCount.textContent, '(2/6)');
    assert.equal(elements.reqImagesList.children.length, 2);
    assert.equal(urlsCreated.length, 2);

    // Incremental upload: add 2 more images
    const file3 = { name: 'img3.webp', size: 3000, type: 'image/webp', lastModified: 3000 };
    const file4 = { name: 'img4.gif', size: 4000, type: 'image/gif', lastModified: 4000 };
    ReqApp.handleFilesSelected([file3, file4]);

    assert.equal(ReqApp.pendingImages.length, 4);
    assert.equal(elements.reqImagesCount.textContent, '(4/6)');
    assert.equal(elements.reqImagesList.children.length, 4);

    // Reject oversized file (> 20MB)
    const bigFile = { name: 'big.png', size: 25 * 1024 * 1024, type: 'image/png', lastModified: 5000 };
    ReqApp.handleFilesSelected([bigFile]);
    assert.equal(ReqApp.pendingImages.length, 4, 'Oversized file must be rejected');
    assert.ok(notices.some(n => n.msg.includes('20 MB')));

    // Reject invalid type
    const exeFile = { name: 'virus.exe', size: 1024, type: 'application/x-msdownload', lastModified: 6000 };
    ReqApp.handleFilesSelected([exeFile]);
    assert.equal(ReqApp.pendingImages.length, 4, 'Invalid format must be rejected');

    // Delete image #1 (index 1 in pendingImages)
    ReqApp.removePendingImage(1);
    assert.equal(ReqApp.pendingImages.length, 3);
    assert.equal(elements.reqImagesCount.textContent, '(3/6)');
    assert.equal(urlsRevoked.length, 1);
    assert.equal(urlsRevoked[0], 'blob:test-img2.jpg');

    // Preview lightbox
    ReqApp.openPreviewModal(0);
    assert.equal(elements.reqPreviewModal.style.display, 'flex');
    assert.equal(elements.reqPreviewFilename.textContent, 'img1.png');
    assert.equal(elements.reqPreviewIndex.textContent, '1 / 3');
    assert.equal(elements.reqPreviewPrev.disabled, true);
    assert.equal(elements.reqPreviewNext.disabled, false);

    // Next image in preview
    ReqApp.nextPreviewImage();
    assert.equal(elements.reqPreviewIndex.textContent, '2 / 3');

    // Close preview
    ReqApp.closePreviewModal();
    assert.equal(elements.reqPreviewModal.style.display, 'none');

    // Test closing modal revokes all remaining URLs
    ReqApp.closeModal();
    assert.equal(elements.reqModal.style.display, 'none');
    assert.equal(urlsRevoked.length, 4, 'All 4 created image URLs must be revoked in total (1 on deletion, 3 on closeModal)');
});

test('feedback dialog auto-closes after successful submission', async () => {
    let closed = false;
    let toastShown = false;
    let timeoutFn = null;
    let submitHandler = null;

    const storage = {};
    const context = {
        window: {
            addEventListener() {},
            location: { origin: 'http://localhost' },
            RequirementsClient: {
                encodeImages: async () => [],
                submitPayload: async () => ({ ok: true }),
                validImages: () => true
            }
        },
        document: {
            documentElement: { lang: 'zh' },
            getElementById: () => null,
            addEventListener() {},
            removeEventListener() {},
            body: { append() {} },
            head: { append() {} },
            activeElement: null,
            createElement: () => ({
                setAttribute() {},
                append() {},
                querySelector: sel => {
                    if (sel === 'textarea') return { value: 'Problem details', disabled: false, focus() {} };
                    if (sel === '[type=file]') return { click() {}, addEventListener() {}, files: [] };
                    if (sel === '[data-submit]') return {
                        disabled: false,
                        set onclick(fn) { submitHandler = fn; },
                        get onclick() { return submitHandler; }
                    };
                    if (sel === '.tools-feedback-previews') return { innerHTML: '', onclick() {} };
                    if (sel === '[data-count]' || sel === '[data-length]') return { textContent: '0' };
                    if (sel === '[data-images]') return { disabled: false };
                    if (sel === '[role="status"]') return { textContent: '' };
                    if (sel === '.tools-dialog-close') return { onclick() {}, addEventListener() {} };
                    if (sel === 'section') return { focus() {} };
                    return null;
                },
                querySelectorAll: () => [],
                innerHTML: '',
                remove() { closed = true; }
            })
        },
        localStorage: {
            getItem: k => storage[k] || null,
            setItem: (k, v) => { storage[k] = String(v); }
        },
        URLSearchParams: globalThis.URLSearchParams,
        MutationObserver: function() {
            return { observe() {}, disconnect() {} };
        },
        setTimeout: (fn, ms) => {
            timeoutFn = fn;
            return 1;
        },
        showToast: () => { toastShown = true; },
        location: { search: '', pathname: '', hash: '' },
        history: { replaceState() {} }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/api.js'), 'utf8'), context);

    // Open feedback dialog
    context.window.ToolsDialogs.feedback();
    assert.ok(submitHandler, 'Submit button should have onclick handler');

    // Execute submit
    await submitHandler();
    assert.ok(toastShown, 'Success toast should be shown');
    assert.ok(timeoutFn, 'setTimeout should be scheduled for closing');

    // Run timeout
    timeoutFn();
    assert.equal(closed, true, 'Dialog overlay must be removed / closed');
});
