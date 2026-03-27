// 串口 & Modbus 类型定义

// ── 串口配置 ──

export type BaudRate = 300 | 600 | 1200 | 2400 | 4800 | 9600 | 14400 | 19200 | 38400 | 57600 | 115200 | 230400 | 460800 | 921600;
export type DataBits = 5 | 6 | 7 | 8;
export type StopBits = 1 | 2;
export type Parity = 'none' | 'odd' | 'even';
export type FlowControl = 'none' | 'software' | 'hardware';

export const BAUD_RATES: BaudRate[] = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
export const DATA_BITS_OPTIONS: DataBits[] = [5, 6, 7, 8];
export const STOP_BITS_OPTIONS: StopBits[] = [1, 2];

export interface SerialPortConfig {
  baudRate: BaudRate;
  dataBits: DataBits;
  stopBits: StopBits;
  parity: Parity;
  flowControl: FlowControl;
}

export const DEFAULT_SERIAL_CONFIG: SerialPortConfig = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

// ── 串口设备信息（后端返回） ──

export interface SerialPortInfo {
  portName: string;
  description?: string;
  manufacturer?: string;
}

// ── 串口事件（后端推送） ──

export type SerialEventType = 'opened' | 'data' | 'closed' | 'error';

export interface SerialEvent {
  portId: string;
  eventType: SerialEventType;
  data?: string;
  rawHex?: string;
  size?: number;
  timestamp: string;
}

// ── 最近使用的串口配置 ──

export interface RecentSerialConfig {
  portName: string;
  config: SerialPortConfig;
}

// ═══════════════════════════════════════════
//  Modbus 类型
// ═══════════════════════════════════════════

export type ModbusTransport = 'tcp' | 'rtu';

// 支持的功能码
export type ModbusFunctionCode = 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16;

export interface ModbusFunctionCodeDef {
  code: ModbusFunctionCode;
  isWrite: boolean;
  isSingle: boolean;   // FC05/FC06: 单寄存器/线圈写
  maxQuantity: number;
}

export const MODBUS_FUNCTION_CODES: ModbusFunctionCodeDef[] = [
  { code: 1,  isWrite: false, isSingle: false, maxQuantity: 2000 },
  { code: 2,  isWrite: false, isSingle: false, maxQuantity: 2000 },
  { code: 3,  isWrite: false, isSingle: false, maxQuantity: 125  },
  { code: 4,  isWrite: false, isSingle: false, maxQuantity: 125  },
  { code: 5,  isWrite: true,  isSingle: true,  maxQuantity: 1    },
  { code: 6,  isWrite: true,  isSingle: true,  maxQuantity: 1    },
  { code: 15, isWrite: true,  isSingle: false, maxQuantity: 1968 },
  { code: 16, isWrite: true,  isSingle: false, maxQuantity: 123  },
];

// ── Modbus 执行结果（单条寄存器/线圈） ──

export interface ModbusRegisterValue {
  /** 从 startAddress 计算的绝对地址 */
  address: number;
  /** 解析后的数值（寄存器为 uint16，线圈为 0/1） */
  value: number;
}

// ── 后端 modbus_execute 返回值 ──

export interface ModbusResponse {
  functionCode: number;
  /** 读操作时：寄存器值列表 (uint16) */
  registers?: number[];
  /** 读线圈/离散输入时：线圈值列表 */
  coils?: boolean[];
  /** 写操作时：写入数量确认 */
  writeCount?: number;
  rawHex: string;
  durationMs: number;
  timestamp: string;
}

// ── Modbus 连接事件（后端推送） ──

export interface ModbusEvent {
  connId: string;
  eventType: 'connected' | 'disconnected' | 'error';
  data?: string;
  timestamp: string;
}

// ── 事务日志条目 ──

export interface ModbusTransaction {
  id: string;
  timestamp: string;
  unitId: number;
  functionCode: ModbusFunctionCode;
  startAddress: number;
  quantity: number;
  requestHex: string;
  response?: ModbusResponse;
  error?: string;
  durationMs: number;
  success: boolean;
}
