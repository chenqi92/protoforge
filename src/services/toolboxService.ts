// 工具箱服务层 — Tauri IPC 前端封装

import { invoke } from "@tauri-apps/api/core";

export interface BatchResult {
  success_count: number;
  errors: string[];
}

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface IconPlatforms {
  ios: boolean;
  macos: boolean;
  windows: boolean;
  favicon: boolean;
}

export async function resizeScreenshots(
  sourcePaths: string[],
  targetSizes: [number, number][],
  outputDir: string,
): Promise<BatchResult> {
  return invoke("toolbox_resize_screenshots", {
    sourcePaths,
    targetSizes,
    outputDir,
  });
}

export async function generateIcons(
  sourcePath: string,
  platforms: IconPlatforms,
  outputDir: string,
): Promise<BatchResult> {
  return invoke("toolbox_generate_icons", {
    sourcePath,
    platforms,
    outputDir,
  });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke("toolbox_list_directory", { path });
}

export async function batchRename(
  directory: string,
  renames: [string, string][],
): Promise<BatchResult> {
  return invoke("toolbox_batch_rename", { directory, renames });
}
