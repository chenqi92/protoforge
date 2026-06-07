import { useEffect } from 'react';
import '@/monacoWorkers'; // Must run before Monaco editor mounts — configures workers + injects local monaco instance into the loader
import Editor, { useMonaco } from '@monaco-editor/react';
import { useThemeStore } from '@/stores/themeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Loader2 } from 'lucide-react';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  onMount?: (editor: any, monaco: any) => void;
  height?: string;
  stickyScroll?: boolean;
}

export function CodeEditor({ 
  value, 
  onChange, 
  language = 'json', 
  readOnly = false,
  onMount,
  height = '100%',
  stickyScroll = true,
}: CodeEditorProps) {
  const monaco = useMonaco();
  const theme = useThemeStore((s) => s.resolved);
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));
  
  useEffect(() => {
    if (monaco) {
      // Forge dark: #0c0e12 panel bg (inset) + #14171d surface line highlight.
      // Syntax palette: GitHub-dark flavor — accent orange for keywords, green strings, orange numbers.
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
        }
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
        }
      });
    }
  }, [monaco]);

  const editorTheme = theme === 'dark' ? 'protoforge-dark' : 'protoforge-light';

  return (
    <Editor
      height={height}
      language={language}
      theme={editorTheme}
      value={value}
      onChange={(val) => onChange?.(val || '')}
      onMount={onMount}
      loading={<div className="flex w-full h-full items-center justify-center text-text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      options={{
        minimap: { enabled: false },
        contextmenu: false,
        fontSize: editorFontSize,
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        readOnly,
        renderLineHighlight: 'all',
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        padding: { top: 12, bottom: 12 },
        stickyScroll: { enabled: stickyScroll },
      }}
    />
  );
}
