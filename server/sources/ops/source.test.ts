import { describe, expect, it } from 'vitest';
import { isDemoId } from '../../../shared/timeline';
import { OPS_FAKE_AGENT_ID, OPS_FAKE_ROOM_PATH } from './source';
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

  it('never projects fake ops data to Habblaud World (demo: prefix)', () => {
    expect(isDemoId(OPS_FAKE_AGENT_ID)).toBe(true);
    expect(isDemoId(OPS_FAKE_ROOM_PATH)).toBe(true);
  });
});

import { OpsSource, parseOpsEvent, parseSseBlocks } from './source';

describe('ops SSE source', () => {
  it('parseia blocos SSE e envelope', () => {
    const { blocks, rest } = parseSseBlocks(
      'id: 1\nevent: run.started\ndata: {"id":"1","type":"run.started","at":"2026-10-22T12:00:00Z","version":1,"payload":{"runId":"r1","project":"Ops","status":"working"}}\n\npartial',
    );
    expect(rest).toBe('partial');
    expect(blocks).toHaveLength(1);
    const event = parseOpsEvent(blocks[0]!);
    expect(event?.type).toBe('run.started');
    expect(event?.payload.runId).toBe('r1');
  });

  it('mostra o roster de especialistas mesmo sem runs', async () => {
    const adds: string[] = [];
    const office = {
      has: (id: string) => adds.includes(id),
      addMain: (input: { id: string }) => { adds.push(input.id); },
      setStatus: () => {},
      addActivity: () => {},
      closeMain: () => {},
      beginBoot: () => {},
      endBoot: () => {},
    };
    const source = new OpsSource({
      office: office as never,
      url: 'http://ops.test/api/ops/events',
      fetcher: async () => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
    });
    source.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adds).toEqual(expect.arrayContaining([
      'ops:specialist:chief',
      'ops:specialist:sync-guardian',
      'ops:specialist:project-closer',
      'ops:specialist:data-detective',
      'ops:specialist:report-writer',
      'ops:specialist:traffic-soc',
      'ops:specialist:deploy-engineer',
    ]));
    expect(source.sources()[0]?.sessions).toBe(7);
    source.stop();
  });

  it('mapeia run de playbook para o especialista do roster', async () => {
    const adds: string[] = [];
    const statuses: string[] = [];
    const office = {
      has: (id: string) => adds.includes(id),
      addMain: (input: { id: string }) => { adds.push(input.id); },
      setStatus: (id: string, status: string) => { statuses.push(`${id}:${status}`); },
      addActivity: () => {},
      closeMain: () => {},
      beginBoot: () => {},
      endBoot: () => {},
    };
    const sse = 'event: run.started\ndata: {"id":"e1","type":"run.started","at":"2026-10-22T12:00:00Z","version":1,"payload":{"runId":"r1","project":"Sync Guardian","playbook":"sync_guardian","status":"working"}}\n\n';
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const source = new OpsSource({
      office: office as never,
      url: 'http://ops.test/api/ops/events',
      fetcher: async () => new Response(body, { status: 200 }),
    });
    source.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adds).toContain('ops:specialist:sync-guardian');
    expect(adds).not.toContain('ops:r1');
    expect(statuses).toContain('ops:specialist:sync-guardian:working');
    source.stop();
  });

  it('projeta run/step/approval no Office', async () => {
    const calls = { adds: [] as string[], statuses: [] as string[], activities: [] as string[], closed: [] as string[] };
    const office = {
      has: (id: string) => calls.adds.includes(id),
      addMain: (input: { id: string }) => { calls.adds.push(input.id); },
      setStatus: (id: string, status: string) => { calls.statuses.push(`${id}:${status}`); },
      addActivity: (_id: string, activity: { id: string }) => { calls.activities.push(activity.id); },
      closeMain: (id: string) => { calls.closed.push(id); },
      beginBoot: () => {},
      endBoot: () => {},
    };
    const sse = [
      'event: run.started',
      'data: {"id":"e1","type":"run.started","at":"2026-10-22T12:00:00Z","version":1,"payload":{"runId":"r1","project":"Ops","status":"working"}}',
      '',
      'event: step.started',
      'data: {"id":"e2","type":"step.started","at":"2026-10-22T12:00:01Z","version":1,"payload":{"runId":"r1","project":"Ops","stepId":"s1","tool":"sql.read","label":"Consultando"}}',
      '',
      'event: approval.requested',
      'data: {"id":"e3","type":"approval.requested","at":"2026-10-22T12:00:02Z","version":1,"payload":{"runId":"r1","project":"Ops","approvalId":"a1","action":"deploy","risk":"high","telegramUrl":"https://t.me/AudmetrixBot"}}',
      '',
      'event: run.finished',
      'data: {"id":"e4","type":"run.finished","at":"2026-10-22T12:00:03Z","version":1,"payload":{"runId":"r1","project":"Ops","status":"done"}}',
      '',
    ].join('\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const source = new OpsSource({
      office: office as never,
      url: 'http://ops.test/api/ops/events',
      fetcher: async () => new Response(body, { status: 200 }),
    });
    source.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.stop();
    expect(calls.adds).toContain('ops:r1');
    expect(calls.statuses).toContain('ops:r1:working');
    expect(calls.statuses).toContain('ops:r1:waiting');
    expect(calls.activities.some((id) => id.includes('e2'))).toBe(true);
    expect(calls.activities.some((id) => id.includes('e3'))).toBe(true);
    expect(calls.closed).toContain('ops:r1');
  });
});
