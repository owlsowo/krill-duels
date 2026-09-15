import { describe, expect, it, vi } from 'vitest';
import { installGameTools, type ModelContext } from '../src/agent-tools';

describe('optional agent tool adapter', () => {
  it('registers actions, validates inputs, calls the shared actions, and cleans up', async () => {
    const registered: Parameters<ModelContext['registerTool']>[0][] = [];
    const signals: AbortSignal[] = [];
    let phase = 'home';
    const actions = {
      status: () => ({phase}),
      start: vi.fn(async (_name: string) => { phase = 'connecting'; return {phase}; }),
      ready: vi.fn(() => ({ requested:true })),
      answer: vi.fn(async (answer: string) => ({submitted:answer})),
    };
    const dispose = installGameTools({registerTool:(tool, options)=> { registered.push(tool); signals.push(options.signal); }},actions);
    expect(registered.map(t=>t.name)).toEqual(['get_duel_status','request_duel_ready','start_duel_connection','submit_duel_answer']);
    expect(registered[0].annotations.readOnlyHint).toBe(true);
    expect(registered[2].annotations.readOnlyHint).toBe(false);
    expect(registered[2].inputSchema).toMatchObject({required:['name'],additionalProperties:false});
    expect(await registered[2].execute({name:' Friend '})).toEqual({phase:'connecting'});
    expect(actions.start).toHaveBeenCalledWith('Friend');
    expect(registered[0].execute({})).toEqual({phase:'connecting'});
    expect(registered[1].execute({})).toEqual({requested:true});
    expect(await registered[3].execute({answer:'Texas'})).toEqual({submitted:'Texas'});
    expect(()=>registered[3].execute({answer:''})).toThrow();
    expect(()=>registered[2].execute({name:'Friend',room:'spoof'})).toThrow();
    expect(actions.answer).toHaveBeenCalledTimes(1);
    dispose(); expect(signals.every(signal=>signal.aborted)).toBe(true);
  });
  it('does not require browser support', () => {
    expect(()=>installGameTools(undefined,{status:()=>null,start:async()=>null,ready:()=>null,answer:async()=>null})()).not.toThrow();
  });
});
