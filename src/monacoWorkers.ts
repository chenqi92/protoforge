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

// ── 3. 挂载到 window，供 GlobalContextMenu 等通过 window.monaco.editor.getEditors() 访问 ──
(window as any).monaco = monaco;
