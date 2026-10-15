const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const WIDTH = 620;
const HEIGHT = 340;

function encodeBmp(bitmap, width, height) {
    const rowSize = Math.ceil(width * 3 / 4) * 4;
    const pixelBytes = rowSize * height;
    const output = Buffer.alloc(54 + pixelBytes);
    output.write('BM', 0, 'ascii');
    output.writeUInt32LE(output.length, 2);
    output.writeUInt32LE(54, 10);
    output.writeUInt32LE(40, 14);
    output.writeInt32LE(width, 18);
    output.writeInt32LE(height, 22);
    output.writeUInt16LE(1, 26);
    output.writeUInt16LE(24, 28);
    output.writeUInt32LE(pixelBytes, 34);
    output.writeInt32LE(3780, 38);
    output.writeInt32LE(3780, 42);
    for (let targetY = 0; targetY < height; targetY += 1) {
        const sourceY = height - 1 - targetY;
        for (let x = 0; x < width; x += 1) {
            const source = (sourceY * width + x) * 4;
            const target = 54 + targetY * rowSize + x * 3;
            output[target] = bitmap[source];
            output[target + 1] = bitmap[source + 1];
            output[target + 2] = bitmap[source + 2];
        }
    }
    return output;
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: WIDTH, height: HEIGHT, frame: false, show: false, useContentSize: true });
    // 阶段 1 的 BMP 就是阶段 2 启动页的静态首帧，两段画面因此完全一致
    await window.loadFile(path.join(__dirname, '../frontend/pages/startup.html'), { query: { snapshot: '1' } });
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))))');
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    const size = image.getSize();
    if (size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`Unexpected capture size ${size.width}x${size.height}`);
    const outputPath = path.join(__dirname, '../frontend/assets/portable-splash.bmp');
    fs.writeFileSync(outputPath, encodeBmp(image.toBitmap(), WIDTH, HEIGHT));
    console.log(`Portable splash generated: ${outputPath}`);
    window.destroy();
    app.quit();
}).catch(error => {
    console.error(error);
    app.exit(1);
});
