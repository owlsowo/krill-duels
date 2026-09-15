interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
}
export interface ModelContext { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> }
interface Actions { status: () => unknown; start: (name: string) => Promise<unknown>; ready: () => unknown; answer: (answer: string) => Promise<unknown> }
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
function field(input: unknown, key: string, maximum: number): string {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== key)) throw new Error(`Expected only ${key}.`);
  const value = (input as Record<string,unknown>)[key];
  if (typeof value !== 'string' || value.length > maximum || !value.trim()) throw new Error(`${key} must contain 1–${maximum} characters.`);
  return value.trim();
}
export function installGameTools(context: ModelContext | undefined, actions: Actions): () => void {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    { name:'get_duel_status', description:'Read the current visible duel status and question. Does not reveal unsubmitted answers.', inputSchema:emptySchema, annotations:{readOnlyHint:true,untrustedContentHint:true}, execute: () => actions.status() },
    { name:'request_duel_ready', description:'Press Ready for the current lobby, next round, or rematch. Both players must be ready to continue; returns the visible status after sending the request.', inputSchema:emptySchema, annotations:{readOnlyHint:false,untrustedContentHint:true}, execute: () => actions.ready() },
    { name:'start_duel_connection', description:'Start creating a room, or joining the invite already open in this page, using the same name form as the visible interface. Returns the connection status; wait for the lobby before playing.', inputSchema:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:24}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute: input => actions.start(field(input,'name',24)) },
    { name:'submit_duel_answer', description:'Validate and send an answer to the current question using the visible answer form. A recognized answer locks in; an unrecognized answer leaves the form editable. Cannot change an already locked answer.', inputSchema:{type:'object',properties:{answer:{type:'string',minLength:1,maxLength:160}},required:['answer'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute: input => actions.answer(field(input,'answer',160)) },
  ];
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(() => {}); } catch { /* Optional browser capability. */ }
  }
  return () => lifecycle.abort();
}
