// Sequência fake do Ops Copilot (Dia 1): só para validar a fonte 'ops' no escritório, sem SSE e sem tocar em nada.
import type { ActivityKind, AgentStatus } from '../../../shared/types';

export interface OpsFakeStep {
  status?: AgentStatus;
  waitingFor?: string;
  activity?: {
    kind: ActivityKind;
    icon: string;
    text: string;
    detail?: string;
    tool?: string;
  };
}

export const OPS_FAKE_STEPS: readonly OpsFakeStep[] = [
  {
    status: 'working',
    activity: { kind: 'mcp', icon: '🛠️', text: 'Consultando GAM', detail: 'gam.read · rede 23325307095', tool: 'gam.read' },
  },
  {
    status: 'working',
    activity: { kind: 'run', icon: '🗄️', text: 'Rodando SQL read-only', detail: 'sql.read · sync_status', tool: 'sql.read' },
  },
  {
    status: 'waiting',
    waitingFor: 'aprovar no Telegram',
    activity: { kind: 'wait', icon: '✋', text: 'Esperando aprovação no Telegram', tool: 'ops.approval' },
  },
  {
    status: 'working',
    activity: { kind: 'edit', icon: '📝', text: 'Atualizando card no Todoist', detail: 'todoist.write · projeto ops-copilot', tool: 'todoist.write' },
  },
  {
    status: 'working',
    activity: { kind: 'mcp', icon: '📊', text: 'Consultando Meta', detail: 'meta.read · conta acuriosa', tool: 'meta.read' },
  },
  {
    status: 'idle',
    activity: { kind: 'done', icon: '✅', text: 'Turno concluído' },
  },
];

export function opsFakeStep(index: number): OpsFakeStep {
  return OPS_FAKE_STEPS[((index % OPS_FAKE_STEPS.length) + OPS_FAKE_STEPS.length) % OPS_FAKE_STEPS.length];
}
