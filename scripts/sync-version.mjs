/**
 * 版本号同步脚本
 * 将 package.json 的版本号同步到:
 * - src-tauri/Cargo.toml
 * - src-tauri/tauri.conf.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 读取 package.json 版本
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const version = pkg.version;

console.log(`📦 同步版本号: ${version}`);

// 1. 同步 Cargo.toml
const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf-8');
cargo = cargo.replace(
  /^version\s*=\s*"[^"]*"/m,
  `version = "${version}"`
);
writeFileSync(cargoPath, cargo);
console.log(`   ✅ src-tauri/Cargo.toml → ${version}`);

// 2. 同步 tauri.conf.json
const tauriConfPath = resolve(root, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`   ✅ src-tauri/tauri.conf.json → ${version}`);

console.log(`\n🎉 版本号同步完成: v${version}`);
