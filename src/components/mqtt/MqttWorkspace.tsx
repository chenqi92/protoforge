// ProtoForge MQTT Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, Send, Plus, X, Radio, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, type RequestProtocol } from '@/stores/appStore';
import { RequestWorkbenchHeader } from '@/components/request/RequestWorkbenchHeader';
import { RequestProtocolSwitcher } from '@/components/request/RequestProtocolSwitcher';

interface MqttMessage {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  timestamp: string;
  direction: string;
}

export function MqttWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const tabId = activeTab?.id || '';

  // Connection config
  const [brokerUrl, setBrokerUrl] = useState('mqtt://localhost:1883');
  const [clientId, setClientId] = useState(`pf-${Date.now()}`);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // State
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [messages, setMessages] = useState<MqttMessage[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscriptions
  const [subscriptions, setSubscriptions] = useState<{ topic: string; qos: number }[]>([]);
  const [newSubTopic, setNewSubTopic] = useState('');
  const [newSubQos, setNewSubQos] = useState(0);

  // Publish
  const [pubTopic, setPubTopic] = useState('');
  const [pubPayload, setPubPayload] = useState('');
  const [pubQos, setPubQos] = useState(0);
  const [pubRetain, setPubRetain] = useState(false);

  const connId = `mqtt-${tabId}`;

  // Listen to backend events
  useEffect(() => {
    const unlisten1 = listen<MqttMessage>(`mqtt-message-${connId}`, (e) => {
      setMessages((prev) => [...prev, e.payload]);
    });
    const unlisten2 = listen<string>(`mqtt-status-${connId}`, (e) => {
      const s = e.payload;
      if (s === 'connecting') setStatus('connecting');
      else if (s === 'connected') { setStatus('connected'); setErrorMsg(''); }
      else if (s === 'disconnected') setStatus('disconnected');
      else if (s.startsWith('error:')) { setStatus('error'); setErrorMsg(s.slice(6)); }
    });
    return () => { unlisten1.then(f => f()); unlisten2.then(f => f()); };
  }, [connId]);

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, autoScroll]);

  const handleConnect = useCallback(async () => {
    setMessages([]);
    setErrorMsg('');
    try {
      await invoke('mqtt_connect', {
        connId,
        request: {
          brokerUrl, clientId,
          username: username || null,
          password: password || null,
          cleanSession: true,
          keepAliveSecs: 30,
        },
      });
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      setStatus('error');
    }
  }, [brokerUrl, clientId, username, password, connId]);

  const handleDisconnect = useCallback(async () => {
    try { await invoke('mqtt_disconnect', { connId }); } catch {}
  }, [connId]);

  const handleSubscribe = useCallback(async () => {
    if (!newSubTopic.trim()) return;
    try {
      await invoke('mqtt_subscribe', { connId, topic: newSubTopic, qos: newSubQos });
      setSubscriptions((prev) => [...prev, { topic: newSubTopic, qos: newSubQos }]);
      setNewSubTopic('');
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  }, [connId, newSubTopic, newSubQos]);

  const handleUnsubscribe = useCallback(async (topic: string) => {
    try {
      await invoke('mqtt_unsubscribe', { connId, topic });
      setSubscriptions((prev) => prev.filter(s => s.topic !== topic));
    } catch {}
  }, [connId]);

  const handlePublish = useCallback(async () => {
    if (!pubTopic.trim()) return;
    try {
      await invoke('mqtt_publish', { connId, topic: pubTopic, payload: pubPayload, qos: pubQos, retain: pubRetain });
      setMessages((prev) => [...prev, {
        topic: pubTopic, payload: pubPayload, qos: pubQos, retain: pubRetain,
        timestamp: new Date().toISOString(), direction: 'out',
      }]);
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  }, [connId, pubTopic, pubPayload, pubQos, pubRetain]);

  const isConnected = status === 'connected';

  const handleProtocolChange = useCallback(async (protocol: RequestProtocol) => {
    if (!activeTab || protocol === activeTab.protocol) return;
    try {
      if (status === 'connected' || status === 'connecting') {
        await invoke('mqtt_disconnect', { connId });
      }
    } catch {}
    setTabProtocol(activeTab.id, protocol);
  }, [activeTab, connId, setTabProtocol, status]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Connection Bar */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab?.protocol || "mqtt"} onChange={handleProtocolChange} />
        )}
        main={(
          <div className="flex min-w-0 flex-1 items-center">
            <input
              value={brokerUrl}
              onChange={(e) => setBrokerUrl(e.target.value)}
              placeholder="mqtt://broker:1883"
              disabled={isConnected}
              className="wb-request-input disabled:opacity-50"
            />
          </div>
        )}
        actions={
          isConnected || status === 'connecting' ? (
            <button onClick={handleDisconnect} className="wb-primary-btn min-w-[88px] bg-red-500 hover:bg-red-600">
              <Square className="w-3 h-3 fill-white" /> 断开
            </button>
          ) : (
            <button onClick={handleConnect} className="wb-primary-btn min-w-[88px] bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600">
              <Play className="w-3 h-3 fill-white" /> 连接
            </button>
          )
        }
        secondary={(
          <>
            <div className="wb-inline-field min-w-[180px] flex-[1.15_1_0%]">
              <span>Client ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" disabled={isConnected} />
            </div>
            <div className="wb-inline-field min-w-[150px] flex-1">
              <span>用户名</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="可选" disabled={isConnected} />
            </div>
            <div className="wb-inline-field min-w-[150px] flex-1">
              <span>密码</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="可选" type="password" disabled={isConnected} />
            </div>
            <span className={cn("wb-request-meta ml-auto",
              status === 'connected' ? "text-emerald-600" :
              status === 'connecting' ? "text-amber-600" :
              status === 'error' ? "text-red-500" : "text-text-tertiary"
            )}>
              <span className={cn("wb-request-meta-dot",
                status === 'connected' ? "bg-emerald-500" : status === 'connecting' ? "bg-amber-500 animate-pulse" : status === 'error' ? "bg-red-500" : "bg-gray-400"
              )} />
              {status === 'idle' ? '未连接' : status === 'connecting' ? '连接中' : status === 'connected' ? '已连接' : status === 'disconnected' ? '已断开' : '错误'}
            </span>
            {errorMsg ? <span className="text-[11px] text-red-500">{errorMsg}</span> : null}
          </>
        )}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Subscriptions + Publish */}
        <div className="flex w-[304px] min-w-[288px] shrink-0 flex-col gap-2.5 overflow-hidden px-3 pb-3 pt-1.5">
          {/* Subscriptions */}
          <div className="wb-subpanel p-2.5">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-disabled">订阅</h3>
            <div className="mb-2 flex items-center gap-2">
              <input value={newSubTopic} onChange={(e) => setNewSubTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubscribe()}
                placeholder="topic/path/#" disabled={!isConnected} className="wb-field-sm min-w-0 flex-1 font-mono disabled:opacity-50" />
              <select value={newSubQos} onChange={(e) => setNewSubQos(Number(e.target.value))} disabled={!isConnected}
                className="wb-field-sm wb-native-select w-[84px] shrink-0 disabled:opacity-50">
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <button onClick={handleSubscribe} disabled={!isConnected || !newSubTopic.trim()} className="wb-icon-btn border-0 bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 max-h-24 overflow-auto">
              {subscriptions.map((sub, i) => (
                <div key={i} className="flex items-center justify-between rounded-[12px] bg-bg-primary px-2 py-1 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <span className="font-mono text-text-secondary truncate">{sub.topic}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-text-disabled">Q{sub.qos}</span>
                    <button onClick={() => handleUnsubscribe(sub.topic)} className="text-text-disabled hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Publish */}
          <div className="wb-subpanel flex flex-1 flex-col p-2.5">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-disabled">发布</h3>
            <input value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} placeholder="topic/path" disabled={!isConnected}
              className="wb-field-sm mb-2 font-mono disabled:opacity-50" />
            <textarea value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} placeholder="消息内容..." disabled={!isConnected}
              className="wb-textarea mb-2 flex-1 min-h-[128px] text-[12px] text-text-secondary disabled:opacity-50" />
            <div className="flex flex-wrap items-center gap-2">
              <select value={pubQos} onChange={(e) => setPubQos(Number(e.target.value))} disabled={!isConnected}
                className="wb-field-sm wb-native-select w-[86px] shrink-0 disabled:opacity-50">
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <label className={cn("flex shrink-0 items-center gap-1 text-[11px] cursor-pointer", !isConnected && "opacity-50")}>
                <input type="checkbox" checked={pubRetain} onChange={(e) => setPubRetain(e.target.checked)} disabled={!isConnected} className="accent-accent" /> Retain
              </label>
              <button onClick={handlePublish} disabled={!isConnected || !pubTopic.trim()} className="wb-primary-btn ml-auto min-w-[84px] bg-violet-500 hover:bg-violet-600 disabled:opacity-40">
                <Send className="w-3 h-3" /> 发送
              </button>
            </div>
          </div>
        </div>

        {/* Right: Message List */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-0 pb-3 pt-1.5 pr-3">
          <div className="wb-panel flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="wb-panel-header shrink-0 text-[11px]">
              <div className="min-w-0 flex flex-1 items-center">
                <span className="text-text-disabled">{messages.length} 条消息</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                <button onClick={() => setAutoScroll(!autoScroll)} className={cn("wb-ghost-btn px-2.5 text-[11px]", autoScroll && "text-accent")}>
                  <ArrowDown className="w-3 h-3" /> 自动滚动
                </button>
                <button onClick={() => setMessages([])} className="wb-icon-btn hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            <div ref={listRef} className="flex-1 overflow-auto bg-bg-secondary/12 p-4 space-y-2">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                  <Radio className="w-10 h-10 mb-3 opacity-20 text-violet-500" />
                  <p className="text-[13px] font-medium">等待消息...</p>
                  <p className="text-[11px] mt-1">连接 MQTT Broker 并订阅 Topic 后将显示消息</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={cn("rounded-[16px] border p-3 transition-colors", msg.direction === 'out' ? "bg-violet-500/5 border-violet-500/20" : "bg-bg-primary/82 border-border-default/75")}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", msg.direction === 'out' ? "bg-violet-500/20 text-violet-600" : "bg-emerald-500/20 text-emerald-600")}>
                        {msg.direction === 'out' ? '发送' : '接收'}
                      </span>
                      <span className="text-[10px] font-mono text-accent">{msg.topic}</span>
                      <span className="text-[10px] text-text-disabled ml-auto">Q{msg.qos}</span>
                      {msg.retain && <span className="text-[9px] text-amber-600 bg-amber-500/10 px-1 rounded">R</span>}
                      <span className="text-[10px] font-mono text-text-disabled">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all">{msg.payload}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
