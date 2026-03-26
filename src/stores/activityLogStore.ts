/**
 * activityLogStore — 统一活动日志 Store
 *
 * 收集来自 HTTP / TCP / UDP / WS / MQTT 等模块的操作日志，
 * 供全局右侧侧边栏的 Activity Logs 面板展示。
 */

import { create } from 'zustand';

export type LogSource = 'http' | 'tcp' | 'udp' | 'ws' | 'mqtt' | 'system';
export type LogDirection = 'sent' | 'received' | 'info';

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  source: LogSource;
  direction: LogDirection;
  summary: string;
  /** 原始报文数据（可选，用于协议解析跳转） */
  rawData?: string;
  /** 已识别的协议名称 */
  protocol?: string;
  /** 附加元数据 */
  meta?: Record<string, unknown>;
}

const MAX_ENTRIES = 2000;

interface ActivityLogState {
  entries: ActivityLogEntry[];
  filterRegex: string;

  addEntry: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
  clearAll: () => void;
  setFilterRegex: (regex: string) => void;
}

let _idCounter = 0;

export const useActivityLogStore = create<ActivityLogState>((set) => ({
  entries: [],
  filterRegex: '',

  addEntry: (entry) => {
    const newEntry: ActivityLogEntry = {
      ...entry,
      id: `log_${Date.now()}_${++_idCounter}`,
      timestamp: Date.now(),
    };
    set((state) => ({
      entries: [newEntry, ...state.entries].slice(0, MAX_ENTRIES),
    }));
  },

  clearAll: () => set({ entries: [] }),

  setFilterRegex: (regex) => set({ filterRegex: regex }),
}));
