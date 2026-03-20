// ProtoForge MQTT Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, Send, Plus, X, Radio, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';

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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Connection Bar */}
      <div className="shrink-0 space-y-2 border-b border-border-default/70 bg-transparent p-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-violet-500 shrink-0" />
          <input value={brokerUrl} onChange={(e) => setBrokerUrl(e.target.value)} placeholder="mqtt://broker:1883"
            disabled={isConnected} className="flex-1 h-8 px-2 text-[13px] font-mono bg-bg-input border border-border-default rounded-md text-text-primary outline-none focus:border-accent disabled:opacity-50" />
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID"
            disabled={isConnected} className="w-40 h-8 px-2 text-[12px] font-mono bg-bg-input border border-border-default rounded-md text-text-secondary outline-none focus:border-accent disabled:opacity-50" />
          {isConnected || status === 'connecting' ? (
            <button onClick={handleDisconnect} className="h-8 px-4 rounded-md text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 shrink-0 flex items-center gap-1">
              <Square className="w-3 h-3 fill-white" /> 断开
            </button>
          ) : (
            <button onClick={handleConnect} className="h-8 px-4 rounded-md text-[12px] font-semibold text-white bg-violet-500 hover:bg-violet-600 shrink-0 flex items-center gap-1">
              <Play className="w-3 h-3 fill-white" /> 连接
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名(可选)" disabled={isConnected}
            className="h-7 px-2 text-[12px] bg-bg-input border border-border-default rounded text-text-secondary outline-none w-32 disabled:opacity-50" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码(可选)" type="password" disabled={isConnected}
            className="h-7 px-2 text-[12px] bg-bg-input border border-border-default rounded text-text-secondary outline-none w-32 disabled:opacity-50" />
          <span className={cn("flex items-center gap-1 ml-auto font-medium",
            status === 'connected' ? "text-emerald-600" :
            status === 'connecting' ? "text-amber-600" :
            status === 'error' ? "text-red-500" : "text-text-tertiary"
          )}>
            <span className={cn("w-2 h-2 rounded-full",
              status === 'connected' ? "bg-emerald-500" : status === 'connecting' ? "bg-amber-500 animate-pulse" : status === 'error' ? "bg-red-500" : "bg-gray-400"
            )} />
            {status === 'idle' ? '未连接' : status === 'connecting' ? '连接中' : status === 'connected' ? '已连接' : status === 'disconnected' ? '已断开' : '错误'}
          </span>
          {errorMsg && <span className="text-red-500 truncate max-w-xs">{errorMsg}</span>}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Subscriptions + Publish */}
        <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border-default/70 bg-bg-secondary/18">
          {/* Subscriptions */}
          <div className="border-b border-border-default/70 p-3">
            <h3 className="text-[11px] font-bold text-text-disabled uppercase tracking-wider mb-2">订阅</h3>
            <div className="flex items-center gap-1 mb-2">
              <input value={newSubTopic} onChange={(e) => setNewSubTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubscribe()}
                placeholder="topic/path/#" disabled={!isConnected} className="flex-1 h-7 px-2 text-[12px] font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent disabled:opacity-50" />
              <select value={newSubQos} onChange={(e) => setNewSubQos(Number(e.target.value))} disabled={!isConnected}
                className="h-7 w-14 px-1 text-[11px] bg-bg-input border border-border-default rounded text-text-secondary outline-none disabled:opacity-50">
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <button onClick={handleSubscribe} disabled={!isConnected || !newSubTopic.trim()} className="h-7 w-7 flex items-center justify-center rounded bg-accent text-white disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 max-h-24 overflow-auto">
              {subscriptions.map((sub, i) => (
                <div key={i} className="flex items-center justify-between rounded-[12px] bg-bg-primary/78 px-2 py-1 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
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
          <div className="flex flex-1 flex-col p-3">
            <h3 className="text-[11px] font-bold text-text-disabled uppercase tracking-wider mb-2">发布</h3>
            <input value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} placeholder="topic/path" disabled={!isConnected}
              className="h-7 px-2 text-[12px] font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent mb-2 disabled:opacity-50" />
            <textarea value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} placeholder="消息内容..." disabled={!isConnected}
              className="flex-1 min-h-[60px] p-2 text-[12px] font-mono bg-bg-input border border-border-default rounded resize-none text-text-secondary outline-none focus:border-accent mb-2 disabled:opacity-50" />
            <div className="flex items-center gap-2">
              <select value={pubQos} onChange={(e) => setPubQos(Number(e.target.value))} disabled={!isConnected}
                className="h-7 w-20 px-1 text-[11px] bg-bg-input border border-border-default rounded text-text-secondary outline-none disabled:opacity-50">
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <label className={cn("flex items-center gap-1 text-[11px] cursor-pointer", !isConnected && "opacity-50")}>
                <input type="checkbox" checked={pubRetain} onChange={(e) => setPubRetain(e.target.checked)} disabled={!isConnected} className="accent-accent" /> Retain
              </label>
              <button onClick={handlePublish} disabled={!isConnected || !pubTopic.trim()} className="ml-auto h-7 px-3 rounded text-[12px] font-medium text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-40 flex items-center gap-1">
                <Send className="w-3 h-3" /> 发送
              </button>
            </div>
          </div>
        </div>

        {/* Right: Message List */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border-default/70 bg-bg-secondary/20 px-3 text-[11px]">
            <span className="text-text-disabled">{messages.length} 条消息</span>
            <button onClick={() => setAutoScroll(!autoScroll)} className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ml-auto", autoScroll ? "text-accent bg-accent/10" : "text-text-disabled hover:text-text-secondary")}>
              <ArrowDown className="w-3 h-3" /> 自动滚动
            </button>
            <button onClick={() => setMessages([])} className="text-text-disabled hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
          </div>
          <div ref={listRef} className="flex-1 overflow-auto bg-bg-secondary/12 p-3 space-y-1">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <Radio className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-[13px] font-medium">等待消息...</p>
                <p className="text-[11px] mt-1">连接 MQTT Broker 并订阅 Topic 后将显示消息</p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={cn("rounded-[14px] border p-2.5 transition-colors", msg.direction === 'out' ? "bg-violet-500/5 border-violet-500/20" : "bg-bg-primary/78 border-border-default/75")}>
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
  );
}
