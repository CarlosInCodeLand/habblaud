// Fonte de agentes do Ops Copilot (AgentSource 'ops', ver sources/source.ts).
// - HABBLAUD_OPS_URL: consome GET /api/ops/events (SSE read-only) do Ops API.
// - HABBLAUD_OPS_FAKE=1: sequência fake para demo, sem rede.
// Nunca tem terminal, mensagens, PTY ou approvals: o escritório só observa.
import type { ActivityKind, AgentStatus, SourceInfo } from '../../../shared/types';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import { opsFakeStep } from './fake';

export const OPS_FAKE_AGENT_ID = 'demo:ops:demo';
export const OPS_FAKE_SESSION_ID = 'demo:ops-demo-session';
export const OPS_FAKE_ROOM_PATH = 'demo:/ops-copilot';

const AGENT_ID = OPS_FAKE_AGENT_ID;
const SESSION_ID = OPS_FAKE_SESSION_ID;
const ROOM_PATH = OPS_FAKE_ROOM_PATH;
const RECONNECT_MS = 3_000;

/** Especialistas do Ops que aparecem no escritório mesmo sem um run ativo. */
export const OPS_ROSTER = [
  { key: 'chief', role: 'Chief of Staff' },
  { key: 'sync-guardian', role: 'Sync Guardian' },
  { key: 'project-closer', role: 'Project Closer' },
  { key: 'data-detective', role: 'Data Detective' },
  { key: 'report-writer', role: 'Report Writer' },
  { key: 'traffic-soc', role: 'Traffic SOC' },
  { key: 'deploy-engineer', role: 'Deploy/Site Engineer' },
] as const;

export interface OpsSourceOptions {
  office: Office;
  /** URL SSE (ex.: http://127.0.0.1:8787/api/ops/events). Sem ela, usa o fake. */
  url?: string;
  /** Bearer opcional; fica só no servidor. */
  token?: string;
  /** Intervalo entre eventos fake (padrão 4 s). */
  pollMs?: number;
  /** Mostra o roster de especialistas idle (padrão true; HABBLAUD_OPS_ROSTER=0 desliga). */
  roster?: boolean;
  now?: () => number;
  fetcher?: typeof fetch;
}

export interface OpsEvent {
  id: string;
  type: string;
  at: string;
  version: number;
  payload: Record<string, unknown>;
}

export class OpsSource implements AgentSource {
  readonly provider = 'ops' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private index = 0;
  private started = false;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly agents = new Map<string, string>();
  private readonly rosterAgents = new Map<string, string>();
  private readonly rosterEnabled: boolean;
  private readonly seen = new Set<string>();
  private readonly fetcher: typeof fetch;

  constructor(private readonly opts: OpsSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.pollMs = Math.max(1_000, opts.pollMs ?? 4_000);
    this.rosterEnabled = opts.roster ?? process.env.HABBLAUD_OPS_ROSTER !== '0';
    this.fetcher = opts.fetcher ?? fetch;
  }

