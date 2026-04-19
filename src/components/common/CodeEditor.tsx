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
      // Linear dark: #0f1011 panel bg + #191a1b line highlight — matches --color-bg-primary / --color-bg-tertiary.
      // Syntax palette: cool/restrained — indigo for keywords, lavender for strings, muted slate for numbers.
      monaco.editor.defineTheme('protoforge-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: '', foreground: 'd0d6e0' },
          { token: 'keyword', foreground: '7170ff' },           // Linear accent violet — keywords stand out
          { token: 'keyword.json', foreground: 'f7f8f8' },
          { token: 'string', foreground: 'a5b4fc' },            // indigo-300 — cool pastel strings
          { token: 'string.key.json', foreground: 'd0d6e0' },   // JSON keys as primary body text
          { token: 'string.value.json', foreground: 'a5b4fc' },
          { token: 'number', foreground: 'fbbf24' },            // amber-400 — warm numeric accent
          { token: 'boolean', foreground: '7170ff' },
          { token: 'comment', foreground: '62666d', fontStyle: 'italic' },
          { token: 'type', foreground: '67e8f9' },              // cyan-300 — type annotations
          { token: 'function', foreground: '7170ff' },
          { token: 'variable', foreground: 'f7f8f8' },
          { token: 'constant', foreground: 'fbbf24' },
          { token: 'delimiter', foreground: '8a8f98' },
          { token: 'operator', foreground: '8a8f98' },
          { token: 'tag', foreground: '7170ff' },
          { token: 'attribute.name', foreground: 'a5b4fc' },
        ],
        colors: {
          'editor.background': '#0f1011',
          'editor.foreground': '#d0d6e0',
          'editor.lineHighlightBackground': '#191a1b',
          'editor.lineHighlightBorder': '#00000000',
          'editorLineNumber.foreground': '#62666d',
          'editorLineNumber.activeForeground': '#d0d6e0',
          'editorCursor.foreground': '#f7f8f8',
          'editorIndentGuide.background1': '#191a1b',
          'editorIndentGuide.activeBackground1': '#28282c',
          'editor.selectionBackground': '#5e6ad245',              // Linear indigo at ~27% opacity
          'editor.selectionHighlightBackground': '#5e6ad222',
          'editor.wordHighlightBackground': '#5e6ad220',
          'editor.findMatchBackground': '#fbbf2440',
          'editor.findMatchHighlightBackground': '#fbbf2420',
          'editorBracketMatch.background': '#7170ff22',
          'editorBracketMatch.border': '#7170ff60',
          'editorWhitespace.foreground': '#28282c',
        }
      });
      monaco.editor.defineTheme('protoforge-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: '', foreground: '0f1011' },
          { token: 'keyword', foreground: '5e6ad2' },
          { token: 'string', foreground: '4f46e5' },
          { token: 'string.value.json', foreground: '4f46e5' },
          { token: 'number', foreground: 'b45309' },
          { token: 'boolean', foreground: '5e6ad2' },
          { token: 'comment', foreground: '8a8f98', fontStyle: 'italic' },
          { token: 'type', foreground: '0891b2' },
          { token: 'function', foreground: '5e6ad2' },
          { token: 'delimiter', foreground: '62666d' },
          { token: 'operator', foreground: '62666d' },
        ],
        colors: {
          'editor.background': '#ffffff',
          'editor.foreground': '#0f1011',
          'editor.lineHighlightBackground': '#f5f6f7',
          'editor.lineHighlightBorder': '#00000000',
          'editorLineNumber.foreground': '#8a8f98',
          'editorLineNumber.activeForeground': '#0f1011',
          'editor.selectionBackground': '#5e6ad228',
          'editorBracketMatch.background': '#5e6ad218',
          'editorBracketMatch.border': '#5e6ad260',
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
