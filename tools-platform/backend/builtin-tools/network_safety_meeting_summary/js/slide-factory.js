// js/slide-factory.js

export function createId() {
    return Math.random().toString(36).substr(2, 9);
}

function renderFooter() {
    return `<div class="footer"><span>Network Confidential</span><span class="logo">HUAWEI</span></div>`;
}

export function renderSlide(slideData) {
    const wrap = document.createElement('div');
    wrap.className = 'slide-wrap';
    
    const num = document.createElement('div');
    num.className = 'slide-num';
    // The slide-num content will be updated by renumberSlides()
    
    const section = document.createElement('section');
    section.className = 'slide';

    if (slideData.background) {
        section.style.background = slideData.background;
    }
    if (slideData.theme) {
        section.dataset.theme = slideData.theme;
        section.classList.add(`theme-${slideData.theme}`);
        if (slideData.theme === 'dark') {
            section.classList.add('text-slate-100');
        }
    }
    
    if (slideData.layout === 'cover') {
        section.classList.add('cover-slide');
        section.innerHTML = `
            <div class="cover-banner" data-ppt-type="cover-banner" data-element-id="${createId()}">
                <div class="cn editable" contenteditable="true">${slideData.title || ''}</div>
                <div class="en editable" contenteditable="true">${slideData.subtitle || ''}</div>
            </div>
            <div class="cover-photo" data-ppt-type="cover-photo" data-element-id="${createId()}"></div>
            <div class="cover-copy" data-ppt-type="cover-copy" data-element-id="${createId()}">
                ${slideData.topicHtml || ''}
            </div>
            ${renderFooter()}
        `;
    } else if (slideData.layout === 'agenda') {
        section.innerHTML = `
            <div class="slide-pad">
                <h2 class="slide-title editable" contenteditable="true" data-ppt-type="title" data-element-id="${createId()}">${slideData.title || 'Agenda'}</h2>
                <table class="agenda-table" data-ppt-type="agenda-table" data-element-id="${createId()}">
                    <tbody contenteditable="true" class="editable">
                        ${slideData.rows.map((row, i) => `
                            <tr class="${row.active ? 'active' : ''}">
                                <td class="idx">${i + 1}</td>
                                <td>${row.content}</td>
                                <td class="owner">${row.owner}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ${renderFooter()}
        `;
    } else if (slideData.layout === 'case') {
        section.innerHTML = `
            <div class="slide-pad">
                <h2 class="small-title editable" contenteditable="true" data-ppt-type="title" data-element-id="${createId()}">${slideData.title || ''}</h2>
                <div class="case-layout" data-ppt-type="case-layout" data-element-id="${createId()}">
                    <div class="case-labels">
                        <div class="editable" contenteditable="true">Problem<br>Description</div>
                        <div class="editable" contenteditable="true">Root<br>Cause</div>
                        <div class="editable" contenteditable="true">Action<br>Analysis</div>
                        <div class="editable" contenteditable="true">Improvement</div>
                    </div>
                    <div class="case-cells editable" contenteditable="true">
                        <div>${slideData.cells?.[0] || '[Describe time, symptom and impact]'}</div>
                        <div>${slideData.cells?.[1] || '[Describe root cause]'}</div>
                        <div>${slideData.cells?.[2] || '[Describe process/tool/people gap]'}</div>
                        <div>${slideData.cells?.[3] || '[Describe improvement actions and owner]'}</div>
                    </div>
                </div>
                <div class="sticky-note editable ppt-element" style="position: absolute; ${slideData.noteStyle || 'top: 100px; right: 50px;'}" contenteditable="true" data-ppt-type="note" data-element-id="${createId()}">
                    ${slideData.noteHtml || ''}
                </div>
            </div>
            ${renderFooter()}
        `;
    } else if (slideData.layout === 'two-column') {
        section.innerHTML = `
            <div class="slide-pad">
                <h2 class="slide-title editable" contenteditable="true" data-ppt-type="title" data-element-id="${createId()}">${slideData.title || ''}</h2>
                <div class="two-col" data-ppt-type="two-col" data-element-id="${createId()}">
                    <div class="box">
                        <h3 class="small-title editable" contenteditable="true">${slideData.leftCol.title || ''}</h3>
                        <ol class="plain-list editable" contenteditable="true">
                            ${slideData.leftCol.items.map(item => `<li>${item}</li>`).join('')}
                        </ol>
                    </div>
                    <div class="box">
                        <h3 class="small-title editable" contenteditable="true">${slideData.rightCol.title || ''}</h3>
                        <ol class="plain-list editable" contenteditable="true">
                            ${slideData.rightCol.items.map(item => `<li>${item}</li>`).join('')}
                        </ol>
                    </div>
                </div>
            </div>
            ${renderFooter()}
        `;
    } else if (slideData.layout === 'custom') {
        // Free-form HTML layout
        const customFooter = /(?:huawei-template|ppt-original-page|vision-template)/.test(String(slideData.html || ''))
            ? ''
            : renderFooter();
        section.innerHTML = `
            <div class="slide-pad">
                ${slideData.html || ''}
            </div>
            ${customFooter}
        `;
        if (typeof window !== 'undefined' && !/(?:huawei-template|ppt-original-page|vision-template)/.test(String(slideData.html || ''))) {
            section.querySelectorAll('.slide-pad h1, .slide-pad h2, .slide-pad h3, .slide-pad h4, .slide-pad h5, .slide-pad h6, .slide-pad p, .slide-pad li, .slide-pad th, .slide-pad td, .slide-pad .editable').forEach(el => {
                el.classList.add('editable');
                el.dataset.pptEditable = 'true';
            });
        }
    }

    wrap.appendChild(num);
    wrap.appendChild(section);
    return wrap;
}

export function slideToJson(slideWrap) {
    const section = slideWrap.querySelector('.slide');
    if (!section) return null;

    const data = {
        id: slideWrap.dataset.slideId || createId(),
        layout: 'custom',
        background: section.style.background || '',
        theme: section.dataset.theme || '',
        elements: []
    };

    if (section.classList.contains('cover-slide')) {
        data.layout = 'cover';
        const banner = section.querySelector('.cover-banner');
        const copy = section.querySelector('.cover-copy');
        if (banner) {
            data.title = banner.querySelector('.cn')?.innerHTML || '';
            data.subtitle = banner.querySelector('.en')?.innerHTML || '';
        }
        if (copy) {
            data.topicHtml = copy.innerHTML.trim();
        }
    } else if (section.querySelector('.agenda-table')) {
        data.layout = 'agenda';
        data.title = section.querySelector('.slide-title')?.innerHTML || '';
        data.rows = [];
        section.querySelectorAll('.agenda-table tbody tr').forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 3) {
                data.rows.push({
                    active: tr.classList.contains('active'),
                    content: tds[1].innerHTML,
                    owner: tds[2].innerHTML
                });
            }
        });
    } else if (section.querySelector('.case-layout')) {
        data.layout = 'case';
        data.title = section.querySelector('.small-title')?.innerHTML || '';
        const cells = section.querySelector('.case-cells');
        if (cells) {
            data.cells = Array.from(cells.children).map(div => div.innerHTML);
        }
        const note = section.querySelector('.sticky-note');
        if (note) {
            data.noteHtml = note.innerHTML.trim();
            data.noteStyle = note.style.cssText;
        }
    } else if (section.querySelector('.two-col')) {
        data.layout = 'two-column';
        data.title = section.querySelector('.slide-title')?.innerHTML || '';
        const boxes = section.querySelectorAll('.two-col .box');
        if (boxes.length >= 2) {
            data.leftCol = {
                title: boxes[0].querySelector('.small-title')?.innerHTML || '',
                items: Array.from(boxes[0].querySelectorAll('ol li')).map(li => li.innerHTML)
            };
            data.rightCol = {
                title: boxes[1].querySelector('.small-title')?.innerHTML || '',
                items: Array.from(boxes[1].querySelectorAll('ol li')).map(li => li.innerHTML)
            };
        }
    } else {
        // Fallback for custom slides
        const pad = section.querySelector('.slide-pad');
        if (pad) {
            data.html = pad.innerHTML.trim();
        }
    }

    return data;
}

export function deckToJson(deckElement) {
    const slides = [];
    deckElement.querySelectorAll('.slide-wrap').forEach(wrap => {
        const json = slideToJson(wrap);
        if (json) slides.push(json);
    });
    return slides;
}
