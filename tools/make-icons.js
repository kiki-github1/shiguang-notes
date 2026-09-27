'use strict';

/**
 * 从 public/favicon.svg 生成 Windows 应用图标 assets/app/icon.ico。
 *
 * 为什么需要这一步：SVG 直接给浏览器标签页用没问题，但 Windows 的快捷方式
 * 只认 .ico。这里借系统 Chrome 把 SVG 渲染成六种尺寸的 PNG，再按 ICO 容器
 * 格式打包。
 *
 * 多尺寸是必要的，不是保险起见：任务栏读 32、开始菜单读 48、文件管理器的
 * 「大图标」读 256 —— 只嵌一张的话，系统会把那张拉伸去凑其余尺寸，边缘和
 * 笔画都会糊。
 *
 * 依赖 playwright-core（装在隔离工作区，项目自身不引入），跑法：
 *   NODE_PATH="<隔离工作区>/node_modules" node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'public', 'favicon.svg');
const OUT = path.join(ROOT, 'assets', 'app', 'icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

/** 按 ICO 容器格式把若干张 PNG 打包成一个文件 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved，必须为 0
  header.writeUInt16LE(1, 2); // type = 1（图标，2 是光标）
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16; // 数据区紧跟在目录表之后

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // 宽高各占一字节，256 放不下，按规范写 0 表示
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // 调色板颜色数，真彩色写 0
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // 位深
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...blobs]);
}

(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const browser = await chromium.launch({ channel: 'chrome' });
  const images = [];

  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    // 给 <svg> 显式宽高：只靠 viewBox 的话，根元素会按浏览器默认尺寸（300×150）渲染
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<style>html,body{margin:0;padding:0;overflow:hidden}</style>${sized}`,
      { waitUntil: 'load' }
    );
    const data = await page.screenshot({ type: 'png' });
    await page.close();
    images.push({ size, data });
    console.log(`  ${String(size).padStart(3)}×${String(size).padEnd(3)}  ${String(data.length).padStart(7)} 字节`);
  }

  await browser.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ico = buildIco(images);
  fs.writeFileSync(OUT, ico);
  console.log(`\n  已生成 ${path.relative(ROOT, OUT)}`);
  console.log(`  ${(ico.length / 1024).toFixed(1)} KB，含 ${SIZES.length} 种尺寸\n`);
})().catch((err) => {
  console.error('生成图标失败：', err);
  process.exit(1);
});
