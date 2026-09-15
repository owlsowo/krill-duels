import { describe, expect, it, vi } from 'vitest';
import { installGameTools, type ModelContext } from '../src/agent-tools';
import { DEFAULT_SETTINGS } from '../src/settings';

describe('optional agent tool adapter', () => {
  it('validates inputs, invokes shared game actions, returns updated status, and cleans up', async () => {
    const registered: Parameters<ModelContext['registerTool']>[0][] = [];
    const signals: AbortSignal[] = [];
    let phase = 'home';
    const actions = {
      status:()=>({phase}), configure:vi.fn(settings=>settings),
      start:vi.fn(async (_mode:string,_name:string)=>{phase='connecting';return{phase};}),
      next:vi.fn(()=>({requested:true})), answer:vi.fn(async(answer:string)=>({submitted:answer})),
    };
    const dispose = installGameTools({registerTool:(tool,options)=>{registered.push(tool);signals.push(options.signal);}},actions);
    expect(registered.map(t=>t.name)).toEqual(['get_game_status','set_game_settings','start_game','request_next_round','submit_game_answer']);
    expect(registered[0].annotations.readOnlyHint).toBe(true);
    expect(registered[1].execute(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(()=>registered[1].execute({...DEFAULT_SETTINGS,startingHp:Infinity})).toThrow();
    expect(await registered[2].execute({mode:'duel',name:' Friend '})).toEqual({phase:'connecting'});
    expect(actions.start).toHaveBeenCalledWith('duel','Friend');
    expect(registered[0].execute({})).toEqual({phase:'connecting'});
    expect(registered[3].execute({})).toEqual({requested:true});
    expect(await registered[4].execute({answer:'Texas'})).toEqual({submitted:'Texas'});
    expect(()=>registered[4].execute({answer:[] })).toThrow();
    expect(()=>registered[2].execute({mode:'bot'})).toThrow();
    expect(()=>registered[2].execute({mode:'solo',room:'spoof'})).toThrow();
    expect(actions.answer).toHaveBeenCalledTimes(1);
    dispose();expect(signals.every(signal=>signal.aborted)).toBe(true);
  });
  it('does not require browser support',()=>{
    expect(()=>installGameTools(undefined,{status:()=>null,configure:()=>null,start:async()=>null,next:()=>null,answer:async()=>null})()).not.toThrow();
  });
});
