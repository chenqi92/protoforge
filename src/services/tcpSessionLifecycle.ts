import { clearConnectionsForKeys } from "@/lib/connectionRegistry";
import * as modbusService from "@/services/modbusService";
import * as serialService from "@/services/serialService";
import * as tcpService from "@/services/tcpService";

/**
 * A protocol-debugging session can render a primary panel and a temporary
 * split panel. Both keys continue to own their backend handles when a view is
 * unmounted (for example while docking a window or hiding the split panel).
 */
export function getTcpSessionKeys(sessionId: string): [string, string] {
  return [sessionId, `${sessionId}-split`];
}

function releaseSessionKeyResources(sessionKey: string): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([
    tcpService.tcpDisconnect(`tcp-client:${sessionKey}`),
    tcpService.tcpServerStop(`tcp-server:${sessionKey}`),
    tcpService.udpClose(`udp-client:${sessionKey}`),
    tcpService.udpClose(`udp-server:${sessionKey}`),
    serialService.serialClose(`serial:${sessionKey}`),
    modbusService.modbusTcpDisconnect(`modbus:${sessionKey}`),
    modbusService.modbusRtuClose(`modbus:${sessionKey}`),
    modbusService.modbusSlaveStopTcp(`modbus-slave-${sessionKey}`),
    modbusService.modbusSlaveStopRtu(`modbus-slave-${sessionKey}`),
  ]);
}

/**
 * Best-effort, idempotent release of every backend handle a TCP/UDP tool
 * session can own. One missing/already-closed handle must not prevent the
 * remaining modes from being released.
 */
export async function releaseTcpSessionResources(sessionId: string): Promise<void> {
  const sessionKeys = getTcpSessionKeys(sessionId);
  try {
    await Promise.all(sessionKeys.map(releaseSessionKeyResources));
  } finally {
    clearConnectionsForKeys(sessionKeys);
  }
}
