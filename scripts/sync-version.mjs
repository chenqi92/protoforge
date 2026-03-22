/**
 * ProtoForge 版本发布脚本
 *
 * 用法:
 *   node scripts/sync-version.mjs [patch|minor|major|x.y.z] [--push] [--dry-run]
 *
 * 参数:
 *   patch|minor|major  - 自动递增版本号
 *   x.y.z              - 设置指定版本号
 *   --push             - 自动 git commit + tag + push
 *   --dry-run          - 仅预览变更，不实际修改文件
 *
 * 示例:
 *   node scripts/sync-version.mjs patch              # 递增 patch 版本并同步
 *   node scripts/sync-version.mjs 1.2.0 --push       # 设置版本并推送
 *   node scripts/sync-version.mjs minor --dry-run     # 预览 minor 版本递增
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── 解析命令行参数 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const autoPush = args.includes('--push');
const versionArg = args.find(a => !a.startsWith('--'));

// ── 辅助函数 ────────────────────────────────────────────────────
function parseVersion(ver) {
  const match = ver.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`无效的版本号格式: ${ver}`);
  return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

function bumpVersion(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case 'major': return `${v.major + 1}.0.0`;
    case 'minor': return `${v.major}.${v.minor + 1}.0`;
    case 'patch': return `${v.major}.${v.minor}.${v.patch + 1}`;
    default: throw new Error(`未知的版本类型: ${type}`);
  }
}

function exec(cmd, opts = {}) {
  console.log(`   $ ${cmd}`);
  if (!dryRun) {
    return execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
  }
}

// ── 读取当前版本 ─────────────────────────────────────────────────
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version;

// ── 计算新版本号 ─────────────────────────────────────────────────
let newVersion;

if (!versionArg) {
  // 无参数：仅同步当前版本号到所有文件
  newVersion = currentVersion;
  console.log(`📦 同步当前版本号: ${newVersion}`);
} else if (['patch', 'minor', 'major'].includes(versionArg)) {
  newVersion = bumpVersion(currentVersion, versionArg);
  console.log(`📦 版本更新: ${currentVersion} → ${newVersion} (${versionArg})`);
} else {
  // 自定义版本号
  parseVersion(versionArg); // 校验格式
  newVersion = versionArg;
  console.log(`📦 版本设置: ${currentVersion} → ${newVersion}`);
}

if (dryRun) {
  console.log('\n🔍 [DRY RUN] 以下为预览，不会实际修改文件\n');
}

// ── 1. 更新 package.json ────────────────────────────────────────
console.log(`   ${dryRun ? '📝' : '✅'} package.json → ${newVersion}`);
if (!dryRun) {
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ── 2. 更新 Cargo.toml ─────────────────────────────────────────
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf-8');
const cargoUpdated = cargo.replace(
  /^version\s*=\s*"[^"]*"/m,
  `version = "${newVersion}"`
);
console.log(`   ${dryRun ? '📝' : '✅'} src-tauri/Cargo.toml → ${newVersion}`);
if (!dryRun) {
  writeFileSync(cargoPath, cargoUpdated);
}

// ── 3. 更新 tauri.conf.json ────────────────────────────────────
const tauriConfPath = resolve(root, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
console.log(`   ${dryRun ? '📝' : '✅'} src-tauri/tauri.conf.json → ${newVersion}`);
if (!dryRun) {
  tauriConf.version = newVersion;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
}

// ── 4. Git 操作（仅 --push 时执行）──────────────────────────────
if (autoPush) {
  console.log(`\n🚀 执行 Git 操作...`);

  exec('git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json');
  exec(`git commit -m "chore: release v${newVersion}"`);
  exec(`git tag v${newVersion}`);
  exec(`git push`);
  exec(`git push origin v${newVersion}`);

  if (dryRun) {
    console.log('\n🔍 [DRY RUN] 以上 Git 命令不会实际执行');
  }
}

// ── 完成 ─────────────────────────────────────────────────────────
console.log(`\n🎉 ${dryRun ? '[DRY RUN] ' : ''}版本号${autoPush ? '发布' : '同步'}完成: v${newVersion}`);

if (!autoPush && versionArg) {
  console.log(`\n💡 提示: 使用 --push 参数可自动提交并推送 tag`);
  console.log(`   node scripts/sync-version.mjs ${versionArg} --push`);
}