  start(): void {
    this.started = true;
    if (this.opts.url) {
      if (this.rosterEnabled) this.addRoster();
      void this.connect();
      return;
    }
    this.opts.office.beginBoot();
    try {
      this.opts.office.addMain({
        id: AGENT_ID,
        provider: 'ops',
        account: 'ops',
        sessionId: SESSION_ID,
        cwd: ROOM_PATH,
        role: 'Agente Ops (fake)',
        startedAt: this.now(),
        status: 'working',
      });
      this.applyFake(0);
    } finally {
      this.opts.office.endBoot();
    }
    this.timer = setInterval(() => this.tickFake(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.started = false;
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.timer = null;
    this.reconnect = null;
    if (this.opts.url) {
      for (const id of this.rosterAgents.values()) this.opts.office.closeMain(id);
      this.rosterAgents.clear();
      for (const id of this.agents.values()) this.opts.office.closeMain(id);
      this.agents.clear();
    } else {
      this.opts.office.closeMain(AGENT_ID);
    }
  }

  sources(): SourceInfo[] {
    return [
      {
        label: this.opts.url ? 'Ops Copilot (SSE)' : 'Ops Copilot (fake)',
        provider: 'ops',
        path: this.opts.url ?? 'ops://local',
        sessions: this.opts.url ? this.agents.size + this.rosterAgents.size : this.started ? 1 : 0,
        ok: true,
      },
    ];
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /** Conecta e reconecta enquanto a fonte estiver ligada. */
  private async connect(): Promise<void> {
    while (this.started) {
      try {
        this.abort = new AbortController();
        const response = await this.fetcher(this.opts.url!, {
          headers: {
            accept: 'text/event-stream',
            ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
          },
          signal: this.abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        await this.read(response.body);
        if (!this.started) return;
        await this.sleep(RECONNECT_MS);
      } catch {
        if (!this.started) return;
        await this.sleep(RECONNECT_MS);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (this.started) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBlocks(buffer);
      buffer = parsed.rest;
      for (const block of parsed.blocks) {
        const event = parseOpsEvent(block);
        if (event) this.applyEvent(event);
      }
    }
  }

  private applyEvent(event: OpsEvent): void {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    const at = Number.isFinite(Date.parse(event.at)) ? Date.parse(event.at) : this.now();
    const payload = event.payload;
    const runId = str(payload.runId) ?? 'ops';
    const id = this.ensureAgent(runId, payload, at);

    if (event.type === 'run.started') {
      this.opts.office.setStatus(id, statusOf(payload.status));
      return;
    }
    if (event.type === 'run.status') {
      this.opts.office.setStatus(
        id,
        statusOf(payload.status),
        str(payload.waitingFor),
      );
      return;
    }
    if (event.type === 'run.finished') {
      this.opts.office.addActivity(id, {
        id: `${id}#${event.id}`,
        kind: 'done',
        icon: '✅',
        text: 'Run concluído',
        at,
      }, true);
      this.opts.office.closeMain(id);
      return;
    }
    if (event.type === 'step.started') {
      const tool = str(payload.tool) ?? 'step';
      this.opts.office.addActivity(id, {
        id: `${id}#${event.id}`,
        kind: toolKind(tool),
        icon: iconFor(tool),
        text: clip(str(payload.label) ?? tool, 60),
        ...(str(payload.detail) ? { detail: clip(str(payload.detail)!, 300) } : {}),
        tool,
        at,
      }, true);
      return;
    }
    if (event.type === 'step.finished') {
      const failed = payload.status === 'failed' || payload.status === 'error';
      this.opts.office.addActivity(id, {
        id: `${id}#${event.id}`,
        kind: failed ? 'error' : 'done',
        icon: failed ? '⚠️' : '✅',
        text: failed ? 'Step falhou' : 'Step concluído',
        ...(typeof payload.error === 'string' ? { detail: clip(payload.error, 300) } : {}),
        ...(failed ? { error: true } : {}),
        at,
      }, true);
      return;
    }
    if (event.type === 'approval.requested') {
      const action = clip(str(payload.action) ?? 'ação pendente', 80);
      this.opts.office.setStatus(id, 'waiting', 'aprovar no Telegram');
      this.opts.office.addActivity(id, {
        id: `${id}#${event.id}`,
        kind: 'wait',
        icon: '✋',
        text: `Aprovar: ${action}`,
        ...(str(payload.telegramUrl) ? { detail: str(payload.telegramUrl)! } : {}),
        tool: 'ops.approval',
        at,
      }, true);
      return;
    }
    if (event.type === 'approval.decided') {
      this.opts.office.setStatus(id, 'working');
      this.opts.office.addActivity(id, {
        id: `${id}#${event.id}`,
        kind: 'done',
        icon: '✅',
        text: 'Aprovação decidida no Telegram',
        at,
      }, true);
    }
  }

  private addRoster(): void {
    const now = this.now();
    for (const item of OPS_ROSTER) {
      const id = `ops:specialist:${item.key}`;
      this.rosterAgents.set(item.key, id);
      if (this.opts.office.has(id)) continue;
      this.opts.office.addMain({
        id,
        provider: 'ops',
        account: 'ops',
        sessionId: `specialist:${item.key}`,
        cwd: 'ops/specialists',
        role: item.role,
        startedAt: now,
        status: 'idle',
      });
    }
  }

  private ensureAgent(runId: string, payload: Record<string, unknown>, at: number): string {
    const existing = this.agents.get(runId);
    if (existing && this.opts.office.has(existing)) return existing;
    const project = clip(str(payload.project) ?? 'Ops Copilot', 60);
    const id = `ops:${runId}`;
    this.agents.set(runId, id);
    if (!this.opts.office.has(id)) {
      this.opts.office.addMain({
        id,
        provider: 'ops',
        account: 'ops',
        sessionId: runId,
        cwd: `ops/${project}`,
        role: `Ops · ${project}`,
        startedAt: at,
        status: statusOf(payload.status),
      });
    }
    return id;
  }

  private tickFake(): void {
    if (!this.started) return;
    this.index += 1;
    this.applyFake(this.index);
  }

  private applyFake(index: number): void {
    const step = opsFakeStep(index);
    if (step.status) this.opts.office.setStatus(AGENT_ID, step.status, step.waitingFor);
    if (!step.activity) return;
    this.opts.office.addActivity(
      AGENT_ID,
      { id: AGENT_ID + '#step:' + index, at: this.now(), ...step.activity },
      true,
      { feed: index > 0 },
    );
  }
}

export function parseSseBlocks(input: string): { blocks: string[]; rest: string } {
  const parts = input.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  return { blocks: parts, rest };
}

export function parseOpsEvent(block: string): OpsEvent | undefined {
  let type = '';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return undefined;
  try {
    const parsed = JSON.parse(data.join('\n')) as OpsEvent;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return undefined;
    return { ...parsed, type: type || parsed.type };
  } catch {
    return undefined;
  }
}

function statusOf(value: unknown): AgentStatus {
  switch (value) {
    case 'working': return 'working';
    case 'waiting': return 'waiting';
    case 'done': return 'done';
    case 'offline': return 'offline';
    case 'shell': return 'shell';
    default: return 'idle';
  }
}

function toolKind(tool: string): ActivityKind {
  if (/sql|read|query/i.test(tool)) return 'mcp';
  if (/deploy|shell|exec/i.test(tool)) return 'run';
  if (/approval|wait/i.test(tool)) return 'wait';
  return 'mcp';
}

function iconFor(tool: string): string {
  if (/sql|read|query/i.test(tool)) return '🗄️';
  if (/deploy|shell|exec/i.test(tool)) return '🛠️';
  return '🤖';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1) + '…';
}
