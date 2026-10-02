import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Standalone, local-only analysis. Never evaluates commands found in a log.
// Generated artifacts retain private paths, identifiers, and partial evidence.
// Keep them under ignored output/; scrubbing is not anonymization for publication.
const args=process.argv.slice(2);
const opt=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const out=path.resolve(opt('--out','output/rework-analysis'));
const cutoff=opt('--before','2026-10-02T00:00:00.000Z');
const seed='tracelens-rework-2026-10-02-v1';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const load=n=>JSON.parse(fs.readFileSync(path.join(out,n+'.json'),'utf8'));
const save=(n,v)=>fs.writeFileSync(path.join(out,n+'.json'),JSON.stringify(v,null,2));
const str=v=>typeof v==='string'?v:Array.isArray(v)?v.map(x=>x.text||'').join('\n'):JSON.stringify(v??'');
const canon=(p,cwd='')=>path.win32.normalize(path.win32.isAbsolute(p)?p:path.win32.join(cwd,p)).replaceAll('\\','/').toLowerCase();
const normalized=s=>s.trim().replace(/\r\n/g,'\n').replace(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[ \t]+/g,m=>/^[ \t]+$/.test(m)?' ':m);
const plan={version:1,seed,cutoff,thresholds:{tokenShare:0.10,top3CauseShare:0.50,actionableCauses:1},
 rules:{a:'Same normalized full shell command + cwd, >=2 consecutive objectively failed attempts within one turn. Other intervening commands allowed; success/unknown breaks chain. Nonzero exit alone is insufficient.',
 b:'Same explicit file read >=3 times in one session without an observed intervening write, restore, or broad uncertain-write barrier. Reads must use identical normalized command (same range/filter); only third and later count as excess.',
 c:'Same file patched successfully >=3 times within one turn; only third and later are candidate excess. Iterative implementation is NOT automatically rework. No unsupported claim of automatic undo detection.',
 d:'Same running process/cell polled >=3 times consecutively with empty payload and no terminal status; only third and later count. Necessary waiting is NOT automatically waste.'},
 attribution:'Use response_id-deduplicated token_usage_record when present in a turn; otherwise unique positive cumulative token_count deltas. Initial/reset cumulative history excluded using last_token_usage. Input+output includes cached input once; reasoning is not added twice. Attribute whole measured generation only when exactly one emitted operation can be linked; ambiguous usage stays unknown. These are associated tokens, not counterfactual avoidable costs.',
 overlaps:'Deduplicate operation IDs; one primary signal per operation, priority a,c,b,d. Per-signal descriptive totals may overlap; overall union and estimator never do.',
 sampling:'Deterministic seeded hash sample of 10 episodes per signal (or all if fewer). Review unnecessary repeated work, not merely mechanical rule match. confirmed/false_positive/uncertain; uncertain not silently confirmed.',
 estimator:'Stratified expansion: per signal N/n times sampled confirmed primary-associated tokens. Unknown verdict/tokens not zero: also report uncertainty counts and no numerical estimate for unmeasured part. Unknown causes stay in denominator and are excluded from explained top-3. Thresholds evaluated on this declared estimate, with raw candidate proxy reported separately; missing manual review means criterion not demonstrated.',
 limitations:'Single user, correlated delegated agents, observational comparison, no token saving versus direct-log baseline measured.'};

