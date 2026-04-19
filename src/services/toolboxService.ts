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

export type CompressFormat = "keep" | "png" | "jpeg";
export type PngCompressionLevel = "fast" | "default" | "best";

export interface CompressOptions {
  format: CompressFormat;
  jpegQuality: number;
  pngCompression: PngCompressionLevel;
  suffix: string;
  overwrite: boolean;
}

export interface CompressItem {
  source: string;
  output: string;
  originalSize: number;
  compressedSize: number;
}

export interface CompressResult {
  successCount: number;
  errors: string[];
  items: CompressItem[];
  totalOriginal: number;
  totalCompressed: number;
}

export interface MergeItem {
  source: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // 0/90/180/270
}

export interface MergeOptions {
  canvasW: number;
  canvasH: number;
  background: string; // "#rrggbb" or "transparent"
  format: "png" | "jpeg" | "pdf";
  jpegQuality: number;
}

export interface MergeResult {
  output: string;
  size: number;
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

export async function compressImages(
  sourcePaths: string[],
  outputDir: string,
  options: CompressOptions,
): Promise<CompressResult> {
  return invoke("toolbox_compress_images", {
    sourcePaths,
    outputDir,
    options,
  });
}

export async function mergeImages(
  items: MergeItem[],
  options: MergeOptions,
  outputPath: string,
): Promise<MergeResult> {
  return invoke("toolbox_merge_images", {
    items,
    options,
    outputPath,
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
