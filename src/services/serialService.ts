// 串口服务层 — Tauri IPC 封装
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SerialPortInfo, SerialPortConfig, SerialConnectionStatus, SerialEvent } from '@/types/serial';

const MAX_BUFFERED_SERIAL_PORTS = 16;
const MAX_BUFFERED_SERIAL_GENERATIONS = 4;
const MAX_BUFFERED_SERIAL_EVENTS_PER_GENERATION = 256;
const MAX_BUFFERED_SERIAL_BYTES_PER_GENERATION = 1024 * 1024;
const MAX_BUFFERED_SERIAL_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_SERIAL_CONSUMER_CURSORS = 128;

interface SequencedSerialEvent {
  sequence: number;
  event: SerialEvent;
  bytes: number;
  activityRecorded: boolean;
}

interface SerialGenerationBuffer {
  events: SequencedSerialEvent[];
  bytes: number;
}

interface SerialEventSubscriber {
  consumerId: string;
  portId: string;
  callback: (event: SerialEvent, delivery: SerialEventDelivery) => void;
}

export interface SerialEventDelivery {
  replayed: boolean;
  recordActivity: boolean;
}

const serialEventSubscribers = new Set<SerialEventSubscriber>();
const bufferedSerialEvents = new Map<string, Map<string, SerialGenerationBuffer>>();
const serialConsumerCursors = new Map<string, number>();
let serialEventSequence = 0;
let bufferedSerialTotalBytes = 0;
let serialEventListenerPromise: Promise<void> | null = null;

function serialPayloadBytes(event: SerialEvent): number {
  const payloadBytes = event.rawHex
    ? Math.ceil(event.rawHex.replace(/\s/g, '').length / 2)
    : new TextEncoder().encode(event.data ?? '').byteLength;
  const declaredBytes = event.size !== undefined && Number.isFinite(event.size)
    ? Math.max(0, Math.trunc(event.size))
    : 0;
  return Math.max(payloadBytes, declaredBytes);
}

function rememberConsumerCursor(consumerId: string, sequence: number) {
  serialConsumerCursors.delete(consumerId);
  serialConsumerCursors.set(consumerId, sequence);
  while (serialConsumerCursors.size > MAX_SERIAL_CONSUMER_CURSORS) {
    const oldestConsumer = serialConsumerCursors.keys().next().value;
    if (oldestConsumer === undefined) break;
    serialConsumerCursors.delete(oldestConsumer);
  }
}

function rememberSerialEvent(item: SequencedSerialEvent) {
  let portBuffers = bufferedSerialEvents.get(item.event.portId);
  if (!portBuffers) {
    if (bufferedSerialEvents.size >= MAX_BUFFERED_SERIAL_PORTS) {
      const oldestPort = bufferedSerialEvents.keys().next().value;
      if (oldestPort !== undefined) {
        const removedPort = bufferedSerialEvents.get(oldestPort);
        if (removedPort) {
          for (const buffer of removedPort.values()) {
            bufferedSerialTotalBytes -= buffer.bytes;
          }
        }
        bufferedSerialEvents.delete(oldestPort);
      }
    }
    portBuffers = new Map();
    bufferedSerialEvents.set(item.event.portId, portBuffers);
  } else {
    // Map insertion order doubles as a bounded least-recently-used policy.
    bufferedSerialEvents.delete(item.event.portId);
    bufferedSerialEvents.set(item.event.portId, portBuffers);
  }

  let generationBuffer = portBuffers.get(item.event.generation);
  if (!generationBuffer) {
    if (portBuffers.size >= MAX_BUFFERED_SERIAL_GENERATIONS) {
      const oldestGeneration = portBuffers.keys().next().value;
      if (oldestGeneration !== undefined) {
        const removedGeneration = portBuffers.get(oldestGeneration);
        if (removedGeneration) bufferedSerialTotalBytes -= removedGeneration.bytes;
        portBuffers.delete(oldestGeneration);
      }
    }
    generationBuffer = { events: [], bytes: 0 };
    portBuffers.set(item.event.generation, generationBuffer);
  } else {
    portBuffers.delete(item.event.generation);
    portBuffers.set(item.event.generation, generationBuffer);
  }

  if (item.bytes > MAX_BUFFERED_SERIAL_BYTES_PER_GENERATION) return;
  while (
    generationBuffer.events.length >= MAX_BUFFERED_SERIAL_EVENTS_PER_GENERATION
    || generationBuffer.bytes + item.bytes > MAX_BUFFERED_SERIAL_BYTES_PER_GENERATION
  ) {
    const removed = generationBuffer.events.shift();
    if (!removed) break;
    generationBuffer.bytes -= removed.bytes;
    bufferedSerialTotalBytes -= removed.bytes;
  }
  generationBuffer.events.push(item);
  generationBuffer.bytes += item.bytes;
  bufferedSerialTotalBytes += item.bytes;

  while (bufferedSerialTotalBytes > MAX_BUFFERED_SERIAL_TOTAL_BYTES) {
    let oldest:
      | { portId: string; generation: string; item: SequencedSerialEvent }
      | undefined;
    for (const [portId, generations] of bufferedSerialEvents) {
      for (const [generation, buffer] of generations) {
        const candidate = buffer.events[0];
        if (candidate && (!oldest || candidate.sequence < oldest.item.sequence)) {
          oldest = { portId, generation, item: candidate };
        }
      }
    }
    if (!oldest) break;
    const generations = bufferedSerialEvents.get(oldest.portId);
    const buffer = generations?.get(oldest.generation);
    const removed = buffer?.events.shift();
    if (!removed || !buffer || !generations) break;
    buffer.bytes -= removed.bytes;
    bufferedSerialTotalBytes -= removed.bytes;
    if (buffer.events.length === 0) generations.delete(oldest.generation);
    if (generations.size === 0) bufferedSerialEvents.delete(oldest.portId);
  }
}