function literal(n,vars){
 if(!n)return undefined;
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
 if(ts.isNumericLiteral(n))return Number(n.text);
 if(ts.isParenthesizedExpression(n))return literal(n.expression,vars);
 if(ts.isIdentifier(n))return vars.get(n.text);
 if(ts.isTemplateExpression(n)){let v=n.head.text;for(const x of n.templateSpans){const a=literal(x.expression,vars);if(a===undefined)return;v+=a+x.literal.text;}return v;}
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=literal(n.left,vars),b=literal(n.right,vars);if(a!==undefined&&b!==undefined)return a+b;}
 if(ts.isObjectLiteralExpression(n))return Object.fromEntries(n.properties.filter(p=>ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p)).map(p=>[p.name.text,ts.isShorthandPropertyAssignment(p)?vars.get(p.name.text):literal(p.initializer,vars)]));
}
function extract(name,input){
 if(/(?:exec_command|shell_command|write_stdin|apply_patch)$/.test(name)||name==='wait'){
  let a=input;try{a=JSON.parse(input);}catch{}return [{name,args:a}];
 }
 if(!/^(?:functions\.)?exec$/.test(name))return [];
 const sf=ts.createSourceFile('record.js',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),vars=new Map(),ops=[];
 const visit=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name))vars.set(n.name.text,literal(n.initializer,vars));
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(sf)==='tools'&&/(?:exec_command|shell_command|write_stdin|apply_patch)$/.test(n.expression.name.text))ops.push({name:n.expression.name.text,args:literal(n.arguments[0],vars)});
 ts.forEachChild(n,visit);};visit(sf);return ops;
}
function packets(s){const a=[];const walk=v=>{if(!v||typeof v!=='object')return;if('output'in v&&('exit_code'in v||'session_id'in v||'chunk_id'in v)){a.push(v);return;}for(const x of Object.values(v))if(typeof x==='object')walk(x);};for(const l of s.split('\n'))try{walk(JSON.parse(l));}catch{}return a;}
function decoded(s){const exit=[...s.matchAll(/(?:Process exited with code|Exit code:)\s*(-?\d+)/gi)].at(-1);const sid=/SESSION_ID=(\d+)|session ID[: ]+(\d+)|Script running with cell ID (\S+)/i.exec(s);return {output:s.replace(/^Script (?:completed|running)[\s\S]*?Output:\s*/,'').trim(),exit_code:exit?Number(exit[1]):undefined,session_id:sid?.slice(1).find(Boolean)};}
const errorRules=[
 ['permission',/\b(?:EACCES|EPERM)\b|access (?:is )?denied|permission denied|拒绝访问|权限不足/i],
 ['missing_path',/\bENOENT\b|cannot find path|cannot find the path|path .* does not exist|系统找不到指定的(?:文件|路径)|no such file or directory|could not find.*(?:file|path)/i],
 ['missing_dependency',/cannot find module|module not found|ModuleNotFoundError|not recognized as (?:an internal|the name)|command not found|executable doesn't exist|playwright install|找不到.*模块/i],
 ['test_entry',/no test files found|no tests found|unknown (?:command|option)|missing script|unknown script/i],
 ['network',/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND)\b|failed to fetch|network.*(?:error|unreachable)|SSL certificate|certificate verify failed/i],
 ['resource_lock',/\b(?:EBUSY|ENOSPC)\b|file.*(?:being used|locked)|out of memory|heap out of memory|端口.*占用|address already in use/i],
 ['syntax_api',/SyntaxError|TypeError|ReferenceError|ParserError|cannot overwrite variable|not a function|unexpected token/i],
 ['type_compile',/error TS\d+|error\[E\d+\]|compilation failed|could not compile|unresolved reference/i],
 ['test_assertion',/AssertionError|assertion.*failed|expected:.*received:|Test Files\s+\d+ failed|Tests\s+\d+ failed|FAIL\s{2}|# fail [1-9]|test result: FAILED/i],
 ['patch_context',/Failed to find expected lines|apply_patch verification failed|invalid patch|patch failed/i],
 ['timeout',/timed out|timeout expired|time limit exceeded/i]
];
function causeOf(s){return errorRules.find(([,r])=>r.test(s))?.[0]||'unknown';}
function failed(cmd,receipt){
 if(receipt?.exit_code===0)return false;
 if(/^\s*(?:rg|grep|git\s+diff)\b/i.test(cmd)&&!/;|\n/.test(cmd))return false;
 return receipt?.exit_code!==undefined&&receipt.exit_code!==0&&causeOf(receipt.output||'')!=='unknown';
}
function readFiles(cmd,cwd){
 if(/;|\n|\|.*(?:Set-Content|Out-File)/i.test(cmd))return [];
 const m=/^\s*(?:Get-Content(?:\s+-LiteralPath|\s+-Path|\s+-Raw)?|cat|type)\s+(.+)$/i.exec(cmd);
 if(!m)return [];
 const tokens=m[1].match(/"[^"]*"|'[^']*'|\S+/g)||[];
 const p=tokens.find(t=>!t.startsWith('-')&&!/^\d+$/.test(t)&&t!=='|');
 if(!p||/[$*?{}]/.test(p))return [];
 return [canon(p.replace(/^['"]|['"]$/g,''),cwd)];
}
function scrub(s){return String(s).replace(/https?:\/\/\S+/gi,'[URL]').replace(/\b(?:sk-|ghp_|github_pat_|hf_|xox[baprs]-)[\w-]{16,}/g,'[SECRET]').replace(/\b(?:Bearer|Basic)\s+\S+/gi,'[AUTH]').replace(/((?:token|password|secret|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]').replace(/[A-Za-z0-9_+/=-]{65,}/g,'[LONG_VALUE]').replace(/C:[\\/]Users[\\/][^\\/\s]+/gi,'[HOME]');}
const safeCommand=s=>scrub(s).slice(0,420);

async function scan(){
 fs.mkdirSync(out,{recursive:true});
 save('pre-registration',plan);
 const roots=[opt('--sessions-root',path.join(os.homedir(),'.codex','sessions')),opt('--archive-root',path.join(os.homedir(),'.codex','archived_sessions'))];
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.jsonl')?[path.join(d,e.name)]:[]);
 const fixedManifest=opt('--manifest',null);
 const inventory=fixedManifest?JSON.parse(fs.readFileSync(fixedManifest,'utf8')):roots.filter(fs.existsSync).flatMap(walk).sort().map(file=>({file,bytes:fs.statSync(file).size}));
 for(const row of inventory)assert.ok(fs.statSync(row.file).size>=row.bytes,'Snapshot file shrank or disappeared; do not silently change cohort');
 save('manifest',inventory);
 const stats={files:inventory.length,bytes:inventory.reduce((s,x)=>s+x.bytes,0),lines:0,invalid:0,afterCutoff:0,unresolvedOperations:0,ambiguousReceipts:0,duplicateCalls:0,duplicateUsage:0,legacyResets:0,recordTurnsWithLegacy:0};
 const globalCalls=new Map(),usageMap=new Map(),sessionInfo=new Map();
 for(let fi=0;fi<inventory.length;fi++){
  const {file,bytes}=inventory[fi];let session=path.basename(file),cwd='',turn='legacy',line=0,prevTotal,prevUsageLine=0;
  const calls=[],byId=new Map(),receipts=new Map(),usages=[],legacy=[],sinceUsage=[];
  for await(const raw of readline.createInterface({input:fs.createReadStream(file,{end:bytes-1}),crlfDelay:Infinity})){
   line++;stats.lines++;let x;try{x=JSON.parse(raw);}catch{stats.invalid++;continue;}
   if(x.timestamp>=cutoff){stats.afterCutoff++;continue;}const p=x.payload||{};
   if(x.type==='session_meta'){if(!sessionInfo.has(file)){session=p.id||session;cwd=p.cwd||'';sessionInfo.set(file,{session,cwd:canon(cwd),source:typeof p.source==='string'?p.source:'subagent'});}continue;}
   if(x.type==='turn_context'){turn=p.turn_id||turn;cwd=p.cwd||cwd;continue;}
   if(x.type==='event_msg'&&p.type==='task_started'){turn=p.turn_id||turn;continue;}
   if(x.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)){
    const input=p.arguments||p.input||'',name=p.namespace?`${p.namespace}.${p.name}`:p.name;
    const id=hash([p.call_id,x.timestamp,input].join('|'));
    const c={id,callId:p.call_id,name,input,ops:extract(name,input),file,line,ts:x.timestamp,ms:Date.parse(x.timestamp),session,cwd:canon(cwd),turn:p.internal_chat_message_metadata_passthrough?.turn_id||turn};
    calls.push(c);byId.set(p.call_id,c);sinceUsage.push(c);continue;
   }
   if(x.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)){
    const s=str(p.output);receipts.set(p.call_id,{text:s.length>32000?s.slice(0,16000)+'\n[TRUNCATED]\n'+s.slice(-16000):s,line,ts:x.timestamp});continue;
   }
   if(x.type==='event_msg'&&p.type==='token_count'&&p.info){
    const total=p.info.total_token_usage?.total_tokens,last=p.info.last_token_usage?.total_tokens;
    if(Number.isFinite(total)&&total!==prevTotal){
     const delta=prevTotal===undefined||total<prevTotal?last:total-prevTotal;if(total<prevTotal)stats.legacyResets++;
     if(Number.isFinite(delta)&&delta>0)legacy.push({id:hash('legacy|'+x.timestamp+'|'+JSON.stringify(p.info.total_token_usage)),tokens:delta,cached:null,line,ts:x.timestamp,turn,session,call:sinceUsage.length===1?sinceUsage[0].id:null,fromLine:prevUsageLine,source:'legacy'});
     prevTotal=total;prevUsageLine=line;sinceUsage.length=0;
    }continue;
   }
   if(x.type==='token_usage_record'&&p.usage){
    const tokens=p.usage.total_tokens??(p.usage.input_tokens+p.usage.output_tokens);
    if(Number.isFinite(tokens))usages.push({id:p.response_id||hash('record|'+raw),tokens,cached:p.usage.cached_input_tokens??null,line,ts:x.timestamp,turn:p.turn_id||turn,session:p.thread_id||session,source:'record'});
   }
  }
  // Usage records take precedence per turn, never add both cumulative and response accounting.
  const recordTurns=new Set(usages.map(u=>u.turn));stats.recordTurnsWithLegacy+=new Set(legacy.filter(u=>recordTurns.has(u.turn)).map(u=>u.turn)).size;
  for(const u of usages){
   const prev=usages.filter(v=>v.turn===u.turn&&v.line<u.line).at(-1)?.line||0;
   const eligible=calls.filter(c=>c.turn===u.turn&&c.line>prev&&c.line<u.line);
   u.call=eligible.length===1?eligible[0].id:null;
  }
  for(const u of [...usages,...legacy.filter(u=>!recordTurns.has(u.turn))]){
   if(usageMap.has(u.id)){stats.duplicateUsage++;continue;}usageMap.set(u.id,{...u,file});
  }
  for(const c of calls){
   const r=receipts.get(c.callId);if(r){c.receipt=r;c.receiptLine=r.line;}
   if(globalCalls.has(c.id)){stats.duplicateCalls++;if(!globalCalls.get(c.id).receipt&&r)globalCalls.set(c.id,c);continue;}
   globalCalls.set(c.id,c);
  }
  if((fi+1)%100===0)console.log(`Scanned ${fi+1}/${inventory.length}`);
 }
 const ops=[];
 for(const c of globalCalls.values()){
  let rs=packets(c.receipt?.text||'');const relevant=c.ops.filter(o=>!/apply_patch/.test(o.name));
  const ambiguous=relevant.length>1; if(ambiguous)stats.ambiguousReceipts++;
  for(let i=0;i<c.ops.length;i++){
   const o=c.ops[i],cmd=o.args?.cmd||o.args?.command;
   if(o.args===undefined){stats.unresolvedOperations++;continue;}
   const receipt=ambiguous?null:rs.length===1?rs[0]:decoded(c.receipt?.text||'');
   const r={id:`${c.id}:${i}`,call:c.id,session:c.session,turn:c.turn,file:c.file,line:c.line,receiptLine:c.receiptLine,ts:c.ts,ms:c.ms,end:Date.parse(c.receipt?.ts),cwd:canon(o.args?.workdir||c.cwd),name:o.name,ambiguous};
   if(/apply_patch/.test(o.name)){
    const patch=typeof o.args==='string'?o.args:'';
    r.kind='edit';r.paths=[...new Set([...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map(m=>canon(m[1].trim(),r.cwd)))];
    r.signature=hash(patch);r.patchSummary=scrub(patch.split('\n').filter(l=>/^[+-][^+-]/.test(l)).join('\n')).slice(0,500);
    r.success=!!c.receipt&&!/verification failed|Failed to find expected|Script failed|invalid patch/i.test(c.receipt.text);
    r.cause=r.success?'unknown':causeOf(c.receipt?.text||'');
   }else if(/write_stdin/.test(o.name)||o.name==='wait'){
    r.kind='poll';r.process=String(o.args?.session_id??o.args?.cell_id??'');r.exit=receipt?.exit_code;
    r.empty=!!c.receipt&&receipt?.exit_code==null&&!(receipt?.output||'').trim();r.running=r.empty;
   }else if(typeof cmd==='string'){
    r.kind='command';r.command=cmd;r.normalized=normalized(cmd);r.signature=hash(r.cwd+'|'+r.normalized);r.readPaths=readFiles(cmd,r.cwd);
    r.exit=receipt?.exit_code;r.process=receipt?.session_id==null?null:String(receipt.session_id);r.running=r.process!=null&&r.exit==null;
    r.cause=causeOf(receipt?.output||'');r.failed=failed(cmd,receipt);r.output=scrub(receipt?.output||'').slice(-1600);
    r.barrier=/\b(?:Set-Content|Add-Content|Out-File|writeFile|write_text|write_bytes|Remove-Item|Move-Item|Copy-Item|git\s+(?:restore|checkout|reset|apply|merge|cherry-pick)|npm\s+(?:install|ci)|pnpm\s+install)\b|(?:>|\bsed\s+-i)/i.test(cmd);
   }else continue;
   ops.push(r);
  }
 }
 ops.sort((a,b)=>a.ms-b.ms||a.line-b.line);
 const processes=new Map();
 for(const o of ops){const key=o.session+'|'+o.turn+'|'+o.process;if(o.kind==='command'&&o.process)processes.set(key,o);else if(o.kind==='poll'&&processes.has(key)){
  const c=processes.get(key);if(o.exit!=null){c.exit=o.exit;c.end=o.end;c.running=false;
   const call=globalCalls.get(o.call),r=packets(call?.receipt?.text||'');const payload=r.length===1?r[0]:decoded(call?.receipt?.text||'');
   c.output=scrub(payload.output||'').slice(-1600);c.cause=causeOf(payload.output||'');c.failed=failed(c.command,payload);c.completionLine=o.receiptLine||o.line;processes.delete(key);
  }
 }}
 const callOps=new Map();for(const o of ops){if(!callOps.has(o.call))callOps.set(o.call,[]);callOps.get(o.call).push(o);}
 for(const o of ops)o.usageIds=[];
 for(const u of usageMap.values()){const list=callOps.get(u.call);if(list?.length===1){list[0].usageIds.push(u.id);u.operation=list[0].id;list[0].session=u.session;}}
 const episodes=[];
 function add(signal,items,excess,key){if(!excess.length)return;episodes.push({id:hash(signal+'|'+key+'|'+items[0].id).slice(0,20),signal,session:items[0].session,turn:items[0].turn,operationIds:[...new Set(items.map(x=>x.id))],excessIds:[...new Set(excess.map(x=>x.id))],cause:signal==='a'?items[0].cause:'unknown',file:items[0].file,line:items[0].line,lastLine:items.at(-1).line});}
 const grouped=new Map();for(const o of ops){if(!grouped.has(o.session))grouped.set(o.session,[]);grouped.get(o.session).push(o);}
 for(const [session,list] of grouped){
  const failures=new Map(),reads=new Map(),edits=new Map(),polls=new Map();
  const flushRead=()=>{for(const [k,v] of reads)if(v.length>=3)add('b',v,v.slice(2),k);reads.clear();};
  for(const o of list){
   if(o.kind==='command'){
    const k=o.turn+'|'+o.signature;if(o.failed){if(!failures.has(k))failures.set(k,[]);failures.get(k).push(o);}else{const v=failures.get(k);if(v?.length>=2)add('a',v,v.slice(1),k);failures.delete(k);}
    if(o.barrier)flushRead();
    for(const p of o.readPaths||[]){const key=p+'|'+o.signature;if(!reads.has(key))reads.set(key,[]);reads.get(key).push(o);}
   }
   if(o.kind==='edit'&&o.success){for(const p of o.paths){for(const [key,v] of reads)if(key.startsWith(p+'|')){if(v.length>=3)add('b',v,v.slice(2),key);reads.delete(key);}const k=o.turn+'|'+p;if(!edits.has(k))edits.set(k,[]);edits.get(k).push(o);}}
   if(o.kind==='poll'){const k=o.turn+'|'+o.process;if(o.empty){if(!polls.has(k))polls.set(k,[]);polls.get(k).push(o);}else{const v=polls.get(k);if(v?.length>=3)add('d',v,v.slice(2),k);polls.delete(k);}}
  }
  flushRead();for(const [k,v] of failures)if(v.length>=2)add('a',v,v.slice(1),k);for(const [k,v] of edits)if(v.length>=3)add('c',v,v.slice(2),k);for(const [k,v] of polls)if(v.length>=3)add('d',v,v.slice(2),k);
 }
 const byOp=new Map(ops.map(o=>[o.id,o])),byUsage=usageMap,owners=new Map();
 for(const e of [...episodes].sort((a,b)=>['a','c','b','d'].indexOf(a.signal)-['a','c','b','d'].indexOf(b.signal)||a.id.localeCompare(b.id)))for(const id of e.excessIds)if(!owners.has(id))owners.set(id,e.id);
 for(const e of episodes){
  const all=e.excessIds.map(id=>byOp.get(id)),primary=all.filter(o=>owners.get(o.id)===e.id);
  const ids=[...new Set(primary.flatMap(o=>o.usageIds))];e.usageIds=ids;e.primaryIds=primary.map(o=>o.id);
  e.knownTokens=ids.reduce((s,id)=>s+byUsage.get(id).tokens,0);e.unknownTokenOperations=primary.filter(o=>!o.usageIds.length).length;
  e.tokenStatus=e.unknownTokenOperations?'partial_or_unknown':'measured_associated';
  e.durationMs=primary.filter(o=>Number.isFinite(o.end)&&o.end>o.ms).reduce((s,o)=>s+o.end-o.ms,0);e.unknownDurations=primary.filter(o=>!Number.isFinite(o.end)||o.end<=o.ms).length;
  e.elapsedMs=byOp.get(e.operationIds.at(-1)).ms-byOp.get(e.operationIds[0]).ms;
 }
 const samples=[];for(const signal of ['a','b','c','d'])samples.push(...episodes.filter(e=>e.signal===signal).sort((a,b)=>hash(seed+a.id).localeCompare(hash(seed+b.id))).slice(0,10));
 // Keep bounded, best-effort scrubbed previews for PRIVATE review, not publication.
 const safeOps=ops.map(({command,normalized,output,...o})=>({...o,commandPreview:command?safeCommand(command):undefined,errorExcerpt:o.failed?output?.slice(-450):undefined}));
 save('operations',safeOps);save('usage',[...usageMap.values()]);save('episodes',episodes);save('sample',samples.map(e=>({id:e.id,signal:e.signal,session:e.session,line:e.line,lastLine:e.lastLine,file:e.file,verdict:'pending',cause:'unknown',note:''})));
 save('stats',{...stats,sessions:new Set(ops.map(o=>o.session)).size,operations:ops.length,usageRecords:usageMap.size,totalTokens:[...usageMap.values()].reduce((s,u)=>s+u.tokens,0),mappedTokens:[...usageMap.values()].filter(u=>u.operation).reduce((s,u)=>s+u.tokens,0),signalCounts:Object.fromEntries(['a','b','c','d'].map(s=>[s,episodes.filter(e=>e.signal===s).length]))});
 console.log(JSON.stringify(load('stats')));
}

function inspect(){const samples=load('sample'),episodes=load('episodes'),ops=load('operations');const byOp=new Map(ops.map(o=>[o.id,o]));const chosen=opt('--signal',null);for(const s of samples.filter(s=>!chosen||s.signal===chosen)){const e=episodes.find(e=>e.id===s.id);console.log(JSON.stringify({...s,tokens:e.knownTokens,unknown:e.unknownTokenOperations,spanMinutes:e.elapsedMs/60000,events:e.operationIds.map(id=>byOp.get(id)).map(o=>({line:o.line,receiptLine:o.receiptLine,completionLine:o.completionLine,ts:o.ts,cmd:o.commandPreview,paths:o.paths,patch:o.patchSummary,failed:o.failed,cause:o.cause,error:o.errorExcerpt,empty:o.empty,ms:Number.isFinite(o.end)?o.end-o.ms:null})).slice(0,14)}));}}

function selfTest(){
 const syntheticCwd=path.win32.join(path.parse(process.cwd()).root,'synthetic-analysis-fixture');
 assert.equal(failed('rg x file',{exit_code:1,output:''}),false);
 assert.equal(failed('npm test',{exit_code:1,output:'AssertionError: mismatch'}),true);
 assert.equal(failed('npm test',{exit_code:0,output:'AssertionError in example'}),false);
 assert.equal(failed('npm test',{exit_code:1,output:''}),false);
 assert.deepEqual(readFiles('Get-Content src/a.ts',syntheticCwd),[canon('src/a.ts',syntheticCwd)]);
 assert.deepEqual(readFiles('Get-Content $file',syntheticCwd),[]);
 assert.equal(extract('exec','text(await tools.exec_command({cmd:"npm test"}));')[0].args.cmd,'npm test');
 assert.equal(extract('exec','tools.spawn_agent({message:"npm test"})').length,0);
 assert.equal(scrub('https://example.test?token=secret').includes('secret'),false);
 assert.equal(scrub('task-5-report.md'),'task-5-report.md');
 assert.equal(normalized('  echo  "two  spaces"  '),'echo "two  spaces"');
 const fixture=path.resolve('output/rework-analysis-self-test');fs.mkdirSync(fixture,{recursive:true});
 const records=[{timestamp:'2026-01-01T00:00:00.000Z',type:'session_meta',payload:{id:'fixture-session',cwd:syntheticCwd}},{timestamp:'2026-01-01T00:00:00.001Z',type:'turn_context',payload:{turn_id:'fixture-turn'}}];
 let counter=0;const emit=(name,input,output)=>{counter++;const base=Date.parse('2026-01-01T00:00:00Z')+counter*1000;const cid='fixture-'+counter;
  records.push({timestamp:new Date(base).toISOString(),type:'response_item',payload:{type:'function_call',name,call_id:cid,arguments:typeof input==='string'?input:JSON.stringify(input)}});
  records.push({timestamp:new Date(base+1).toISOString(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:counter*100},last_token_usage:{total_tokens:100}}}});
  records.push({timestamp:new Date(base+100).toISOString(),type:'response_item',payload:{type:'function_call_output',call_id:cid,output:typeof output==='string'?output:JSON.stringify(output)}});
 };
 for(let i=0;i<2;i++)emit('exec_command',{cmd:'npm test'},{exit_code:1,output:'AssertionError: wrong'});
 for(let i=0;i<3;i++)emit('exec_command',{cmd:'Get-Content src/a.ts'},{exit_code:0,output:'text'});
 for(let i=0;i<3;i++)emit('apply_patch','*** Begin Patch\n*** Update File: src/b.ts\n@@\n-old\n+new\n*** End Patch','Success');
 for(let i=0;i<3;i++)emit('write_stdin',{session_id:123},{session_id:123,output:''});
 for(let i=0;i<2;i++)emit('exec_command',{cmd:'rg nothing src/a.ts'},{exit_code:1,output:''});
 fs.writeFileSync(path.join(fixture,'fixture.jsonl'),records.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const childOut=path.join(fixture,'analysis');
 execFileSync(process.execPath,[path.resolve('scripts/rework-analysis.mjs'),'--sessions-root',fixture,'--archive-root',path.join(fixture,'absent'),'--out',childOut],{stdio:'pipe'});
 const result=JSON.parse(fs.readFileSync(path.join(childOut,'stats.json'))),eps=JSON.parse(fs.readFileSync(path.join(childOut,'episodes.json')));
 assert.deepEqual(result.signalCounts,{a:1,b:1,c:1,d:1});assert.equal(result.totalTokens,1300);assert.equal(eps.reduce((s,e)=>s+e.knownTokens,0),400);
 execFileSync(process.execPath,[path.resolve('scripts/rework-analysis.mjs'),'--manifest',path.join(childOut,'manifest.json'),'--out',childOut],{stdio:'pipe'});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(childOut,'stats.json'))),result);
 console.log('Self-tests passed');
}
if(args.includes('--self-test'))selfTest();
else if(args.includes('--inspect'))inspect();
else if(args.includes('--context'))await context();
else if(args.includes('--report'))report();
else await scan();

function report(){
 const stats=load('stats'),episodes=load('episodes'),ops=load('operations'),usage=load('usage'),sample=load('sample');
 const reviews=fs.existsSync(path.join(out,'reviews.json'))?load('reviews'):[];
 const byOp=new Map(ops.map(o=>[o.id,o])),byEp=new Map(episodes.map(e=>[e.id,e])),byReview=new Map(reviews.map(r=>[r.id,r]));
 assert.equal(new Set(usage.map(u=>u.id)).size,usage.length);
 assert.equal(stats.totalTokens,usage.reduce((n,u)=>n+u.tokens,0));
 assert.equal(new Set(episodes.flatMap(e=>e.primaryIds)).size,episodes.reduce((n,e)=>n+e.primaryIds.length,0));
 const labels={permission:'权限/访问限制',missing_path:'文件或路径不存在',missing_dependency:'依赖或可执行文件缺失',test_entry:'测试入口/命令选项',network:'网络/证书',resource_lock:'锁/资源不足',syntax_api:'脚本语法/API 使用',type_compile:'类型/编译',test_assertion:'断言失败/实现不匹配',patch_context:'补丁上下文不匹配',timeout:'执行超时',unknown:'不确定原因',requirements:'需求理解/范围',polling:'轮询等待策略'};
 const fmt=n=>Number.isFinite(n)?Math.round(n).toLocaleString('en-US'):'未知';
 const pct=n=>Number.isFinite(n)?(100*n).toFixed(2)+'%':'未知';
 const signalNames={a:'同命令连续失败',b:'未修改时重复读取',c:'同轮反复修改',d:'连续空结果轮询'};
 const selectedIds=new Set(sample.map(x=>x.id));for(const r of reviews)assert.ok(selectedIds.has(r.id),'Review must belong to frozen random sample');
 const aggregate={},causeRaw=new Map(),causeEstimate=new Map();let estimated=0,uncertainEstimate=0,allReviewed=true;
 for(const signal of ['a','b','c','d']){
  const es=episodes.filter(e=>e.signal===signal),ss=sample.filter(s=>s.signal===signal),rr=ss.map(s=>byReview.get(s.id));
  const confirmed=rr.filter(r=>r?.verdict==='confirmed'),fp=rr.filter(r=>r?.verdict==='false_positive'),unknown=rr.filter(r=>r?.verdict==='uncertain');
  if(rr.some(r=>!r||r.verdict==='pending'))allReviewed=false;
  const weight=ss.length?es.length/ss.length:0;
  const point=confirmed.reduce((s,r)=>s+byEp.get(r.id).knownTokens*weight,0);
  const uncertain=unknown.reduce((s,r)=>s+byEp.get(r.id).knownTokens*weight,0);
  estimated+=point;uncertainEstimate+=uncertain;
  for(const r of confirmed){const k=r.cause||'unknown';causeEstimate.set(k,(causeEstimate.get(k)||0)+byEp.get(r.id).knownTokens*weight);}
  aggregate[signal]={episodes:es.length,sessions:new Set(es.map(e=>e.session)).size,knownTokens:es.reduce((s,e)=>s+e.knownTokens,0),unknownOps:es.reduce((s,e)=>s+e.unknownTokenOperations,0),durationMs:es.reduce((s,e)=>s+e.durationMs,0),unknownDurations:es.reduce((s,e)=>s+e.unknownDurations,0),sample:ss.length,confirmed:confirmed.length,falsePositive:fp.length,uncertain:unknown.length,estimatedTokens:point};
 }
 for(const e of episodes){const k=e.cause; if(!causeRaw.has(k))causeRaw.set(k,[]);causeRaw.get(k).push(e);}
 const rawTokens=episodes.reduce((s,e)=>s+e.knownTokens,0);
 const candidateUsage=new Set(episodes.flatMap(e=>e.usageIds));
 assert.equal(rawTokens,usage.filter(u=>candidateUsage.has(u.id)).reduce((s,u)=>s+u.tokens,0),'Reconcile episode sum against independently selected usage ledger');
 const rank=[...causeRaw].sort((a,b)=>b[1].reduce((s,e)=>s+e.knownTokens,0)-a[1].reduce((s,e)=>s+e.knownTokens,0));
 const knownCauseRank=[...causeEstimate].filter(([k])=>k!=='unknown').sort((a,b)=>b[1]-a[1]);
 const top3=estimated>0?knownCauseRank.slice(0,3).reduce((s,[,n])=>s+n,0)/estimated:null;
 const actionable=reviews.filter(r=>r.verdict==='confirmed'&&r.actionable===true);
 const checks=[allReviewed&&estimated/stats.totalTokens>=plan.thresholds.tokenShare,allReviewed&&top3!==null&&top3>=plan.thresholds.top3CauseShare,actionable.length>=1];
 const conclusion=checks.every(Boolean)?'通过':'不通过';
 const evidence=e=>`${e.session}，${path.basename(e.file)}:${e.line}-${e.lastLine}`;
 const lines=[
 '# 跨会话返工分析：本地真实日志验证','',`最终结论：**${conclusion}**。预设阈值保持 10%、50%、至少一类可行动原因，不因结果修改。`,
 '', '## 1. 数据范围与边界','',
 `- 扫描 ${stats.files} 份活动/归档日志，${fmt(stats.bytes)} bytes，${fmt(stats.lines)} 行；解析错误 ${stats.invalid}。`,
 `- 固定事件截止 ${cutoff}，排除这次分析及以后事件。目录比上一轮 852 份多 1 个文件；两个 10 月 2 日创建的文件在本轮均没有进入操作/usage 统计。完整清单和固定文件大小在 manifest.json，不以新增文件扩充历史样本。`,
 `- ${stats.sessions} 个有可识别操作的会话，${fmt(stats.operations)} 个操作；父子 agent 相关，不当作独立用户。`,
 `- 实际可统计 usage 总量 ${fmt(stats.totalTokens)} tokens；可唯一关联到单个操作 ${fmt(stats.mappedTokens)}（${pct(stats.mappedTokens/stats.totalTokens)}）。缺失或无法归因部分不是 0。`,
 `- 去重工具调用 ${fmt(stats.duplicateCalls)} 次、usage ${fmt(stats.duplicateUsage)} 条；旧累计计数重置 ${stats.legacyResets} 次。动态参数未解析 ${stats.unresolvedOperations} 次，多操作输出歧义 ${stats.ambiguousReceipts} 次。`,
 '- 只读，不上传；未改现有产品代码。保存的证据只含事件位置、统计字段及有限脱敏摘录，不保存原始日志全文。',
 '', '## 2. 预先固定的规则','',
 ...Object.entries(plan.rules).map(([k,v])=>`- **${k}**：${v}`),
 '- a 的命令键保留参数及 cwd，只统一换行和空白；因此参数变化后的同目的重试可能漏检。失败要求非零终态和明确错误特征，rg/git diff 的正常非零不算。TDD 预期失败仍需人工排除。',
 '- b 只支持可确定路径的 Get-Content/cat/type，且要求相同读取命令/范围；补丁写入或可能写文件的操作切断读取序列。外部编辑不可观测，因此“未修改”只是日志中未发现修改。',
 '- c 是反复编辑信号，不声称已自动识别撤销再重做；分步开发、补测试、格式调整均可能误报。',
 '- d 只是等待循环信号，不代表任务卡死或浪费。时长为操作请求至回执的观测时长，包含正常等待；不是模型思考时间。',
 '- 操作去重并按 a > c > b > d 唯一分配，防止同一 token 重复计入。候选成本只计第二次失败及第三次后的读/改/空轮询，初次工作不算。',
 '', '## 3. token 与时长统计','',
 '| 信号 | 候选数 | 会话数 | 已知关联 tokens | token 未知操作 | 已知操作时长（小时） | 时长未知操作 |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...Object.entries(aggregate).map(([k,x])=>`| ${k} ${signalNames[k]} | ${x.episodes} | ${x.sessions} | ${fmt(x.knownTokens)} | ${x.unknownOps} | ${(x.durationMs/3600000).toFixed(2)} | ${x.unknownDurations} |`),
 '',`候选关联 token 去重小计：${fmt(rawTokens)}，占可统计 usage 的 ${pct(rawTokens/stats.totalTokens)}。**这是规则候选，不是已确认返工占比。**`,
 '每个候选在 episodes.json 中有 knownTokens、未知操作数、已知时长、未知时长数和跨度；已知小计为 0 且有未知项时表示未知，不表示零成本。时长相加可能有并发重叠，不等于用户净等待时长。',
 '优先使用 token_usage_record 的实际每响应 usage；同轮无该记录时采用累计 token_count 的正增量。缓存输入属于输入，不重复加；推理输出属于输出，不重复加。一个生成内多个操作无法拆分时，不均摊、不猜 token。',
 '关联 token 是产生该操作的整次模型请求成本，包含上下文；不等于重复读取文件的字数，也不是严格的可节省 token。没有测量与“agent 直接读日志”的成本差，不能认定后者做不到。',
 '', '## 4. 人工抽查与误报','',
 `固定随机种子：${seed}。每类按候选 ID 的 SHA-256 排序选前 10 条；不足则全取。保留初筛口径，不用复核后的筛选美化误报率。`,
 '| 信号 | 抽查 | 确认返工 | 误报 | 不确定 | 明确误报率 | 将不确定算误报的上界 |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...Object.entries(aggregate).map(([k,x])=>`| ${k} | ${x.sample} | ${x.confirmed} | ${x.falsePositive} | ${x.uncertain} | ${pct(x.falsePositive/x.sample)} | ${pct((x.falsePositive+x.uncertain)/x.sample)} |`),
 '', '误报指“不是不必要的返工”，并非仅指正则未匹配。reviews.json 保留逐条人工理由；高误报类别不以原始候选数证明需求。每类仅 10 条，误差大，不能把点估计当作稳定发生率。',
 'b/c/d 的误报率较高，因此没有直接用它们的全部规则成本判断需求，而只将人工确认部分按预先约定的分层方式扩展。a 中大量“不确定”也单列，没有当成真阳性。',
 `按每类 N/n 扩展人工确认样本的已知、去重关联 token：约 ${fmt(estimated)}，占 ${pct(estimated/stats.totalTokens)}。人工不确定样本的关联 token 扩展量另为 ${fmt(uncertainEstimate)}；未测 token 仍未知，不纳入假定零成本。`,
 '这是分层样本点估计，不是对所有候选逐条人工确认。来源缺失、检测漏报、原因识别不足无法靠该抽样消除。',
 '', '## 5. 原因前 10（规则归因，不等于确认根因）','',
 '| 原因/错误特征 | 候选数 | 已知关联 tokens | 证据（优先不同会话，最多 3 个） |',
 '|---|---:|---:|---|',
 ...rank.slice(0,10).map(([k,es])=>{const ids=new Set(),ex=[];for(const e of es){if(ids.has(e.session))continue;ids.add(e.session);ex.push(e);if(ex.length===3)break;}return `| ${labels[k]||k} | ${es.length} | ${fmt(es.reduce((s,e)=>s+e.knownTokens,0))} | ${ex.map(evidence).join('<br>')} |`;}),
 '',`实际有 ${rank.length} 个规则原因组；不足 10 类或某类不足 2–3 个独立会话时不编造证据。“不确定原因”不算可解释的集中原因。`,
 `人工确认样本扩展后的原因 token：${[...causeEstimate].map(([k,n])=>`${labels[k]||k} ${fmt(n)}`).join('；')||'无可估计的确认原因'}。前三个已知原因覆盖 ${pct(top3)}，仅基于 ${reviews.filter(r=>r.verdict==='confirmed').length} 个确认样本，不是全量根因覆盖率。`,
 `可行动的确认样本：${actionable.map(r=>`${r.id}：${r.action||r.note}`).join('；')||'无已确认可行动样本'}。`,
 '', '## 6. 修正前后对比','',
 ...historyComparison(ops,episodes),
 '', '## 7. 三条标准逐条判定','',
 `1. 返工占可统计 token >=10%：**${checks[0]?'满足':'不满足/未证实'}**。人工样本扩展点估计 ${pct(estimated/stats.totalTokens)}；原始候选 ${pct(rawTokens/stats.totalTokens)} 不能替代返工。`,
 `2. 前三类原因覆盖 >=50%：**${checks[1]?'满足':'不满足/未证实'}**。按人工确认样本扩展后的返工关联 token 计算为 ${pct(top3)}；未知不计为已解释原因。`,
 `3. 至少一类能采取具体行动：**${checks[2]?'满足':'不满足/未证实'}**。已确认可行动样本 ${actionable.length} 条。`,
 '',`**最终：${conclusion}。** 三项必须全部满足。若有缺失证据，该项不能标为通过；这不等于证明真实返工不存在。`,
 '- 样本只来自一个用户，含多个项目和大量相关子 agent；不能外推为市场频率。重复读取、迭代编辑、长任务轮询通常是必要工作，不能直接叫“浪费”。',
 '- 这是对日志可观察信号的探索检验；不是因果实验，也没有完成与直接读日志方案的成本基准。',
 '', '## 8. 重复运行','',
 '```powershell',
 'node scripts/rework-analysis.mjs --self-test',
 'node scripts/rework-analysis.mjs --manifest output/rework-analysis/manifest.json --before 2026-10-02T00:00:00.000Z',
 'node scripts/rework-analysis.mjs --inspect --signal a',
 '# reviews.json is the separate manual ledger; scan does not overwrite it.',
 'node scripts/rework-analysis.mjs --report',
 '```',
 '', '第一次扫描可省略 --manifest；重现本次应保留该参数，按原清单及文件字节边界读取。源文件消失或变短会报错，不会静默更换样本。依赖使用项目已有的 TypeScript，仅用于解析工具调用，不执行日志内容。脚本没有下载、网络或产品修改步骤。',
 '', '## 9. 分析自检与修正记录','',
 '- 端到端合成夹具覆盖四类信号、正常 rg 非零退出不误判、usage 及操作去重；固定 manifest 重跑得到相同结果。',
 '- 人工复核发现旧式进程 ID 会跨轮复用；已将回执配对限定到同会话同轮，终态后释放映射，并全量重跑。修复重复补丁路径导致同操作重复入组的问题后，独立 usage 集合与候选汇总完全一致。',
 '- 部分归档事件的时间戳被压成相同值；这些操作时长标未知，不按 0 秒估计。',
 '- 这些是解析与计量错误修复，不改变 10% / 50% / 可行动原因的预设阈值。人工样本按修正后的候选集合用同一随机种子重新抽取，并补查了新增样本。'
 ];
 fs.writeFileSync(path.resolve(out,'../rework-analysis-report.md'),lines.join('\n')+'\n');
 save('summary',{stats,aggregate,rawTokens,estimatedTokens:estimated,uncertainEstimate,top3,checks,conclusion,allReviewed});
 console.log(JSON.stringify({conclusion,checks,rawShare:rawTokens/stats.totalTokens,estimatedShare:estimated/stats.totalTokens,top3,allReviewed}));
}

function historyComparison(ops,episodes){
 try{
  const commit=execFileSync('git',['show','-s','--format=%H|%cI|%s','b782ff3'],{encoding:'utf8'}).trim();
  const diff=execFileSync('git',['show','b782ff3','--','vitest.config.ts'],{encoding:'utf8'});
  const correction=ops.find(o=>o.kind==='edit'&&o.paths.some(p=>p.endsWith('/vitest.config.ts'))&&o.patchSummary?.includes('src/**/*.test.tsx'));
  if(correction&&diff.includes('src/**/*.test.tsx')){
   const correctedCwd=canon(path.win32.dirname(correction.paths.find(p=>p.endsWith('/vitest.config.ts'))));
   const exposure=ops.filter(o=>o.kind==='command'&&o.cwd===correctedCwd&&o.commandPreview==='npm test -- src/App.integration.test.tsx');
   const before=exposure.filter(o=>o.ts<correction.ts),after=exposure.filter(o=>o.ts>=correction.ts);
   const errors=xs=>xs.filter(o=>o.failed&&o.cause==='test_entry').length;
   const retries=xs=>{let previous=false,n=0;for(const o of xs){const bad=o.failed&&o.cause==='test_entry';if(bad&&previous)n++;previous=bad;}return n;};
   const [id,when,title]=commit.split('|');
   save('before-after',{commit:id,commitTime:when,effectiveTime:correction.ts,evidence:{session:correction.session,line:correction.line,file:correction.file},before:{attempts:before.length,missingEntryErrors:errors(before),excessRetries:retries(before)},after:{attempts:after.length,missingEntryErrors:errors(after),excessRetries:retries(after)},operationIds:exposure.map(o=>o.id)});
   return [
    `找到真实修复：${id}（${when}，${title}）在 vitest.config.ts 的 include 中加入 src/**/*.test.tsx；Git diff 和日志补丁一致。`,
    `有效修复时间采用实际补丁 ${correction.ts}，不是稍后的提交时间。证据：${correction.session}，${path.basename(correction.file)}:${correction.line}。`,
    '比较同一工作树、完全相同的 npm test -- src/App.integration.test.tsx 命令；分母为观察到的该命令执行次数，不混入其他项目或未运行的天数。',
    '| 指标 | 修复前 | 修复后 |','|---|---:|---:|',
    `| 同入口执行次数 | ${before.length} | ${after.length} |`,
    `| 测试入口缺失失败 | ${errors(before)}/${before.length} | ${errors(after)}/${after.length} |`,
    `| 连续同因失败的额外重试 / 执行次数 | ${retries(before)}/${before.length} (${(100*retries(before)/before.length).toFixed(1)}%) | ${retries(after)}/${after.length} (${(100*retries(after)/after.length).toFixed(1)}%) |`,
    '修复后仍出现测试断言失败，但不再是找不到测试入口，不能把它们算成同一原因。此对比只有一个会话、很少的执行次数，并非跨用户或长期因果证据；它只证明这个具体配置问题可修正。没有足够同版本、同入口的跨会话暴露数据来证明长期返工率下降。当前仓库也没有 AGENTS.md 的提交历史。'
   ];
  }
 }catch{}
 let commit;try{commit=execFileSync('git',['show','-s','--format=%H|%cI|%s','da7a248'],{encoding:'utf8'}).trim();}catch{return ['未找到可核验的修复提交，不计算前后发生率。'];}
 const [id,when,title]=commit.split('|');
 const exposure=ops.filter(o=>o.kind==='command'&&/tracelens/i.test(o.cwd)&&/(?:codex.*mcp|setup-codex|setupCodex)/i.test(o.commandPreview||''));
 const before=exposure.filter(o=>o.ts<when),after=exposure.filter(o=>o.ts>=when);
 const matches=e=>e.signal==='a'&&e.operationIds.some(x=>exposure.some(o=>o.id===x));
 const candidates=episodes.filter(matches);
 return [`核验到提交 ${id}（${when}，${title}）：Windows 下 Codex/npm shim 改为经 cmd.exe 调用，并添加回归测试。当前仓库没有可用的 AGENTS.md 提交历史。`,
 `仅作暴露量盘点：命令文本涉及 Codex MCP/setup 的 TraceLens 操作，修复前 ${before.length} 次、修复后 ${after.length} 次；其中同命令连续失败候选 ${candidates.length} 组。`,
 '不能把这些组直接视为该 Windows 启动缺陷：命令集合还含文件搜索、单元测试和直接 Codex CLI 操作，且没有逐次运行版本/错误根因标记。修复提交时间也不等于所有工作树安装修复的时间。未找到同时具备明确同因重复失败、版本暴露和可比前后分母的案例，因此不报告伪精确的修复前后发生率，也不声称修复导致返工下降。'];
}

async function context(){
 const samples=load('sample').filter(x=>(!opt('--signal',null)||x.signal===opt('--signal'))&&(!opt('--id',null)||x.id===opt('--id')));
 const ops=load('operations');
 for(const s of samples){
  const surrounding=ops.filter(o=>o.file===s.file&&o.line>=s.line-15&&o.line<=s.lastLine+15);
  const messages=[];let line=0;
  for await(const raw of readline.createInterface({input:fs.createReadStream(s.file),crlfDelay:Infinity})){
   line++;if(line<s.line-15)continue;if(line>s.lastLine+15)break;let x;try{x=JSON.parse(raw);}catch{continue;}
   const p=x.payload||{};
   if(x.type==='response_item'&&p.type==='message'&&p.role==='assistant')messages.push({line,text:scrub(str(p.content)).slice(0,300)});
   if(x.type==='event_msg'&&p.type==='user_message')messages.push({line,user:scrub(str(p.message)).slice(0,200)});
  }
  console.log(JSON.stringify({id:s.id,messages:messages.slice(-12),nearby:surrounding.filter(o=>o.kind==='command').map(o=>({line:o.line,cmd:o.commandPreview,failed:o.failed,cause:o.cause,process:o.process})).slice(-10)}));
 }
}
