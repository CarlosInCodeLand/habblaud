import { describe, expect, it } from 'vitest';
import { OPS_FAKE_STEPS, opsFakeStep } from './fake';

describe('ops fake source', () => {
  it('cycles through the sequence', () => {
    expect(opsFakeStep(0)).toBe(OPS_FAKE_STEPS[0]);
    expect(opsFakeStep(OPS_FAKE_STEPS.length)).toBe(OPS_FAKE_STEPS[0]);
    expect(opsFakeStep(OPS_FAKE_STEPS.length + 1)).toBe(OPS_FAKE_STEPS[1]);
  });

  it('includes a waiting approval state', () => {
    expect(OPS_FAKE_STEPS.some((s) => s.status === 'waiting' && s.waitingFor?.includes('Telegram'))).toBe(true);
  });

  it('includes tool calls and an idle turn', () => {
    expect(OPS_FAKE_STEPS.some((s) => s.activity?.tool === 'gam.read')).toBe(true);
    expect(OPS_FAKE_STEPS.some((s) => s.activity?.tool === 'sql.read')).toBe(true);
    expect(OPS_FAKE_STEPS.some((s) => s.status === 'idle')).toBe(true);
  });
});