function bufferedEventsAfter(portId: string, sequence: number): SequencedSerialEvent[] {
  const portBuffers = bufferedSerialEvents.get(portId);
  if (!portBuffers) return [];
  const events: SequencedSerialEvent[] = [];
  for (const generation of portBuffers.values()) {
    for (const item of generation.events) {
      if (item.sequence > sequence) events.push(item);
    }
  }
  return events.sort((left, right) => left.sequence - right.sequence);
}

function dispatchSerialEvent(event: SerialEvent) {
  const item: SequencedSerialEvent = {
    sequence: ++serialEventSequence,
    event,
    bytes: event.eventType === 'data' ? serialPayloadBytes(event) : 0,
    activityRecorded: false,
  };
  // Keep a bounded app-lifetime ring even while a panel is mounted. A panel
  // remount can therefore replay only the events delivered after its cursor.
  rememberSerialEvent(item);

  for (const subscriber of serialEventSubscribers) {
    if (subscriber.portId !== event.portId) continue;
    const recordActivity = !item.activityRecorded;
    if (recordActivity) item.activityRecorded = true;
    try {
      subscriber.callback(event, { replayed: false, recordActivity });
    } catch (error) {
      console.error('[SERIAL] event subscriber failed:', error);
    } finally {
      rememberConsumerCursor(subscriber.consumerId, item.sequence);
    }
  }
}

function ensureSerialEventListener(): Promise<void> {
  if (!serialEventListenerPromise) {
    serialEventListenerPromise = listen<SerialEvent>('serial-event', (event) => {
      dispatchSerialEvent(event.payload);
    }).then(() => undefined).catch((error) => {
      serialEventListenerPromise = null;
      throw error;
    });
  }
  return serialEventListenerPromise;
}

// Start registration as soon as this lazily loaded service module evaluates.
// The underlying listener intentionally remains for the renderer lifetime.
void ensureSerialEventListener().catch(() => {});

// ── 端口枚举 ──

export async function serialListPorts(): Promise<SerialPortInfo[]> {
  return invoke<SerialPortInfo[]>('serial_list_ports');
}

// ── 端口开关 ──

export async function serialOpen(portId: string, portName: string, config: SerialPortConfig): Promise<SerialConnectionStatus> {
  return invoke<SerialConnectionStatus>('serial_open', { portId, portName, config });
}

export async function serialClose(portId: string): Promise<void> {
  return invoke('serial_close', { portId });
}

export async function serialCloseGeneration(portId: string, generation: string): Promise<boolean> {
  return invoke<boolean>('serial_close_generation', { portId, generation });
}

export async function serialGetStatus(portId: string): Promise<SerialConnectionStatus | null> {
  return invoke<SerialConnectionStatus | null>('serial_get_status', { portId });
}

// ── 数据发送 ──

export async function serialSend(portId: string, generation: string, data: string, encoding: string = 'utf8'): Promise<void> {
  return invoke('serial_send', { portId, generation, data, encoding });
}

// ── 信号控制 ──

export async function serialSetDtr(portId: string, generation: string, value: boolean): Promise<void> {
  return invoke('serial_set_dtr', { portId, generation, value });
}

export async function serialSetRts(portId: string, generation: string, value: boolean): Promise<void> {
  return invoke('serial_set_rts', { portId, generation, value });
}

// ── 事件监听 ──

export async function onSerialEvent(
  consumerId: string,
  portId: string,
  callback: (event: SerialEvent, delivery: SerialEventDelivery) => void,
): Promise<UnlistenFn> {
  await ensureSerialEventListener();

  const existingCursor = serialConsumerCursors.get(consumerId);
  const cursor = existingCursor ?? 0;
  for (const item of bufferedEventsAfter(portId, cursor)) {
    // Rebuild a remounted panel from the whole bounded buffer, but write each
    // physical event to the global activity log exactly once. Events delivered
    // live already carry `activityRecorded`; events received while no panel was
    // mounted are recorded by the first replaying consumer.
    const recordActivity = !item.activityRecorded;
    if (recordActivity) item.activityRecorded = true;
    try {
      callback(item.event, {
        replayed: true,
        // Local history is rebuilt on every mount; the per-item flag keeps the
        // application-wide activity log free of duplicates.
        recordActivity,
      });
    } catch (error) {
      console.error('[SERIAL] buffered event subscriber failed:', error);
    } finally {
      rememberConsumerCursor(consumerId, item.sequence);
    }
  }

  const subscriber: SerialEventSubscriber = { consumerId, portId, callback };
  serialEventSubscribers.add(subscriber);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    serialEventSubscribers.delete(subscriber);
  };
}
