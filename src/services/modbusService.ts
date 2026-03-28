// Modbus 服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SerialPortConfig, ModbusResponse, ModbusEvent, ModbusSlaveEvent } from '@/types/serial';

// ── Modbus TCP ──

export async function modbusTcpConnect(connId: string, host: string, port: number): Promise<void> {
  return invoke('modbus_tcp_connect', { connId, host, port });
}

export async function modbusTcpDisconnect(connId: string): Promise<void> {
  return invoke('modbus_tcp_disconnect', { connId });
}

// ── Modbus RTU (over serial) ──

export async function modbusRtuOpen(connId: string, portName: string, config: SerialPortConfig): Promise<void> {
  return invoke('modbus_rtu_open', { connId, portName, config });
}

export async function modbusRtuClose(connId: string): Promise<void> {
  return invoke('modbus_rtu_close', { connId });
}

// ── 功能码执行（读/写） ──

export async function modbusExecute(
  connId: string,
  unitId: number,
  functionCode: number,
  startAddress: number,
  quantity: number,
  values: number[],
): Promise<ModbusResponse> {
  return invoke<ModbusResponse>('modbus_execute', {
    connId,
    unitId,
    functionCode,
    startAddress,
    quantity,
    values,
  });
}

// ── 事件监听 ──

export function onModbusEvent(callback: (event: ModbusEvent) => void): Promise<UnlistenFn> {
  return listen<ModbusEvent>('modbus-event', (e) => callback(e.payload));
}

// ── Modbus 从站 (Slave) ──

export async function modbusSlaveStartTcp(connId: string, host: string, port: number, unitId: number): Promise<void> {
  return invoke('modbus_slave_tcp_start', { connId, host, port, unitId });
}

export async function modbusSlaveStopTcp(connId: string): Promise<void> {
  return invoke('modbus_slave_tcp_stop', { connId });
}

export async function modbusSlaveStartRtu(connId: string, portName: string, config: SerialPortConfig, unitId: number): Promise<void> {
  return invoke('modbus_slave_rtu_start', { connId, portName, config, unitId });
}

export async function modbusSlaveStopRtu(connId: string): Promise<void> {
  return invoke('modbus_slave_rtu_stop', { connId });
}

export async function modbusSlaveSetHoldingReg(connId: string, address: number, value: number): Promise<void> {
  return invoke('modbus_slave_set_holding_register', { connId, address, value });
}

export async function modbusSlaveSetCoil(connId: string, address: number, value: boolean): Promise<void> {
  return invoke('modbus_slave_set_coil', { connId, address, value });
}

export async function modbusSlaveSetInputReg(connId: string, address: number, value: number): Promise<void> {
  return invoke('modbus_slave_set_input_register', { connId, address, value });
}

export async function modbusSlaveSetDiscreteInput(connId: string, address: number, value: boolean): Promise<void> {
  return invoke('modbus_slave_set_discrete_input', { connId, address, value });
}

export function onModbusSlaveEvent(callback: (event: ModbusSlaveEvent) => void): Promise<UnlistenFn> {
  return listen<ModbusSlaveEvent>('modbus-slave-event', (e) => callback(e.payload));
}
