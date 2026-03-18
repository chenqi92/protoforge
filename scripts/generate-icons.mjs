/**
 * ProtoForge 图标生成脚本
 * 
 * 从 src/assets/logo.svg 生成所有平台图标：
 * - macOS: icon.icns 来源 1024×1024 PNG（含 ~10% 内边距）
 * - Windows: icon.ico + Store Logos
 * - 通用: 32×32, 128×128, 128×128@2x
 * 
 * macOS 图标规范 (Apple HIG):
 *   - 1024×1024 画布
 *   - 内容区域约占 80%（每边 ~10% padding）
 *   - Big Sur+ 使用圆角矩形 (squircle)
 *   - SVG 已自带 rx=56 圆角，天然符合规范
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'src/assets/logo.svg');
const iconsDir = resolve(root, 'src-tauri/icons');

const svgBuffer = readFileSync(svgPath);

// 确保图标目录存在
mkdirSync(iconsDir, { recursive: true });

/**
 * 生成带内边距的 PNG（用于 macOS）
 * macOS 要求图标内容占画布约 80%，每边 ~10% padding
 */
async function generateWithPadding(size, paddingPercent = 0) {
  const contentSize = Math.round(size * (1 - paddingPercent * 2));
  const offset = Math.round(size * paddingPercent);

  const icon = await sharp(svgBuffer)
    .resize(contentSize, contentSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  if (paddingPercent === 0) {
    return sharp(svgBuffer).resize(size, size).png().toBuffer();
  }

  // 创建透明画布，将图标居中放置
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: icon, left: offset, top: offset }])
    .png()
    .toBuffer();
}

/**
 * 生成无内边距 PNG（用于 Windows/通用）
 */
async function generateFlat(size) {
  return sharp(svgBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  console.log('🎨 ProtoForge 图标生成');
  console.log('');

  // ── macOS 内边距说明 ──
  // Apple HIG: 1024px 画布上，内容区域约 824px（每边 ~100px padding ≈ 9.76%）
  // 我们使用 10% padding
  const MACOS_PADDING = 0.10;

  // ── 通用图标（无内边距，全出血） ──
  const sizes = [
    { name: '32x32.png', size: 32, padding: 0 },
    { name: '128x128.png', size: 128, padding: 0 },
    { name: '128x128@2x.png', size: 256, padding: 0 },
    { name: 'icon.png', size: 1024, padding: MACOS_PADDING },  // macOS .icns 来源
  ];

  for (const { name, size, padding } of sizes) {
    const buf = await generateWithPadding(size, padding);
    writeFileSync(resolve(iconsDir, name), buf);
    console.log(`   ✅ ${name} (${size}×${size}${padding > 0 ? `, padding: ${Math.round(padding * 100)}%` : ''})`);
  }

  // ── Windows Store Logos ──
  const storeSizes = [
    { name: 'Square30x30Logo.png', size: 30 },
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square89x89Logo.png', size: 89 },
    { name: 'Square107x107Logo.png', size: 107 },
    { name: 'Square142x142Logo.png', size: 142 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square284x284Logo.png', size: 284 },
    { name: 'Square310x310Logo.png', size: 310 },
    { name: 'StoreLogo.png', size: 50 },
  ];

  for (const { name, size } of storeSizes) {
    const buf = await generateFlat(size);
    writeFileSync(resolve(iconsDir, name), buf);
    console.log(`   ✅ ${name} (${size}×${size})`);
  }

  // ── Windows ICO (包含 16, 24, 32, 48, 64, 128, 256) ──
  // sharp 不支持直接生成 .ico，生成 256x256 PNG 作为来源
  // 使用 tauri icon 命令或手动 ico 打包
  const ico256 = await generateFlat(256);
  writeFileSync(resolve(iconsDir, 'icon-256.png'), ico256);

  // 简单 ICO：使用 256px PNG 作为单帧 ICO
  // ICO 文件头 + ICONDIR + PNG 数据
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type: ICO
  icoHeader.writeUInt16LE(1, 4); // Count: 1 image

  const icoEntry = Buffer.alloc(16);
  icoEntry.writeUInt8(0, 0);   // Width (0 = 256)
  icoEntry.writeUInt8(0, 1);   // Height (0 = 256)
  icoEntry.writeUInt8(0, 2);   // Color palette
  icoEntry.writeUInt8(0, 3);   // Reserved
  icoEntry.writeUInt16LE(1, 4);  // Color planes
  icoEntry.writeUInt16LE(32, 6); // Bits per pixel
  icoEntry.writeUInt32LE(ico256.length, 8);  // Image size
  icoEntry.writeUInt32LE(22, 12); // Offset (6 + 16)

  const icoBuffer = Buffer.concat([icoHeader, icoEntry, ico256]);
  writeFileSync(resolve(iconsDir, 'icon.ico'), icoBuffer);
  console.log(`   ✅ icon.ico (256×256, PNG-in-ICO)`);

  // ── macOS ICNS ──
  // macOS ICNS 需要专门的打包工具，在 macOS 上用 iconutil
  // 这里生成高质量 PNG 来源，可用 tauri icon 或 iconutil 转换
  console.log(`   ℹ️  icon.icns 需在 macOS 上使用 iconutil 生成，或运行 tauri icon`);
  console.log('');

  console.log('🎉 图标生成完成！');
  console.log('');
  console.log('📋 macOS 图标说明：');
  console.log(`   - icon.png (1024×1024) 已包含 ${Math.round(MACOS_PADDING*100)}% 内边距`);
  console.log('   - Apple HIG 建议: 512px 画布上 50px padding (~9.76%)');
  console.log('   - 我们使用 10%，确保图标在 Dock 中视觉一致');
  console.log('');
  console.log('💡 如需生成 .icns，可在 macOS 上运行:');
  console.log('   npx tauri icon src-tauri/icons/icon.png');
}

main().catch(console.error);
