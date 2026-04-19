import { useEffect } from 'react';
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
      // Linear dark: #0f1011 panel bg + #191a1b line highlight — matches --color-bg-primary / --color-bg-tertiary
      monaco.editor.defineTheme('protoforge-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0f1011',
          'editor.lineHighlightBackground': '#191a1b',
          'editorLineNumber.foreground': '#62666d',
          'editorLineNumber.activeForeground': '#d0d6e0',
          'editorCursor.foreground': '#f7f8f8',
          'editorIndentGuide.background1': '#191a1b',
          'editorIndentGuide.activeBackground1': '#28282c',
        }
      });
      monaco.editor.defineTheme('protoforge-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#ffffff',
          'editor.lineHighlightBackground': '#f5f6f7',
          'editorLineNumber.foreground': '#8a8f98',
          'editorLineNumber.activeForeground': '#0f1011',
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
