// Fonte de agentes do Ops Copilot (AgentSource 'ops', ver sources/source.ts).
// Dia 1: modo fake, sem rede. Cria um agente na sala /ops-copilot e alterna atividades/status para validar a UI.
// O modo real (SSE /api/ops/events) entra depois; esta fonte é read-only e não tem terminal, mensagens nem approvals.
import type { SourceInfo } from '../../../shared/types';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import { opsFakeStep } from './fake';

const AGENT_ID = 'ops:demo';
const SESSION_ID = 'ops-demo-session';
const ROOM_PATH = '/ops-copilot';

export interface OpsSourceOptions {
  office: Office;
  /** Intervalo entre eventos fake (padrão 4 s). */
  pollMs?: number;
  now?: () => number;
}

export class OpsSource implements AgentSource {
  readonly provider = 'ops' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  private started = false;
  private readonly now: () => number;
  private readonly pollMs: number;

  constructor(private readonly opts: OpsSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.pollMs = Math.max(1_000, opts.pollMs ?? 4_000);
  }

  start(): void {
    this.started = true;
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
      this.apply(0);
    } finally {
      this.opts.office.endBoot();
    }
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.opts.office.closeMain(AGENT_ID);
  }

  sources(): SourceInfo[] {
    return [
      {
        label: 'Ops Copilot (fake)',
        provider: 'ops',
        path: 'ops://local',
        sessions: this.started ? 1 : 0,
        ok: true,
      },
    ];
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  private tick(): void {
    if (!this.started) return;
    this.index += 1;
    this.apply(this.index);
  }

  private apply(index: number): void {
    const step = opsFakeStep(index);
    if (step.status) this.opts.office.setStatus(AGENT_ID, step.status, step.waitingFor);
    if (!step.activity) return;
    this.opts.office.addActivity(
      AGENT_ID,
      {
        id: AGENT_ID + '#step:' + index,
        at: this.now(),
        ...step.activity,
      },
      true,
      { feed: index > 0 },
    );
  }
}
