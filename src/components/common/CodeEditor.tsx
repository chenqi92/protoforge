import '@/monacoWorkers'; // Must run before Monaco editor mounts — configures workers + injects local monaco instance into the loader + defines Forge themes
import Editor from '@monaco-editor/react';
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
  const theme = useThemeStore((s) => s.resolved);
  const editorFontSize = useSettingsStore((s) => Math.max(10, s.settings.fontSize - 1));

  // Themes are defined once in `@/monacoWorkers` (global + idempotent). Here we
  // only pick which one this editor renders with; switching updates via setTheme.
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
