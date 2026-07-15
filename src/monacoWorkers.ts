// Monaco Editor 本地化配置
// 必须在任何 Monaco 组件渲染前执行
// 1. 配置 Worker 从本地 bundle 加载（而非 CDN）
// 2. 将本地 monaco-editor 实例注入 @monaco-editor/loader，彻底跳过 CDN script 注入

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// ── 1. Worker 本地加载 ──
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// ── 2. 注入本地 monaco 实例，阻止 loader 从 CDN 加载 ──
loader.config({ monaco });

// ── 3. 定义 Forge 主题（一次性，模块加载即执行）──
// 主题是全局的：必须在任何编辑器挂载前定义一次。若放进组件 effect 里反复
// defineTheme，重定义当前激活主题会向所有存活编辑器广播 onThemeChanged，
// 在 StrictMode 双挂载时会命中正在销毁的编辑器视图而崩溃。
monaco.editor.defineTheme('protoforge-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'e7eaf0' },
    { token: 'keyword', foreground: 'ff6b35' },           // Forge accent orange — keywords stand out
    { token: 'keyword.json', foreground: 'e7eaf0' },
    { token: 'string', foreground: 'a5d6a3' },            // green strings
    { token: 'string.key.json', foreground: '79c0ff' },   // JSON keys as blue
    { token: 'string.value.json', foreground: 'a5d6a3' },
    { token: 'number', foreground: 'f0883e' },            // orange numeric accent
    { token: 'boolean', foreground: 'ff7b72' },
    { token: 'comment', foreground: '646d7c', fontStyle: 'italic' },
    { token: 'type', foreground: '56d4dd' },              // cyan — type annotations
    { token: 'function', foreground: '79c0ff' },
    { token: 'variable', foreground: 'e7eaf0' },
    { token: 'constant', foreground: 'f0883e' },
    { token: 'delimiter', foreground: '9aa3b2' },
    { token: 'operator', foreground: '9aa3b2' },
    { token: 'tag', foreground: 'ff7b72' },
    { token: 'attribute.name', foreground: '79c0ff' },
  ],
  colors: {
    'editor.background': '#0c0e12',
    'editor.foreground': '#e7eaf0',
    'editor.lineHighlightBackground': '#14171d',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#646d7c',
    'editorLineNumber.activeForeground': '#e7eaf0',
    'editorCursor.foreground': '#e7eaf0',
    'editorIndentGuide.background1': '#1e232b',
    'editorIndentGuide.activeBackground1': '#353c47',
    'editor.selectionBackground': '#ff6b3540',              // Forge accent at ~25% opacity
    'editor.selectionHighlightBackground': '#ff6b3522',
    'editor.wordHighlightBackground': '#ff6b3520',
    'editor.findMatchBackground': '#d2992240',
    'editor.findMatchHighlightBackground': '#d2992220',
    'editorBracketMatch.background': '#ff6b3522',
    'editorBracketMatch.border': '#ff6b3560',
    'editorWhitespace.foreground': '#353c47',
  },
});
monaco.editor.defineTheme('protoforge-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1a1d23' },
    { token: 'keyword', foreground: 'ff6b35' },
    { token: 'string', foreground: '0a7d33' },
    { token: 'string.key.json', foreground: '0550ae' },
    { token: 'string.value.json', foreground: '0a7d33' },
    { token: 'number', foreground: 'bc4c00' },
    { token: 'boolean', foreground: 'cf222e' },
    { token: 'comment', foreground: '939aa6', fontStyle: 'italic' },
    { token: 'type', foreground: '0891b2' },
    { token: 'function', foreground: '0550ae' },
    { token: 'delimiter', foreground: '5a626e' },
    { token: 'operator', foreground: '5a626e' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1a1d23',
    'editor.lineHighlightBackground': '#f5f6f8',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#939aa6',
    'editorLineNumber.activeForeground': '#1a1d23',
    'editor.selectionBackground': '#ff6b3528',
    'editorBracketMatch.background': '#ff6b3518',
    'editorBracketMatch.border': '#ff6b3560',
  },
});

// ── 4. 挂载到 window，供 GlobalContextMenu 等通过 window.monaco.editor.getEditors() 访问 ──
(window as any).monaco = monaco;
