// ProtoForge gRPC Service — Tauri IPC wrapper

import { invoke } from '@tauri-apps/api/core';
import type { ProtoLoadResult, GrpcCallResult } from '@/types/grpc';

/** Load a .proto file from the file system */
export async function loadProtoFile(protoPath: string): Promise<ProtoLoadResult> {
  return invoke<ProtoLoadResult>('grpc_load_proto', { protoPath });
}

/** Load proto definition from raw content string */
export async function loadProtoContent(content: string, key: string): Promise<ProtoLoadResult> {
  return invoke<ProtoLoadResult>('grpc_load_proto_content', { content, key });
}

/** Use gRPC reflection to discover services */
export async function reflectServices(url: string): Promise<ProtoLoadResult> {
  return invoke<ProtoLoadResult>('grpc_reflect', { url });
}

/** Make a unary gRPC call */
export async function callUnary(
  url: string,
  protoKey: string,
  methodFullName: string,
  requestJson: string,
  metadata: Record<string, string>,
): Promise<GrpcCallResult> {
  return invoke<GrpcCallResult>('grpc_call_unary', {
    url,
    protoKey,
    methodFullName,
    requestJson,
    metadata,
  });
}

/** Start a server-streaming gRPC call */
export async function callServerStream(
  connectionId: string,
  url: string,
  protoKey: string,
  methodFullName: string,
  requestJson: string,
  metadata: Record<string, string>,
): Promise<void> {
  return invoke('grpc_call_server_stream', {
    connectionId,
    url,
    protoKey,
    methodFullName,
    requestJson,
    metadata,
  });
}

/** Start a client-streaming gRPC call */
export async function callClientStream(
  connectionId: string,
  url: string,
  protoKey: string,
  methodFullName: string,
  metadata: Record<string, string>,
): Promise<void> {
  return invoke('grpc_call_client_stream', {
    connectionId, url, protoKey, methodFullName, metadata,
  });
}

/** Start a bidirectional streaming gRPC call */
export async function callBidiStream(
  connectionId: string,
  url: string,
  protoKey: string,
  methodFullName: string,
  metadata: Record<string, string>,
): Promise<void> {
  return invoke('grpc_call_bidi_stream', {
    connectionId, url, protoKey, methodFullName, metadata,
  });
}

/** Send a message on an active client/bidi stream */
export async function streamSend(
  connectionId: string,
  protoKey: string,
  methodFullName: string,
  messageJson: string,
): Promise<void> {
  return invoke('grpc_stream_send', {
    connectionId, protoKey, methodFullName, messageJson,
  });
}

/** Close the send side of a client/bidi stream */
export async function streamCloseSend(connectionId: string): Promise<void> {
  return invoke('grpc_stream_close_send', { connectionId });
}

/** Cancel a streaming call */
export async function cancelStream(connectionId: string): Promise<void> {
  return invoke('grpc_cancel_stream', { connectionId });
}

/** Open file picker for .proto files */
export async function pickProtoFile(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      title: 'Select .proto file',
      filters: [{ name: 'Proto', extensions: ['proto'] }],
    });
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && 'path' in result) return (result as { path: string }).path;
    return null;
  } catch {
    return null;
  }
}
