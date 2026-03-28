// ProtoForge MQTT Workspace Component

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Trash2, Send, Plus, X, Radio, ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import { RequestWorkbenchHeader } from '@/components/request/RequestWorkbenchHeader';
import { RequestProtocolSwitcher, type RequestKind } from '@/components/request/RequestProtocolSwitcher';

interface MqttMessage {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  timestamp: string;
  direction: string;
}

export function MqttWorkspace({ tabId }: { tabId: string }) {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === tabId));
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);
  const updateHttpConfig = useAppStore((s) => s.updateHttpConfig);

  const { t } = useTranslation();

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
      setMessages((prev) => {
        const next = [...prev, e.payload];
        return next.length > 5000 ? next.slice(-5000) : next;
      });
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
      setMessages((prev) => {
        const next = [...prev, {
          topic: pubTopic, payload: pubPayload, qos: pubQos, retain: pubRetain,
          timestamp: new Date().toISOString(), direction: 'out',
        }];
        return next.length > 5000 ? next.slice(-5000) : next;
      });
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  }, [connId, pubTopic, pubPayload, pubQos, pubRetain]);

  const isConnected = status === 'connected';

  const handleRequestKindChange = useCallback(async (kind: RequestKind) => {
    if (!activeTab || kind === activeTab.protocol) return;
    try {
      if (status === 'connected' || status === 'connecting') {
        await invoke('mqtt_disconnect', { connId });
      }
    } catch {}

    if (kind === "mqtt") return;

    if (kind === "ws") {
      setTabProtocol(activeTab.id, "ws");
      return;
    }

    setTabProtocol(activeTab.id, "http");
    updateHttpConfig(activeTab.id, {
      requestMode: kind === "http" ? "rest" : kind,
      name: kind === "graphql" ? "GraphQL Request" : "Untitled Request",
      method: kind === "graphql" ? "POST" : "GET",
    });
  }, [activeTab, connId, setTabProtocol, status, updateHttpConfig]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Connection Bar */}
      <RequestWorkbenchHeader
        prefix={(
          <RequestProtocolSwitcher activeProtocol={activeTab?.protocol || "mqtt"} onChange={handleRequestKindChange} />
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
            <button onClick={handleDisconnect} className="wb-primary-btn min-w-[88px] bg-error hover:bg-error/90">
              <Square className="w-3 h-3 fill-white" /> {t('mqtt.disconnect')}
            </button>
          ) : (
            <button onClick={handleConnect} className="wb-primary-btn min-w-[88px] bg-accent hover:bg-accent-hover">
              <Play className="w-3 h-3 fill-white" /> {t('mqtt.connect')}
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
              <span>{t('mqtt.username')}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('mqtt.optional')} disabled={isConnected} />
            </div>
            <div className="wb-inline-field min-w-[150px] flex-1">
              <span>{t('mqtt.password')}</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('mqtt.optional')} type="password" disabled={isConnected} />
            </div>
            <span className={cn("wb-request-meta ml-auto",
              status === 'connected' ? "text-emerald-600" :
              status === 'connecting' ? "text-amber-600" :
              status === 'error' ? "text-red-500" : "text-text-tertiary"
            )}>
              <span className={cn("wb-request-meta-dot",
                status === 'connected' ? "bg-emerald-500" : status === 'connecting' ? "bg-amber-500 animate-pulse" : status === 'error' ? "bg-red-500" : "bg-gray-400"
              )} />
              {status === 'idle' ? t('mqtt.idle') : status === 'connecting' ? t('mqtt.connecting') : status === 'connected' ? t('mqtt.connected') : status === 'disconnected' ? t('mqtt.disconnected') : t('mqtt.error')}
            </span>
            {errorMsg ? <span className="text-[var(--fs-xs)] text-red-500">{errorMsg}</span> : null}
          </>
        )}
      />

      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-1.5">
        <div className="wb-workbench-grid">
          <div className="wb-workbench-sidebar">
            <div className="flex shrink-0 flex-col p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[var(--fs-xxs)] font-bold uppercase tracking-wider text-text-disabled">{t('mqtt.subscriptions')}</h3>
                <span className="text-[var(--fs-xxs)] text-text-disabled">{t('mqtt.subscriptionCount', { count: subscriptions.length })}</span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <input value={newSubTopic} onChange={(e) => setNewSubTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubscribe()}
                  placeholder="topic/path/#" disabled={!isConnected} className="wb-field-sm min-w-0 flex-1 font-mono disabled:opacity-50" />
                <select value={newSubQos} onChange={(e) => setNewSubQos(Number(e.target.value))} disabled={!isConnected}
                  className="wb-field-sm wb-native-select w-[84px] shrink-0 disabled:opacity-50">
                  <option value={0}>QoS 0</option>
                  <option value={1}>QoS 1</option>
                  <option value={2}>QoS 2</option>
                </select>
                <button onClick={handleSubscribe} disabled={!isConnected || !newSubTopic.trim()} className="wb-icon-btn border-0 bg-accent text-white hover:bg-accent-hover disabled:opacity-50">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-28 space-y-1 overflow-auto">
                {subscriptions.length === 0 ? (
                  <div className="border-t border-border-default/60 pt-3 text-[var(--fs-xs)] text-text-disabled">
                    {t('mqtt.subscriptionHint')}
                  </div>
                ) : (
                  subscriptions.map((sub, i) => (
                    <div key={i} className="flex items-center justify-between border-t border-border-default/60 py-2 text-[var(--fs-xs)]">
                      <span className="truncate font-mono text-text-secondary">{sub.topic}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-[var(--radius-sm)] bg-bg-primary px-1.5 py-0.5 text-[var(--fs-xxs)] text-text-tertiary">Q{sub.qos}</span>
                        <button onClick={() => handleUnsubscribe(sub.topic)} className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-disabled transition-colors hover:bg-bg-hover hover:text-red-500"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="wb-pane-divider" />

            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[var(--fs-xxs)] font-bold uppercase tracking-wider text-text-disabled">{t('mqtt.publish')}</h3>
                <span className="text-[var(--fs-xxs)] text-text-disabled">{t('mqtt.publishDesc')}</span>
              </div>
              <input value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} placeholder="topic/path" disabled={!isConnected}
                className="wb-field-sm mb-2 font-mono disabled:opacity-50" />
              <textarea value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} placeholder={t('mqtt.messagePlaceholder')} disabled={!isConnected}
                className="wb-textarea mb-2 flex-1 min-h-[160px] text-[var(--fs-sm)] text-text-secondary disabled:opacity-50" />
              <div className="flex flex-wrap items-center gap-2 border-t border-border-default/60 pt-2">
                <select value={pubQos} onChange={(e) => setPubQos(Number(e.target.value))} disabled={!isConnected}
                  className="wb-field-sm wb-native-select w-[86px] shrink-0 disabled:opacity-50">
                  <option value={0}>QoS 0</option>
                  <option value={1}>QoS 1</option>
                  <option value={2}>QoS 2</option>
                </select>
                <label className={cn("flex shrink-0 items-center gap-1 text-[var(--fs-xs)] cursor-pointer", !isConnected && "opacity-50")}>
                  <input type="checkbox" checked={pubRetain} onChange={(e) => setPubRetain(e.target.checked)} disabled={!isConnected} className="accent-accent" /> Retain
                </label>
                <button onClick={handlePublish} disabled={!isConnected || !pubTopic.trim()} className="wb-primary-btn ml-auto min-w-[84px] bg-accent hover:bg-accent-hover disabled:opacity-50">
                  <Send className="w-3 h-3" /> {t('mqtt.send')}
                </button>
              </div>
            </div>
          </div>

          <div className="wb-workbench-main">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-primary">
              <div className="wb-pane-header shrink-0 text-[var(--fs-xs)]">
                <div className="min-w-0 flex flex-1 items-center">
                  <span className="text-text-disabled">{t('mqtt.messageCount', { count: messages.length })}</span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  <button onClick={() => setAutoScroll(!autoScroll)} className={cn("wb-ghost-btn px-2.5 text-[var(--fs-xs)]", autoScroll && "text-accent")}>
                    <ArrowDown className="w-3 h-3" /> {t('mqtt.autoScroll')}
                  </button>
                  <button onClick={() => setMessages([])} className="wb-icon-btn hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <div ref={listRef} className="flex-1 overflow-auto bg-bg-secondary/10">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-text-disabled">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] border border-border-default/60 bg-bg-primary/78">
                      <Radio className="w-8 h-8 opacity-20 text-violet-500" />
                    </div>
                    <p className="text-[var(--fs-base)] font-medium">{t('mqtt.emptyTitle')}</p>
                    <p className="mt-1 text-[var(--fs-xs)]">{t('mqtt.emptyDesc')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-default/55">
                    {messages.map((msg, i) => (
                      <div key={i} className={cn("px-4 py-3 transition-colors hover:bg-bg-hover/35", msg.direction === 'out' && "bg-violet-500/[0.035]")}>
                        <div className="mb-1 flex items-center gap-2">
                          <span className={cn("rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--fs-xxs)] font-bold", msg.direction === 'out' ? "bg-violet-500/20 text-violet-600" : "bg-emerald-500/20 text-emerald-600")}>
                            {msg.direction === 'out' ? t('mqtt.sent') : t('mqtt.received')}
                          </span>
                          <span className="min-w-0 truncate text-[var(--fs-xxs)] font-mono text-accent">{msg.topic}</span>
                          <span className="ml-auto text-[var(--fs-xxs)] text-text-disabled">Q{msg.qos}</span>
                          {msg.retain && <span className="rounded-[var(--radius-sm)] bg-amber-500/10 px-1.5 py-0.5 text-[var(--fs-3xs)] text-amber-600">R</span>}
                          <span className="text-[var(--fs-xxs)] font-mono text-text-disabled">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <pre className="whitespace-pre-wrap break-all text-[var(--fs-sm)] font-mono text-text-secondary">{msg.payload}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
