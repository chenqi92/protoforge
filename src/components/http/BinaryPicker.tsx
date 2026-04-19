import { Upload, FileIcon, X } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { pickFile } from "@/services/httpService";

export function BinaryPicker({ filePath, fileName, onChange }: { filePath: string; fileName: string; onChange: (path: string, name: string) => void }) {
  const { t } = useTranslation();
  const handlePick = async () => {
    const result = await pickFile();
    if (result) {
      onChange(result.path, result.name);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {filePath ? (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-border-default bg-bg-secondary/50">
          <FileIcon className="w-8 h-8 text-accent/60" />
          <div className="min-w-0">
            <p className="pf-text-base font-medium text-text-primary truncate max-w-xs">{fileName}</p>
            <p className="pf-text-xs text-text-disabled font-mono truncate max-w-xs">{filePath}</p>
          </div>
          <button onClick={() => onChange('', '')} className="p-1 rounded-md hover:bg-bg-hover text-text-disabled hover:text-red-500 dark:text-red-300 transition-colors" title={t('http.removeFile')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={handlePick}
          className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-border-default hover:border-accent text-text-disabled hover:text-accent transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8" />
          <span className="pf-text-base font-medium">{t('http.selectFile')}</span>
          <span className="pf-text-xs">{t('http.binaryDesc')}</span>
        </button>
      )}
    </div>
  );
}
