export async function exportPptx(deck, setStatusCallback) {
    if (!window.html2canvas || !window.PptxGenJS) {
        alert('缺少必要库，请检查网络或是否正确加载 html2canvas / PptxGenJS。');
        return false;
    }
    
    let renderHost = null;
    const originalGetComputedStyle = window.getComputedStyle;

    try {
        // Patch getComputedStyle to fix html2canvas crash with modern color() function
        // Also fix the --editor-scale bug for HTML2Canvas
        window.getComputedStyle = function(el, pseudoElt) {
            const style = originalGetComputedStyle(el, pseudoElt);
            return new Proxy(style, {
                get(target, prop) {
                    let val = target[prop];
                    if (typeof val === 'string' && val.includes('color(')) {
                        val = val.replace(/color\((srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g, (match, space, r, g, b, a) => {
                            return `rgba(${Math.round(parseFloat(r)*255)}, ${Math.round(parseFloat(g)*255)}, ${Math.round(parseFloat(b)*255)}, ${a || 1})`;
                        });
                    }
                    if (prop === 'getPropertyValue' || prop === 'getPropertyCSSValue') {
                        return (p) => {
                            if (p === '--editor-scale') return '1';
                            let cssVal = target.getPropertyValue(p);
                            if (typeof cssVal === 'string' && cssVal.includes('color(')) {
                                cssVal = cssVal.replace(/color\((srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g, (match, space, r, g, b, a) => {
                                    return `rgba(${Math.round(parseFloat(r)*255)}, ${Math.round(parseFloat(g)*255)}, ${Math.round(parseFloat(b)*255)}, ${a || 1})`;
                                });
                            }
                            return cssVal;
                        };
                    }
                    return typeof val === 'function' ? val.bind(target) : val;
                }
            });
        };

        document.activeElement && document.activeElement.blur();
        
        const pptx = new window.PptxGenJS();
        pptx.layout = 'LAYOUT_16x9';
        
        const slides = Array.from(deck.querySelectorAll('.slide'));
        
        renderHost = document.createElement('div');
        renderHost.className = 'pdf-render-host';
        document.body.appendChild(renderHost);
        
        for (let i = 0; i < slides.length; i++) {
            renderHost.innerHTML = '';
            const exportSlide = scrubClone(slides[i].cloneNode(true));
            renderHost.appendChild(exportSlide);
            
            setStatusCallback(`正在生成页面 ${i + 1}/${slides.length}`);
            
            const isDark = slides[i].classList.contains('theme-dark') || slides[i].dataset.theme === 'dark';
            const canvas = await html2canvas(exportSlide, {
                scale: 2,
                backgroundColor: isDark ? '#0b0f19' : (slides[i].style.backgroundColor || null),
                useCORS: true,
                windowWidth: 1920,
                windowHeight: 1080,
                width: 1920,
                height: 1080
            });
            
            const img = canvas.toDataURL('image/jpeg', 0.9);
            const slide = pptx.addSlide();
            slide.addImage({ data: img, x: 0, y: 0, w: '100%', h: '100%' });
        }
        
        setStatusCallback('正在打包 PPTX 文件...');
        await pptx.writeFile({ fileName: `华子胶片_${new Date().toISOString().slice(0, 10)}.pptx` });
        return true;
    } catch (err) {
        console.error('PPTX Export Error:', err);
        alert(`导出 PPT 失败：${err.message}`);
        return false;
    } finally {
        window.getComputedStyle = originalGetComputedStyle;
        if (renderHost) renderHost.remove();
    }
}
