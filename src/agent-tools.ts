import { validSettings, type DuelSettings } from './settings';
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
}
export interface ModelContext { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> }
interface Actions {
  status: () => unknown;
  configure: (settings: DuelSettings) => unknown;
  start: (mode: 'solo' | 'duel', name: string) => Promise<unknown>;
  next: () => unknown;
  answer: (answer: string) => Promise<unknown>;
}
const emptySchema = { type:'object',properties:{},additionalProperties:false };
function record(input: unknown, keys: string[]): Record<string,unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!keys.includes(k))) throw new Error(`Expected only ${keys.join(', ')}.`);
  return input as Record<string,unknown>;
}
export function installGameTools(context: ModelContext | undefined, actions: Actions): () => void {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    { name:'get_game_status', description:'Read the visible solo or duel status and current question. Does not reveal unsubmitted answers.', inputSchema:emptySchema, annotations:{readOnlyHint:true,untrustedContentHint:true}, execute:()=>actions.status() },
    { name:'set_game_settings', description:'Set starting HP, answer time, and increasing damage before starting a game. Updates the visible setup form; cannot change an active session.', inputSchema:{type:'object',properties:{startingHp:{type:'integer',minimum:100,maximum:10000},questionSeconds:{type:'integer',enum:[15,25,45,60,90]},damageScaling:{type:'boolean'}},required:['startingHp','questionSeconds','damageScaling'],additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:true}, execute:input=>{if(!validSettings(input))throw new Error('Invalid game settings.'); return actions.configure(input);} },
    { name:'start_game', description:'Start solo practice immediately, or start creating/joining a duel using the current setup settings. Duel mode joins the invite already open in this page, if any. Cannot replace an active session.', inputSchema:{type:'object',properties:{mode:{type:'string',enum:['solo','duel']},name:{type:'string',minLength:1,maxLength:24}},required:['mode'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{const data=record(input,['mode','name']);if(data.mode!=='solo'&&data.mode!=='duel')throw new Error('Choose solo or duel.');if(data.name!==undefined&&(typeof data.name!=='string'||!data.name.trim()||data.name.length>24))throw new Error('Name must contain 1–24 characters.');return actions.start(data.mode,typeof data.name==='string'?data.name.trim():'Player');} },
    { name:'request_next_round', description:'Press Ready in a duel lobby, result, or rematch, or advance solo practice to the next question/new run. Both duel players must be ready to continue.', inputSchema:emptySchema, annotations:{readOnlyHint:false,untrustedContentHint:true}, execute:()=>actions.next() },
    { name:'submit_game_answer', description:'Validate and submit an answer through the visible answer form. A recognized answer locks in; an unrecognized answer leaves the form editable. An empty answer skips. Cannot change an already locked answer.', inputSchema:{type:'object',properties:{answer:{type:'string',maxLength:160}},required:['answer'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>{const data=record(input,['answer']);if(typeof data.answer!=='string'||data.answer.length>160)throw new Error('Answer must be at most 160 characters.');return actions.answer(data.answer.trim());} },
  ];
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{}); } catch { /* Optional browser capability. */ }
  }
  return () => lifecycle.abort();
}
