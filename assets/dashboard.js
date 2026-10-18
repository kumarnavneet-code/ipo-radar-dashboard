const modules={};
modules["src/domain/validation.js"]=(()=>{// Supports only the JSON Schema keywords used by our versioned contracts.
// Cross-field business rules run separately; this is not a general schema engine.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isType = (value, type) => ({null: value === null, object: object(value), array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', number: typeof value === 'number' && Number.isFinite(value), integer: Number.isSafeInteger(value)})[type] === true;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return false;
  if (match[5] !== 'Z' && (+match[5].slice(1, 3) > 23 || +match[5].slice(4) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
function validateSchema(value, schema, path = '$') {
  const errors = [];
  const fail = text => errors.push(`${path}: ${text}`);
  if (schema.type && ![].concat(schema.type).some(type => isType(value, type))) {
    fail(`expected ${[].concat(schema.type).join(' or ')}`); return errors;
  }
  if (own(schema, 'const') && value !== schema.const) fail(`expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) fail('value is not allowed');
  if (value === null) return errors;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) fail('string is empty or too short');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('string is too long');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('invalid identifier');
    if (schema.format === 'date' && !validDate(value)) fail('invalid calendar date');
    if (schema.format === 'date-time' && !validTimestamp(value)) fail('expected a real ISO timestamp with timezone');
    if (schema.format === 'https-url' && !httpsUrl(value)) fail('expected a credential-free HTTPS source URL');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('number must be finite');
    if (schema.minimum !== undefined && value < schema.minimum) fail('below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) fail('above maximum');
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail('must be greater than minimum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('not enough entries');
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail('duplicate entries');
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)));
  }
  if (object(value)) {
    for (const key of schema.required || []) if (!own(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (own(schema.properties || {}, key)) errors.push(...validateSchema(item, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) fail(`unexpected property ${key}`);
    }
  }
  return errors;
}
function duplicated(values) { return new Set(values).size !== values.length; }
function validateCatalogue(catalogue, schema) {
  const errors = validateSchema(catalogue, schema);
  if (errors.length) return errors;
  const fail = (id, text) => errors.push(`${id}: ${text}`);
  if (duplicated(catalogue.ipos.map(ipo => ipo.id))) fail('$', 'duplicate IPO IDs');
  for (const ipo of catalogue.ipos) {
    const id = ipo.id;
    if (catalogue.mode === 'demo' && (!ipo.isDemo || ipo.verification !== 'demo')) fail(id, 'demo catalogue requires demo records');
    if (catalogue.mode === 'curated' && (ipo.isDemo || ipo.verification !== 'reviewed')) fail(id, 'public catalogue requires reviewed, non-demo records');
    if (catalogue.mode === 'preview' && (ipo.isDemo || ipo.verification !== 'unverified' || !ipo.id.startsWith('preview_'))) fail(id, 'engine preview requires separate, unverified real records');
    if (duplicated(ipo.sources.map(s => s.id))) fail(id, 'duplicate source IDs');
    if (duplicated(ipo.observations.map(s => s.key))) fail(id, 'duplicate observation keys');
    const sources = new Map(ipo.sources.map(s => [s.id, s]));
    for (const entry of [ipo, ...ipo.observations, ...ipo.notes, ...(ipo.buzz ? [ipo.buzz] : [])]) {
      for (const ref of entry.sourceIds) if (!sources.has(ref)) fail(id, `unknown source reference ${ref}`);
      if (entry.observedAt && Date.parse(entry.observedAt) > Date.parse(ipo.updatedAt)) fail(id, 'observation is newer than issuer update');
    }
    for (const source of ipo.sources) {
      if (Date.parse(source.observedAt) > Date.parse(ipo.updatedAt)) fail(id, 'source is newer than issuer update');
      if (ipo.isDemo && source.kind !== 'demo') fail(id, 'demo must not imply primary verification');
      if (['curated','preview'].includes(catalogue.mode) && (source.kind !== 'primary' || source.url === null)) fail(id, 'real content requires primary source URLs');
    }
    if (Date.parse(ipo.updatedAt) > Date.parse(catalogue.updatedAt)) fail(id, 'issuer update is newer than catalogue update');
    if (ipo.priceBand && ipo.priceBand.min > ipo.priceBand.max) fail(id, 'price band is reversed');
    if (ipo.priceBand && ipo.lotSize && !Number.isSafeInteger(Math.round(ipo.priceBand.max * 100) * ipo.lotSize)) fail(id, 'application amount exceeds safe numeric range');
    if (ipo.composition && Math.abs(ipo.composition.freshPercent + ipo.composition.ofsPercent - 100) > 0.000001) fail(id, 'fresh issue and OFS must total 100%');
    if (ipo.offerTerms) {
      const t=ipo.offerTerms;
      const ofs=t.ofsAmountCr===null?t.ofsShares*t.upperBand/10000000:t.ofsAmountCr;
      if(t.freshAmountCr===null||t.ofsAmountCr===null&&t.ofsShares===null||!Number.isFinite(ofs)||t.upperBand!==ipo.priceBand?.max||Math.abs(t.ceilingCr-t.freshAmountCr-ofs)>0.0000001)fail(id,'offer ceiling requires matching disclosed components and current upper band');
      if(Math.abs(t.freshPercentAtCeiling+t.ofsPercentAtCeiling-100)>0.000001||t.ceilingCr<=0||Math.abs(t.freshPercentAtCeiling-t.freshAmountCr/t.ceilingCr*100)>0.000001)fail(id,'offer ceiling composition is inconsistent');
      if(t.basis==='calculated_upper_band_ceiling'&&t.ofsAmountCr!==null||t.basis==='disclosed_aggregate_limits'&&t.ofsAmountCr===null)fail(id,'offer ceiling basis contradicts disclosed components');
    }
    const ordered = ['opensAt', 'closesAt', 'allotmentExpectedAt', 'listingExpectedAt'];
    const dates = ordered.map(k => ipo.timeline[k]).filter(v => v !== null);
    for (let i = 1; i < dates.length; i++) if (Date.parse(dates[i]) < Date.parse(dates[i - 1])) fail(id, 'scheduled timeline is out of order');
    for (const event of ['allotmentPublishedAt', 'listedAt']) {
      const at = ipo.timeline[event];
      if (at && Date.parse(at) > Date.parse(catalogue.referenceAt)) fail(id, 'confirmed event cannot be in the future at catalogue reference time');
      if (at && ipo.timeline.closesAt && Date.parse(at) < Date.parse(ipo.timeline.closesAt)) fail(id, 'confirmed event precedes issue close');
    }
    if (ipo.timeline.listedAt && ipo.timeline.allotmentPublishedAt && Date.parse(ipo.timeline.listedAt) < Date.parse(ipo.timeline.allotmentPublishedAt)) fail(id, 'listing precedes confirmed allotment');
  }
  return errors;
}
function validateUserRecords(data, schema, catalogue = null) {
  const errors = validateSchema(data, schema);
  if (errors.length) return errors;
  if (duplicated(data.records.map(r => r.ipoId))) errors.push('$: duplicate personal record IDs');
  for (const record of data.records) {
    const fail = text => errors.push(`${record.ipoId}: ${text}`);
    if (record.savedAt && Date.parse(record.savedAt) > Date.parse(record.updatedAt)) fail('saved time is newer than update');
    const app = record.application;
    if (!record.savedAt && !app) fail('record must contain a bookmark or application');
    if (!app) continue;
    if (app.outcome === 'pending' && app.allottedShares !== null) fail('pending outcome requires unknown allotted quantity');
    if (app.outcome === 'not_allotted' && app.allottedShares !== 0) fail('not-allotted outcome requires zero shares');
    if (app.outcome === 'allotted' && !(app.allottedShares > 0)) fail('allotted outcome requires positive shares');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(record.updatedAt)).map(p => [p.type, p.value]));
    const updatedDay = `${parts.year}-${parts.month}-${parts.day}`;
    if (app.appliedOn > updatedDay) fail('application date is later than record update');
    const ipo = catalogue?.ipos.find(ipo => ipo.id === record.ipoId);
    if (ipo?.lotSize && app.allottedShares > app.lots * ipo.lotSize) fail('allotment exceeds applied shares');
  }
  return errors;
}

return {validDate,validTimestamp,validateSchema,validateCatalogue,validateUserRecords};})();
modules["src/data/manifest-client.js"]=(()=>{const {validateCatalogue}=modules["src/domain/validation.js"];

// Prepared integration contract. No import/activation in the current application.
function createManifestClient(base,schema,{fetcher=fetch,cryptoProvider=globalThis.crypto,onValidated=()=>{},environment='production'}={}) {
 if(!['production','preview'].includes(environment))throw Error('Invalid client environment');
 const root=new URL(base);if(!['http:','https:'].includes(root.protocol)||root.search||root.hash||!root.pathname.endsWith('/'))throw Error('Invalid feed base');
 let current=null;
 async function bounded(url){const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw Error('Feed unavailable');const reader=response.body.getReader();const chunks=[];let count=0;try{for(;;){const item=await reader.read();if(item.done)break;count+=item.value.byteLength;if(count>20*1024*1024)throw Error('Feed exceeds budget');chunks.push(item.value);}}catch(error){await reader.cancel();throw error;}const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;}
 async function poll(){try{
  const manifest=JSON.parse(new TextDecoder().decode(await bounded(new URL('current.json',root))));
  if(manifest.schemaVersion!==1||manifest.environment!==environment||!/^[a-f0-9]{64}$/.test(manifest.version))throw Error('Unaccepted feed manifest');
  if(current?.manifest.version===manifest.version)return {state:'unchanged',current};
  const bytes=await bounded(new URL('versions/'+manifest.version+'/catalogue.json',root));
  const digest=[...new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==manifest.version)throw Error('Feed checksum mismatch');
  const catalogue=JSON.parse(new TextDecoder().decode(bytes));const errors=validateCatalogue(catalogue,schema);if(errors.length)throw Error(errors.join('; '));
  if(catalogue.mode!==(environment==='preview'?'preview':'curated'))throw Error('Feed environment mismatch');
  if(catalogue.updatedAt!==manifest.updatedAt||Date.parse(catalogue.updatedAt)>Date.now())throw Error('Invalid feed clock');
  if(current&&Date.parse(catalogue.updatedAt)<Date.parse(current.catalogue.updatedAt))throw Error('Older feed requires explicit rollback');
  await onValidated(catalogue);current={manifest,catalogue};return {state:'updated',current};
 }catch(error){return {state:current?'stale':'unavailable',current,error:error.message};}}
 return {poll,getCurrent:()=>current};
}

return {createManifestClient};})();
modules["src/data/connected-feed.js"]=(()=>{const {createManifestClient}=modules["src/data/manifest-client.js"];

// The current collector publishes partial discovery in the preview contract.
// Connection does not promote that data to fully accepted production research.
function createConnectedFeed({fetcher=fetch,cryptoProvider=globalThis.crypto,base=new URL('../../data/engine-preview/',new URL("src/data/connected-feed.js",document.baseURI).href),now=()=>Date.now()}={}) {
 let client=null, pending=null;
 async function read() {
  if(!client) {
   const response=await fetcher(new URL('../../schemas/catalogue.schema.json',new URL("src/data/connected-feed.js",document.baseURI).href),{cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Feed schema unavailable');
   client=createManifestClient(base,await response.json(),{environment:'preview',fetcher,cryptoProvider,onValidated:catalogue=>{
    if(catalogue.previewScope!=='current')throw Error('Current official discovery required; historical extraction is not a live feed');
   }});
  }
  const result=await client.poll();
  const catalogue=result.current?.catalogue;
  const stale=!!catalogue&&now()-Date.parse(catalogue.updatedAt)>86400000;
  const checked=catalogue?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(catalogue.updatedAt)):null;
  const state=result.error?(catalogue?'stale':'unavailable'):stale?'stale':result.state;
  return {...result,state,changed:result.state==='updated',catalogue,message:catalogue?
   `Connected official-source feed · Source snapshot ${checked} IST. ${result.error?'Refresh failed; retaining last valid data. ':stale?'Source snapshot is over 24 hours old. ':''}Checking for updates every minute. Partial coverage; missing fields and confirmed events may remain unavailable.`:
   'Connected feed unavailable. No historical or fictional data has been substituted. '+(result.error||'')};
 }
 return {poll(){if(!pending)pending=read().catch(error=>({state:client?.getCurrent()?'stale':'unavailable',catalogue:client?.getCurrent()?.catalogue,message:'Connected feed refresh failed. '+error.message})).finally(()=>{pending=null;});return pending;}};
}

return {createConnectedFeed};})();
modules["src/data/catalogue.js"]=(()=>{const {validateCatalogue}=modules["src/domain/validation.js"];
async function loadCatalogue(mode = 'demo', fetcher = fetch) {
  if (!['demo', 'curated'].includes(mode)) throw new Error('Choose a supported catalogue mode.');
  const read = async path => {
    const response = await fetcher(new URL(path, new URL("src/data/catalogue.js",document.baseURI).href));
    if (!response.ok) throw new Error('The selected catalogue could not be loaded.');
    return response.json();
  };
  const [catalogue, schema] = await Promise.all([read(`../../fixtures/catalogue.${mode}.json`), read('../../schemas/catalogue.schema.json')]);
  const errors = validateCatalogue(catalogue, schema);
  if (errors.length) throw new Error('The selected catalogue failed validation.');
  return catalogue;
}
async function loadDemoCatalogue(fetcher = fetch) { return loadCatalogue('demo', fetcher); }

return {loadCatalogue,loadDemoCatalogue};})();
modules["src/data/engine-preview.js"]=(()=>{const {createManifestClient}=modules["src/data/manifest-client.js"];
const {loadCatalogue}=modules["src/data/catalogue.js"];
async function loadEnginePreview({fetcher=fetch,cryptoProvider=globalThis.crypto,base=new URL('../../data/engine-preview/',new URL("src/data/engine-preview.js",document.baseURI).href)}={}){
 try{
  const response=await fetcher(new URL('../../schemas/catalogue.schema.json',new URL("src/data/engine-preview.js",document.baseURI).href));if(!response.ok)throw Error('Schema unavailable');
  const client=createManifestClient(base,await response.json(),{environment:'preview',fetcher,cryptoProvider});
  const result=await client.poll();if(!result.current)throw Error(result.error);
  const catalogue=result.current.catalogue;
  if(catalogue.previewScope==='current'&&Date.now()-Date.parse(catalogue.updatedAt)>86400000)throw Error('Current discovery snapshot is older than 24 hours');
  const checked=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(catalogue.updatedAt));
  return {catalogue,previewLoaded:true,message:catalogue.previewScope==='current'?catalogue.datasetLabel+' · Checked '+checked+' IST. '+catalogue.coverageNote+' Preview saves are separate.':'Engine preview · Historical extraction · Partial coverage · Automatic refresh off. Preview saves are separate.'};
 }catch(error){return {catalogue:await loadCatalogue('curated',fetcher),previewLoaded:false,message:'Engine preview unavailable; showing the existing historical catalogue. '+error.message};}
}
function previewStorage(storage){
 return storage?{getItem:key=>storage.getItem('engine-preview.'+key),setItem:(key,value)=>storage.setItem('engine-preview.'+key,value),removeItem:key=>storage.removeItem('engine-preview.'+key)}:null;
}

return {loadEnginePreview,previewStorage};})();
modules["src/domain/lifecycle.js"]=(()=>{const {validTimestamp}=modules["src/domain/validation.js"];
const labels = {
  upcoming: 'Upcoming', open: 'Open', closed: 'Closed',
  allotment_published: 'Allotment published', listed: 'Listed', unknown: 'Dates unavailable',
};
const stamp = value => value instanceof Date ? value.getTime() : typeof value === 'number' ? value : validTimestamp(value) ? Date.parse(value) : NaN;
function timeLeft(target, now) {
  const remaining = target - now;
  if (remaining <= 0) return null;
  const minutes = Math.ceil(remaining / 60000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(remaining / 3600000);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.ceil(remaining / 86400000);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
function getLifecycle(ipo, now = new Date()) {
  const result = (status, countdown = null) => ({status, label: labels[status], countdown});
  const current = stamp(now);
  if (!Number.isFinite(current) || !ipo?.timeline) return result('unknown');
  const t = ipo.timeline;
  for (const value of Object.values(t)) if (value !== null && value !== undefined && !validTimestamp(value)) return result('unknown');
  const opened = stamp(t.opensAt), closeStamp=stamp(t.closesAt);
  // Date-only schedules include the closing IST day, without inventing a cutoff.
  const closed = ipo.timelinePrecision==='date'&&Number.isFinite(closeStamp)?Math.floor((closeStamp+330*60000)/86400000)*86400000-330*60000+86400000:closeStamp;
  if (Number.isFinite(opened) && Number.isFinite(closed) && closed < opened) return result('unknown');
  const allotment = stamp(t.allotmentPublishedAt), listing = stamp(t.listedAt);
  if (Number.isFinite(listing) && Number.isFinite(allotment) && listing < allotment) return result('unknown');
  if ((Number.isFinite(allotment) && Number.isFinite(closed) && allotment < closed) ||
      (Number.isFinite(listing) && Number.isFinite(closed) && listing < closed)) return result('unknown');
  if (Number.isFinite(listing) && listing <= current) return result('listed');
  if (Number.isFinite(allotment) && allotment <= current) return result('allotment_published');
  // A date estimate alone does not establish a published allotment or a listing.
  if (Number.isFinite(closed) && current >= closed) return result('closed');
  if (!Number.isFinite(opened) || !Number.isFinite(closed)) return result('unknown');
  if (current < opened) return result('upcoming', `Opens in ${timeLeft(opened, current)}`);
  return result('open', ipo.timelinePrecision==='date'?null:`Closes in ${timeLeft(closed, current)}`);
}
function catalogueClock(catalogue, now = new Date()) {
  return catalogue.mode === 'demo' ? catalogue.referenceAt : now;
}

return {getLifecycle,catalogueClock};})();
modules["src/domain/story-filters.js"]=(()=>{const {getLifecycle}=modules["src/domain/lifecycle.js"];
const {validTimestamp}=modules["src/domain/validation.js"];
const day = at => validTimestamp(at)?Math.floor((Date.parse(at)+330*60000)/86400000):NaN;
function matchesStory(ipo, filter, now) {
 const t=ipo.timeline;
 if(!validTimestamp(now))return false;
 if(filter==='upcoming')return getLifecycle(ipo,now).status==='upcoming';
 if(filter==='open')return getLifecycle(ipo,now).status==='open';
 if(filter==='closing')return Boolean(t.closesAt)&&day(t.closesAt)===day(now);
 if(filter==='allotment'){const at=t.allotmentPublishedAt;return Boolean(at)&&Date.parse(at)<=Date.parse(now)&&day(at)>=day(now)-2&&day(at)<=day(now);}
 if(filter==='listing'){const at=t.listedAt||t.listingExpectedAt;return Boolean(at)&&day(at)>=day(now)&&day(at)<=day(now)+1;}
 return true;
}
function formatLiveClock(now=new Date()) {return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);}

return {matchesStory,formatLiveClock};})();
modules["src/storage/social.js"]=(()=>{const KEY='ipo-radar.personal-social.v1';
function createSocialStore(storage) {
 if(storage===undefined){try{storage=window.localStorage;}catch{storage=null;}}
 let state={},warning=null,raw=null,blocked=false;
 const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([id,item])=>id.length<150&&item&&typeof item.liked==='boolean'&&Array.isArray(item.comments)&&item.comments.length<=100&&item.comments.every(c=>typeof c.text==='string'&&c.text.length>0&&c.text.length<=1000&&Number.isFinite(Date.parse(c.at))));
 try{raw=storage?.getItem(KEY)||null;if(raw){const parsed=JSON.parse(raw);if(raw.length>500000||!valid(parsed))throw new Error();state=parsed;}}catch{blocked=true;warning='Personal reactions could not be read. Existing data is preserved.';}
 const get=id=>JSON.parse(JSON.stringify(state[id]||{liked:false,comments:[]}));
 function update(id,change){if(blocked)throw new Error(warning);const next={...state,[id]:change(get(id))};const encoded=JSON.stringify(next);if(encoded.length>500000)throw new Error('Personal reactions storage is full.');if(storage){if(storage.getItem(KEY)!==raw)throw new Error('Reactions changed in another tab. Reload before editing.');storage.setItem(KEY,encoded);raw=encoded;}else warning='Browser storage is unavailable; reactions last for this session.';state=next;return get(id);}
 return {get,getWarning:()=>warning,toggleLike:id=>update(id,item=>({...item,liked:!item.liked})),addComment(id,text){text=text.trim();if(!text||text.length>1000)throw new Error('Write a comment of 1–1,000 characters.');return update(id,item=>{if(item.comments.length>=100)throw new Error('This IPO has reached the 100 personal-comment limit.');return {...item,comments:[...item.comments,{text,at:new Date().toISOString()}]};});}};
}

return {createSocialStore};})();
modules["src/domain/feed-order.js"]=(()=>{const {getLifecycle}=modules["src/domain/lifecycle.js"];
const {validTimestamp}=modules["src/domain/validation.js"];
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
const day = value => validTimestamp(value) ? dayFormat.format(new Date(value)) : null;
// Attention scores are comparable only when measured using the same method.
function attention(ipo, now) {
  const buzz = ipo.buzz;
  if (!buzz || !Number.isFinite(buzz.score) || !buzz.sourceIds?.length || !validTimestamp(buzz.observedAt)) return null;
  const age = Date.parse(now) - Date.parse(buzz.observedAt);
  return age >= 0 && age <= 86400000 ? buzz : null;
}
function sortFeed(ipos, now) {
  const today = day(now);
  const methods = new Map();
  for (const ipo of ipos) {
    const closing = day(ipo.timeline?.closesAt), value = attention(ipo, now);
    if (closing && value) { if (!methods.has(closing)) methods.set(closing, new Set()); methods.get(closing).add(value.method); }
  }
  function key(ipo) {
    const closeDay = day(ipo.timeline?.closesAt);
    const state = getLifecycle(ipo, now).status;
    if (state === 'unknown') return [4, Infinity];
    if (closeDay && closeDay === today) return [0, 0];
    if (state === 'open') return [1, Date.parse(ipo.timeline.closesAt)];
    if (state === 'upcoming') return [2, Date.parse(ipo.timeline.opensAt)];
    return [3, validTimestamp(ipo.timeline.closesAt) ? -Date.parse(ipo.timeline.closesAt) : Infinity];
  }
  return [...ipos].sort((a,b) => {
    const ka=key(a), kb=key(b);
    if (ka[0] !== kb[0]) return ka[0]-kb[0];
    const closeA=day(a.timeline?.closesAt), closeB=day(b.timeline?.closesAt);
    if (closeA && closeA === closeB) {
      const ba=attention(a,now), bb=attention(b,now);
      if (methods.get(closeA)?.size === 1) {
        if (Boolean(ba) !== Boolean(bb)) return ba ? -1 : 1;
        if (ba && bb && ba.score !== bb.score) return bb.score-ba.score;
      }
    }
    return ka[1]-kb[1] || a.issuer.localeCompare(b.issuer,'en') || a.id.localeCompare(b.id);
  });
}

return {sortFeed};})();
modules["src/components/search-suggestions.js"]=(()=>{function attachSearchSuggestions(input, ipos, {onChange, onSelect}) {
  const list = document.createElement('ul');
  list.id = 'issuer-suggestions'; list.className = 'search-suggestions'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Matching IPOs'); list.hidden = true;
  input.parentElement.append(list);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
  let matches = [], active = -1;
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function select(index) { const ipo = matches[index]; if (!ipo) return; input.value = ipo.issuer; close(); onSelect(ipo); }
  function highlight(index) { active = index; [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === active))); if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({block: 'nearest'}); } }
  function show() {
    const query = input.value.trim().toLocaleLowerCase();
    matches = query ? ipos.filter(ipo => ipo.issuer.toLocaleLowerCase().includes(query)) : [];
    list.replaceChildren(); active = -1; input.removeAttribute('aria-activedescendant');
    matches.forEach((ipo, index) => { const node = document.createElement('li'); node.id = `issuer-option-${index}`; node.textContent = ipo.issuer; node.setAttribute('role', 'option'); node.setAttribute('aria-selected', 'false'); node.addEventListener('pointerdown', event => event.preventDefault()); node.addEventListener('click', () => select(index)); list.append(node); });
    list.hidden = !matches.length; input.setAttribute('aria-expanded', String(matches.length > 0));
  }
  input.addEventListener('input', () => { onChange(); show(); });
  input.addEventListener('focus', show);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (list.hidden) show(); if (!matches.length) return; highlight(event.key === 'ArrowDown' ? (active + 1) % matches.length : (active < 0 ? matches.length - 1 : (active - 1 + matches.length) % matches.length)); }
    if (event.key === 'Enter' && !list.hidden && active >= 0) { event.preventDefault(); select(active); }
  });
  return {close, update(next){ipos=next;close();}};
}

return {attachSearchSuggestions};})();
modules["src/domain/sharing.js"]=(()=>{function shareLinks(text, url, caption) {
 return {whatsapp:'https://wa.me/?text='+encodeURIComponent(text+'\n\n'+url), x:'https://twitter.com/intent/tweet?'+new URLSearchParams({text:caption.slice(0,220),url}).toString()};
}
function isLocalShare(url) {
 const parsed=new URL(url),host=parsed.hostname;
 return parsed.protocol==='file:'||host==='localhost'||host==='[::1]'||/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

return {shareLinks,isLocalShare};})();
modules["src/domain/research-actions.js"]=(()=>{const istDay = value => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function closingDayCountdown(ipo, now, state) {
 if(state.status!=='open'||!ipo.timeline.closesAt||istDay(now)!==istDay(ipo.timeline.closesAt))return null;
 const minutes=Math.ceil((Date.parse(ipo.timeline.closesAt)-Date.parse(now))/60000);
 if(minutes<=0)return null;
 const hours=Math.floor(minutes/60), remainder=minutes%60;
 return `Closes today · ${hours?hours+'h ':''}${remainder}m left`;
}
function swipeDirection(dx,dy) {return Math.abs(dx)>=40&&Math.abs(dx)>Math.abs(dy)*1.4?(dx<0?1:-1):0;}
async function shareResearch(payload, share) {
 if(typeof share!=='function')return 'fallback';
 try{await share(payload);return 'shared';}catch(error){return error?.name==='AbortError'?'cancelled':'fallback';}
}

return {closingDayCountdown,swipeDirection,shareResearch};})();
modules["src/domain/clipboard.js"]=(()=>{// Return false for unavailable or denied clipboard access so callers can offer manual copying.
async function copyText(text, clipboard) {
  try {
    if (typeof clipboard?.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch { return false; }
}

return {copyText};})();
modules["src/components/share-menu.js"]=(()=>{const {shareLinks,isLocalShare}=modules["src/domain/sharing.js"];
const {shareResearch}=modules["src/domain/research-actions.js"];
const {copyText}=modules["src/domain/clipboard.js"];
function openShareMenu(payload,caption) {
 const trigger=document.activeElement;
 const make=(tag,text)=>{const element=document.createElement(tag);if(text)element.textContent=text;return element;};
 const dialog=make('dialog');dialog.className='share-dialog platform-share';dialog.setAttribute('aria-labelledby','share-title');
 const heading=make('h2',payload.title);heading.id='share-title';
 const intro=make('p','Good research starts a better conversation. Choose where to share it.');
 const reasonLabel=make('label','Why I’m sharing this (optional)');const reason=make('input');reason.maxLength=240;reason.placeholder='Thought you’d find this worth a closer look…';reasonLabel.append(reason);
 const previewLabel=make('label','Message preview');const preview=make('textarea');preview.readOnly=true;preview.rows=5;previewLabel.append(preview);
 const destinations=make('div');destinations.className='share-destinations';
 const whatsapp=make('a','WhatsApp');const x=make('a','X');for(const link of [whatsapp,x]){link.target='_blank';link.rel='noopener noreferrer';}
 const instagram=make('button','Instagram · copy for DM');instagram.type='button';
 const native=make('button','More apps…');native.type='button';
 const feedback=make('p');feedback.setAttribute('role','status');
 const copy=make('button','Copy message & link');copy.type='button';copy.className='share-copy';
 const close=make('button','Close');close.type='button';close.onclick=()=>dialog.close();
 const message=()=>payload.text+(reason.value.trim()?'\n\nWhy I’m sharing: '+reason.value.trim():'');
 const update=()=>{preview.value=message()+'\n\n'+payload.url;const links=shareLinks(message(),payload.url,caption+(reason.value.trim()?' — '+reason.value.trim():''));whatsapp.href=links.whatsapp;x.href=links.x;};reason.oninput=update;update();
 const copyMessage=async instagramMode=>{if(await copyText(preview.value,navigator.clipboard))feedback.textContent=instagramMode?'Copied. Open Instagram and paste into a direct message.':'Copied. Paste into any conversation.';else{preview.focus();preview.select();feedback.textContent='Select and copy the message, then paste into your preferred app.';}};
 copy.onclick=()=>copyMessage(false);instagram.onclick=()=>copyMessage(true);
 native.onclick=async()=>{const result=await shareResearch({...payload,text:message()},navigator.share?.bind(navigator));feedback.textContent=result==='shared'?'Shared through your device.':result==='cancelled'?'Sharing cancelled. Choose another destination when ready.':'Device sharing is unavailable here. Choose WhatsApp, X or copy the message.';};
 destinations.append(whatsapp,x,instagram,native);dialog.append(heading,intro,reasonLabel,previewLabel,destinations);
 if(isLocalShare(payload.url)){const notice=make('p','Local preview link: recipients need access to this computer’s preview address. Public links become available after hosting.');notice.className='share-local-notice';dialog.append(notice);}
 dialog.append(feedback,copy,close);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});});dialog.showModal();whatsapp.focus();
}

return {openShareMenu};})();
modules["src/domain/financial-story.js"]=(()=>{const definitions=[
 ['revenue','Sales','Business performance','Sales generated by the business; growth alone does not establish profitability.'],
 ['profit','Net profit','Business performance','Earnings after tax; check whether accounting profits also turn into cash.'],
 ['pat','Net profit','Business performance','Earnings after tax; check whether accounting profits also turn into cash.'],
 ['ebitda','EBITDA','Operating performance','Earnings before interest, tax, depreciation and amortisation; this is not cash flow.'],
 ['operating_ebitda','Operating EBITDA','Operating performance','Operating earnings before interest, tax, depreciation and amortisation; not cash flow.'],
 ['total_income','Total income','Operating performance','Includes sales and other disclosed income; check how much comes from core operations.'],
 ['cash_flow','Operating cash flow','Cash & funding','Cash generated by operations; helps assess funding needs beyond reported profit.'],
 ['debt','Borrowings','Cash & funding','Debt adds repayment and interest commitments; read it alongside cash generation.'],
 ['net_worth','Net worth','Financial position','The shareholder equity buffer; it is not the market value of the business.'],
 ['assets','Total assets','Financial position','Resources on the balance sheet; asset size alone does not establish returns.'],
 ['diluted_eps','Diluted EPS','Per-share figures','Earnings per share including potential dilution; useful when assessing the offer price.'],
 ['nav','Book value / share','Per-share figures','Net asset value per share; this is an accounting measure, not a market-price estimate.'],
 ['pe_upper_band','P/E at upper band','Valuation & returns','Offer price per ₹1 of annual diluted earnings; compare growth, risks and peers.'],
 ['ronw','Return on net worth','Valuation & returns','Issuer-defined return on shareholder funds; interim figures are not annualised.']
];
function financialPeriod(period=''){
 let m=period.match(/^(?:(H[12]|Q[1-4]))?(FY|CY)(\d{4})$/i);
 if(m){const [,part='',calendar,yearText]=m,year=Number(yearText),fy=calendar.toUpperCase()==='FY';let month=12,dateYear=year;
  if(fy){month=3;if(part){month=part[0].toUpperCase()==='H'?Number(part[1])*6:Number(part[1])*3;month=(month+2)%12+1;dateYear=month>3?year-1:year;}}
  else if(part)month=part[0].toUpperCase()==='H'?Number(part[1])*6:Number(part[1])*3;
  return {kind:(part+calendar).toUpperCase(),year,order:Date.UTC(dateYear,month,0),annual:!part,label:(part?part.toUpperCase()+' ':'')+calendar.toUpperCase()+' '+year};
 }
 m=period.match(/^ASOF(\d{4})-(\d{2})-(\d{2})$/i);
 if(m)return {kind:'ASOF-'+m[2]+'-'+m[3],year:Number(m[1]),order:Date.parse(m[1]+'-'+m[2]+'-'+m[3]+'T00:00:00Z'),annual:false,label:'At '+new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(m[1]+'-'+m[2]+'-'+m[3]+'T00:00:00Z'))};
 return {kind:null,year:null,order:0,annual:false,label:period||'Period unavailable'};
}
function financialValue(observation){
 if(!observation||!Number.isFinite(observation.value))return 'Unavailable';
 const value=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(observation.value);
 return observation.unit==='INR_cr'?'₹'+value+' cr':observation.unit==='INR'?'₹'+value:observation.unit==='percent'?value+'%':observation.unit==='multiple'?value+'×':value+' '+observation.unit;
}
function financialStories(observations=[]){
 const groups=new Map();
 for(const o of observations.filter(o=>!o.key.startsWith('subscription'))){
  const base=o.key.replace(/_(?:(?:h[12]|q[1-4])?(?:fy|cy)|asof)\d.*$/i,'');
  const key=base+'|'+o.unit+'|'+o.label; if(!groups.has(key))groups.set(key,{base,observations:[]});groups.get(key).observations.push(o);
 }
 return [...groups.values()].map(group=>{
  const rows=[...group.observations].sort((a,b)=>financialPeriod(b.period).order-financialPeriod(a.period).order);
  const priorFor=o=>rows.find(p=>p!==o&&financialPeriod(p.period).kind&&financialPeriod(p.period).kind===financialPeriod(o.period).kind&&financialPeriod(p.period).year===financialPeriod(o.period).year-1&&Number.isFinite(p.value));
  const newest=rows[0];let current=newest;
  if(!priorFor(current)){const annual=rows.find(o=>financialPeriod(o.period).annual&&priorFor(o));if(annual)current=annual;}
  const conflicted=rows.some((o,i)=>rows.slice(i+1).some(p=>p.period===o.period&&p.value!==o.value));
  const prior=conflicted?null:priorFor(current)||null,definition=definitions.find(d=>group.base===d[0]||group.base.startsWith(d[0]+'_'));
  const scope=group.base.includes('discontinued')?' · discontinued':group.base.includes('continuing')?' · continuing':group.base.includes('icdr')?' · regulatory basis':group.base==='debt'&&newest.label.includes('lease')?' · incl. leases':'';
  let change=null;
  if(prior&&Number.isFinite(current.value)){
   if(current.unit==='percent')change={value:current.value-prior.value,unit:'pp'};
   else if(prior.value>0)change={value:(current.value-prior.value)/prior.value*100,unit:'%'};
  }
  return {title:(definition?.[1]||newest.label)+scope,section:definition?.[2]||'Other financials',meaning:conflicted?'Conflicting values for the same period; review the source documents before comparing.':definition?.[3]||'Read this issuer-disclosed measure alongside its definition and reporting period.',current,prior,recent:!conflicted&&current!==newest?newest:null,change,conflicted,observations:rows};
 });
}

return {financialPeriod,financialValue,financialStories};})();
modules["src/components/ipo-card.js"]=(()=>{const {financialStories,financialPeriod,financialValue}=modules["src/domain/financial-story.js"];
const {getLifecycle}=modules["src/domain/lifecycle.js"];
const {closingDayCountdown,swipeDirection}=modules["src/domain/research-actions.js"];
const compactDates=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short'});
const dates = new Intl.DateTimeFormat('en-IN', {timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
const dayDates=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});
const money = new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:0});
function el(tag,text,className) {const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node;}
function formatDate(value) {return value && Number.isFinite(Date.parse(value)) ? dates.format(new Date(value))+' IST' : 'Unavailable';}
function safeLink(label,url) {let parsed;try{parsed=new URL(url);}catch{return el('span',label+': Unavailable');}if(parsed.protocol!=='https:'||parsed.username||parsed.password)return el('span',label+': Unavailable');const a=el('a',label+' ↗');a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',label+' (opens in a new tab)');return a;}
function metric(label,value){const item=el('div',undefined,'metric');item.append(el('dt',label),el('dd',value));return item;}
function observationValue(o){if(o.value===null)return 'Unavailable';return o.unit==='INR_cr'?`₹${o.value.toLocaleString('en-IN')} crore`:o.unit==='multiple'?`${o.value}×`:o.unit==='percent'?`${o.value}%`:`${o.value} ${o.unit}`;}
function sourceLine(ipo,ids,at){if(ipo.verification==='unverified'){const times=(ids||[]).map(id=>ipo.sources.find(s=>s.id===id)?.observedAt).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));at=times.at(-1)||null;}const line=el('details',undefined,'source-line');line.append(el('summary','Sources · As of '+(at&&ipo.timelinePrecision==='date'?dayDates.format(new Date(at))+' IST':formatDate(at))));for(const id of ids || []){const source=ipo.sources.find(s=>s.id===id);if(source)line.append(source.url?safeLink(source.label,source.url):el('span',source.label));}if(!ids?.length)line.append(el('span','Source: Unavailable'));return line;}
function createIPOCard(ipo,{now=new Date().toISOString(),onSave=()=>{},onShare=()=>{},onLike=()=>{},onComment=()=>{},currentPreview=false}={}) {
 const item=el('li',undefined,'ipo-card');item.id='ipo-'+ipo.id;item.dataset.ipoId=ipo.id;
 const article=el('article');article.setAttribute('aria-labelledby',item.id+'-name');
 const header=el('header',undefined,'card-heading');const mark=el('div',ipo.issuer.slice(0,1),'issuer-mark');mark.setAttribute('aria-hidden','true');mark.dataset.issuer=ipo.id;const identity=el('div');const heading=el('h3',ipo.issuer);heading.id=item.id+'-name';identity.append(heading,el('p',ipo.sector || 'Sector unavailable'));const badge=el('span',undefined,'lifecycle');header.append(mark,identity,badge);
 const lifecycle=el('p',undefined,'countdown');const label=el('p',ipo.isDemo?'Fictional issuer · Demo figures':ipo.verification==='unverified'?(currentPreview?'Current official discovery · Partial coverage':'Engine preview · Partial extraction · Not current fundamentals'):`Historical archive · ${ipo.verification} · Not current fundamentals`,'data-label');
 const timeline=el('dl',undefined,'issue-dates');timeline.setAttribute('aria-label','IPO dates in IST');const years=[...new Set(Object.values(ipo.timeline).filter(Boolean).map(date=>new Intl.DateTimeFormat('en',{timeZone:'Asia/Kolkata',year:'numeric'}).format(new Date(date))))];timeline.append(el('div',`IPO DATES · ${years.join(' / ')} · IST`,'dates-caption'));for(const [name,date,state] of [['Opens',ipo.timeline.opensAt,null],['Closes',ipo.timeline.closesAt,null],['Allotment',ipo.timeline.allotmentPublishedAt||ipo.timeline.allotmentExpectedAt,ipo.timeline.allotmentPublishedAt?'Confirmed publication':'Scheduled'],['Listing',ipo.timeline.listedAt||ipo.timeline.listingExpectedAt,ipo.timeline.listedAt?'Confirmed listing':'Scheduled']]){const row=metric(name,date?compactDates.format(new Date(date)):'Unavailable');if(date){const fullDate=ipo.timelinePrecision==='date'?dayDates.format(new Date(date))+' IST':formatDate(date);row.lastChild.title=fullDate+(state?' · '+state:'');row.lastChild.setAttribute('aria-label',fullDate+(state?' · '+state:''));}if(date&&state)row.lastChild.append(el('span',state.startsWith('Confirmed')?'✓':'est.','date-state'));timeline.append(row);}
 const slider=el('div',undefined,'carousel');slider.id=item.id+'-slides';slider.tabIndex=0;slider.setAttribute('role','region');slider.setAttribute('aria-roledescription','carousel');slider.setAttribute('aria-label',`${ipo.issuer} details; use arrow keys or swipe`);
 const slide=(title)=>{const panel=el('section',undefined,'carousel-slide');panel.append(el('p','ISSUE DETAILS','eyebrow'),el('h4',title));slider.append(panel);return panel;};
 const offer=slide('The issue at a glance');offer.prepend(timeline);offer.insertBefore(lifecycle,timeline.nextSibling);const metrics=el('dl',undefined,'metrics');metrics.append(metric('Price band',ipo.priceBand?`${money.format(ipo.priceBand.min)} – ${money.format(ipo.priceBand.max)}`:'Unavailable'),metric('Lot size',ipo.lotSize===null?'Unavailable':`${ipo.lotSize} shares`),metric('Minimum amount',ipo.priceBand&&ipo.lotSize?money.format(ipo.priceBand.max*ipo.lotSize):'Unavailable'),metric(ipo.isDemo?'Issue size':ipo.issueSizeCr===null&&ipo.offerTerms?'Offer ceiling · upper band':'Offer amount · source snapshot',ipo.issueSizeCr===null?(ipo.offerTerms?`≤ ₹${ipo.offerTerms.ceilingCr.toLocaleString('en-IN',{maximumFractionDigits:3})} crore`:'Unavailable'):`₹${ipo.issueSizeCr.toLocaleString('en-IN')} crore`));offer.append(metrics,el('p',ipo.composition?`Fresh issue ≈${Number(ipo.composition.freshPercent.toFixed(1))}% · Offer for sale ≈${Number(ipo.composition.ofsPercent.toFixed(1))}% of offer proceeds`:ipo.offerTerms?`At the upper-band ceiling: fresh ≈${ipo.offerTerms.freshPercentAtCeiling.toFixed(1)}% · OFS ≈${ipo.offerTerms.ofsPercentAtCeiling.toFixed(1)}%`:'Issue composition: Unavailable','composition'),sourceLine(ipo,ipo.sourceIds,ipo.updatedAt));
 if(ipo.offerTerms?.basis==='calculated_upper_band_ceiling')offer.append(el('p','Calculated from disclosed terms at the upper band; discounts are not deducted. Final proceeds remain pending.','muted calculation-note'));
 const business=slide('Business & people');business.append(el('p',ipo.business||'Business: Unavailable'),el('h5','Promoters'),el('p',ipo.promoters?.length?ipo.promoters.join(', '):'Unavailable'),sourceLine(ipo,ipo.sourceIds,ipo.updatedAt));
 const stories=financialStories(ipo.observations);const financialPanels=[];const sections=[...new Set(stories.map(s=>s.section))];
 if(!stories.length){const panel=slide('Financials & valuation');panel.classList.add('financial-slide');panel.append(el('p','Financial information is not available from the current sources.'));financialPanels.push(panel);}
 for(const section of sections){const metrics=stories.filter(s=>s.section===section);for(let offset=0;offset<metrics.length;offset+=2){const panel=slide(section);panel.classList.add('financial-slide');financialPanels.push(panel);for(const story of metrics.slice(offset,offset+2)){const tile=el('section',undefined,'financial-tile');const heading=el('div',undefined,'financial-heading');heading.append(el('h5',story.title));if(story.change){const change=story.change.value;heading.append(el('span',`${change>0?'+':''}${change.toFixed(1)}${story.change.unit}${story.change.unit==='%'?' YoY':''}`,'financial-change'));}tile.append(heading);const pair=el('dl',undefined,'financial-pair');pair.append(metric(financialPeriod(story.current.period).label,story.conflicted?'Conflicting values':financialValue(story.current)),metric(story.prior?financialPeriod(story.prior.period).label:'Prior comparable',financialValue(story.prior)));tile.append(pair,el('p',story.meaning,'financial-meaning'));if(story.recent)tile.append(el('p',`Latest ${financialPeriod(story.recent.period).label}: ${financialValue(story.recent)}${/^[HQ]/.test(story.recent.period)?' · not annualised':''}`,'financial-recent'));for(const o of story.observations)tile.append(sourceLine(ipo,o.sourceIds,o.observedAt));panel.append(tile);}}}
 const subscription=slide('Subscription snapshot');const subs=ipo.observations.filter(o=>o.key.startsWith('subscription'));if(!subs.length)subscription.append(el('p','Subscription: Unavailable'));for(const o of subs){subscription.append(el('p',o.label),el('strong',observationValue(o)),sourceLine(ipo,o.sourceIds,o.observedAt));}subscription.append(el('p','Subscription is demand at the observation time; it does not predict returns.','muted'));
 const evidence=slide('Evidence & risks');evidence.append(el('p','Read the facts alongside editorial questions. Sources and observation times remain visible.','muted'));if(!ipo.notes.length)evidence.append(el('p','Risk notes and analysis: Unavailable'));for(const note of ipo.notes){const block=el('div',undefined,'evidence-note '+note.kind);block.append(el('span',note.kind==='fact'?'FACT':'EDITORIAL ANALYSIS','eyebrow'),el('p',note.text),sourceLine(ipo,note.sourceIds,note.observedAt));evidence.append(block);}
 const controls=el('div',undefined,'carousel-controls');const index=el('span','1 / 5','slide-counter');index.setAttribute('aria-live','polite');const dots=el('div',undefined,'carousel-dots');dots.setAttribute('aria-label','Choose research slide');controls.append(dots,index);let current=0;const panels=[...slider.children];const dotButtons=panels.map((panel,i)=>{const dot=el('button');dot.type='button';dot.setAttribute('aria-label',`Slide ${i+1}: ${panel.querySelector('h4').textContent}`);dot.onclick=()=>go(i-current);dots.append(dot);return dot;});const sync=()=>{index.textContent=`${current+1} / ${panels.length}`;controls.dataset.slide=String(current+1);panels.forEach((panel,i)=>{panel.inert=i!==current;panel.setAttribute('aria-hidden',String(i!==current));panel.setAttribute('role','group');panel.setAttribute('aria-roledescription','slide');panel.setAttribute('aria-label',`${i+1} of ${panels.length}`);dotButtons[i].setAttribute('aria-pressed',String(i===current));dotButtons[i].hidden=panels.length>7&&Math.abs(i-Math.max(3,Math.min(panels.length-4,current)))>3;});};const go=delta=>{const target=Math.max(0,Math.min(panels.length-1,current+delta));slider.scrollTo({left:target*slider.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};slider.addEventListener('scroll',()=>{current=Math.max(0,Math.min(panels.length-1,Math.round(slider.scrollLeft/Math.max(1,slider.clientWidth))));sync();},{passive:true});slider.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(e.key==='ArrowLeft'?-1:1);}});let gesture=null;slider.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||!e.isPrimary||e.button!==0||e.target.closest('a,button,input,summary'))return;gesture={x:e.clientX,y:e.clientY,id:e.pointerId,left:slider.scrollLeft,index:current};});slider.addEventListener('pointermove',e=>{if(!gesture||gesture.id!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(!gesture.horizontal&&Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.4){gesture.horizontal=true;slider.setPointerCapture(e.pointerId);slider.classList.add('mouse-dragging');}if(gesture.horizontal){if(e.cancelable)e.preventDefault();slider.scrollLeft=gesture.left-dx;}});slider.addEventListener('pointerup',e=>{if(!gesture||gesture.id!==e.pointerId)return;const delta=swipeDirection(e.clientX-gesture.x,e.clientY-gesture.y),target=gesture.index+delta;gesture=null;slider.classList.remove('mouse-dragging');if(slider.hasPointerCapture(e.pointerId))slider.releasePointerCapture(e.pointerId);go(target-current);});slider.addEventListener('pointercancel',()=>{gesture=null;slider.classList.remove('mouse-dragging');go(0);});if(typeof ResizeObserver==='function')new ResizeObserver(()=>slider.scrollTo({left:current*slider.clientWidth,behavior:'instant'})).observe(slider);sync();
 const refs=el('details',undefined,'company-links');refs.setAttribute('aria-label','Company and source documents');refs.append(el('summary','Company & offer documents'),ipo.companyWebsite?safeLink('Company website',ipo.companyWebsite):el('span','Company website: Unavailable'));if(ipo.documents.length)for(const doc of ipo.documents)refs.append(safeLink(doc.label,doc.url));else refs.append(el('span','Offer documents, exchange notices & registrar: Unavailable'));
 const researchSources=el('details',undefined,'research-sources');researchSources.append(el('summary','Sources & observation dates'));const uniqueSources=new Map();for(const panel of panels){for(const line of panel.querySelectorAll('.source-line')){const key=line.textContent+'|'+[...line.querySelectorAll('a')].map(a=>a.href).join('|');if(!uniqueSources.has(key))uniqueSources.set(key,line);line.remove();}}for(const line of uniqueSources.values())researchSources.append(line);evidence.append(refs,researchSources);const history=el('details',undefined,'financial-history');history.append(el('summary','All disclosed financial periods'));for(const story of stories){history.append(el('h5',story.title));const table=el('dl');for(const o of story.observations)table.append(metric(financialPeriod(o.period).label,financialValue(o)));history.append(table);}if(stories.length)evidence.append(history);
 const actions=el('div',undefined,'card-actions');const action=(name,paths,className)=>{const button=el('button',undefined,className);button.type='button';button.setAttribute('aria-label',name+' '+ipo.issuer);button.title=name;button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+paths+'</svg>';return button;};const like=action('Like','<path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.543 1.117 1.543s.277-.368 1.117-1.543a4.21 4.21 0 0 1 3.675-1.941z"/>','like-button');like.onclick=()=>onLike(ipo.id);const comment=action('Comment on','<path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z"/>','comment-button');comment.setAttribute('aria-disabled','true');comment.title='Comments coming soon';comment.onclick=()=>{};const share=action('Share','<line x1="22" x2="9.218" y1="3" y2="10.083"/><polygon points="11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334"/>','share-button');share.onclick=()=>onShare(ipo.id);const save=action('Save','<polygon points="20 21 12 13.44 4 21 4 3 20 3 20 21"/>','save-button');save.onclick=()=>onSave(ipo.id);actions.append(like,comment,share,save);
 article.append(header,label,slider,controls,actions);item.append(article);
 item.setSaved=saved=>{save.setAttribute('aria-label',saved?'Remove '+ipo.issuer+' from watchlist':'Save '+ipo.issuer+' to watchlist');save.setAttribute('aria-pressed',String(saved));};item.setSocial=state=>{like.setAttribute('aria-pressed',String(state.liked));like.setAttribute('aria-label',(state.liked?'Unlike ':'Like ')+ipo.issuer);comment.setAttribute('aria-label','Comments coming soon for '+ipo.issuer);};item.setEvidence=enabled=>{item.classList.toggle('evidence-active',enabled);if(enabled){current=panels.length-1;slider.scrollTo({left:current*slider.clientWidth,behavior:'instant'});sync();}};item.updateLifecycle=clock=>{const state=getLifecycle(ipo,clock);badge.textContent=state.label;badge.dataset.status=state.status;const countdown=closingDayCountdown(ipo,clock,state);lifecycle.textContent=countdown||'';lifecycle.hidden=!countdown;item.dataset.lifecycle=state.status;};item.updateLifecycle(now);item.setSaved(false);return item;
}

return {el,formatDate,createIPOCard};})();
modules["src/storage/records.js"]=(()=>{const {validateUserRecords, validTimestamp}=modules["src/domain/validation.js"];
const RECORDS_KEY = 'ipo-radar.records.v1';
const MAX_SIZE = 2_000_000;
const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({schemaVersion: 1, records: []});
const istDay = at => { const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(at)); const part = name => parts.find(item => item.type === name).value; return `${part('year')}-${part('month')}-${part('day')}`; };
function recordSummary(state) {
  return {saved: state.records.filter(r => r.savedAt).length, applied: state.records.filter(r => r.application).length, allotted: state.records.filter(r => r.application?.outcome === 'allotted').length};
}
function createRecordStore({schema, catalogue, storage, now = () => new Date().toISOString()}) {
  let state = empty(), warning = null, raw = null, blocked = false;
  const listeners = new Set();
  if (storage === undefined) { try { storage = globalThis.window?.localStorage ?? null; } catch { storage = null; } }
  if (!storage) warning = 'Storage is unavailable. Changes last only for this session; export a backup before leaving.';
  const stamp = () => { const at = now(); if (!validTimestamp(at)) throw new Error('The current time is invalid.'); return at; };
  function validate(data) {
    const errors = validateUserRecords(data, schema, catalogue);
    if (data?.records?.length > 10000) errors.push('Too many personal records.');
    if (JSON.stringify(data)?.length > MAX_SIZE - 512) errors.push('Personal records exceed the 2 MB backup limit.');
    const at = stamp();
    for (const r of data?.records || []) {
      if (Date.parse(r.updatedAt) > Date.parse(at) || (r.savedAt && Date.parse(r.savedAt) > Date.parse(at))) errors.push('Record timestamps cannot be in the future.');
      if (r.application?.appliedOn > istDay(at)) errors.push('Application dates cannot be in the future.');
    }
    if (errors.length) throw new Error(errors.slice(0, 3).join(' '));
  }
  if (storage) {
    try { raw = storage.getItem(RECORDS_KEY); if (raw !== null) { if (raw.length > MAX_SIZE) throw new Error(); const parsed = JSON.parse(raw); validate(parsed); state = parsed; } }
    catch { blocked = true; warning = 'Stored records could not be read or validated. They have been preserved. Export a recovery file if available, then explicitly clear stored data before making changes.'; }
  }
  function publish(next, {recover = false} = {}) {
    validate(next);
    if (blocked && !recover) throw new Error(warning);
    if (storage) {
      try {
        const current = storage.getItem(RECORDS_KEY);
        if (current !== raw && !recover) throw new Error('Records changed in another tab. Reload before editing to avoid overwriting them.');
        const nextRaw = JSON.stringify(next);
        storage.setItem(RECORDS_KEY, nextRaw);
        raw = nextRaw;
      } catch (error) { warning = error.message.includes('another tab') ? error.message : 'Saving failed. No changes were applied. Export a backup and free browser storage, then retry.'; throw new Error(warning); }
    }
    state = clone(next); blocked = false;
    warning = storage ? null : 'Storage is unavailable. Changes last only for this session; export a backup before leaving.';
    for (const listener of listeners) listener(clone(state));
    return clone(state);
  }
  function update(ipoId, mutate) {
    const next = clone(state); let record = next.records.find(r => r.ipoId === ipoId);
    if (!record) { record = {ipoId, savedAt: null, application: null, updatedAt: stamp()}; next.records.push(record); }
    mutate(record); record.updatedAt = stamp();
    next.records = next.records.filter(r => r.savedAt || r.application);
    return publish(next);
  }
  return {
    getState: () => clone(state), getWarning: () => warning,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isSaved: ipoId => Boolean(state.records.find(r => r.ipoId === ipoId)?.savedAt),
    toggleSaved: ipoId => update(ipoId, r => { r.savedAt = r.savedAt ? null : stamp(); }),
    upsertApplication: (ipoId, application) => update(ipoId, r => { r.application = clone(application); }),
    removeApplication: ipoId => update(ipoId, r => { r.application = null; }),
    exportBackup: () => { if (blocked) throw new Error('A validated backup is unavailable. Use the recovery-file export to preserve unreadable stored data.'); return JSON.stringify({app: 'ipo-radar', backupVersion: 1, exportedAt: stamp(), data: clone(state)}); },
    exportRecovery: () => raw,
    importBackup(text, {mode} = {}) {
      if (typeof text !== 'string' || text.length > MAX_SIZE) throw new Error('Backup must be a JSON file smaller than 2 MB.');
      if (!['merge', 'replace'].includes(mode)) throw new Error('Choose merge or replace.');
      let backup; try { backup = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
      if (!backup || typeof backup !== 'object' || Array.isArray(backup) || Object.keys(backup).sort().join(',') !== 'app,backupVersion,data,exportedAt' || backup.app !== 'ipo-radar' || backup.backupVersion !== 1 || !validTimestamp(backup.exportedAt) || Date.parse(backup.exportedAt) > Date.parse(stamp())) throw new Error('Unsupported or invalid IPO Radar backup.');
      validate(backup.data);
      let next = clone(backup.data);
      if (mode === 'merge') {
        const records = new Map(state.records.map(r => [r.ipoId, r]));
        for (const r of next.records) if (!records.has(r.ipoId) || Date.parse(r.updatedAt) > Date.parse(records.get(r.ipoId).updatedAt)) records.set(r.ipoId, r);
        next = {schemaVersion: 1, records: [...records.values()]};
      }
      return publish(next);
    },
    clear: () => publish(empty(), {recover: true})
  };
}

return {RECORDS_KEY,recordSummary,createRecordStore};})();
modules["src/components/records-panel.js"]=(()=>{const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
function createRecordsPanel({store, catalogue, onView = () => {}}) {
  const section = el('section', undefined, 'records-panel');
  section.setAttribute('aria-label', 'My watchlist');
  const title = el('h2', 'My watchlist'), stats = el('div', undefined, 'record-stats'), warning = el('p', undefined, 'record-warning');
  const feedback = el('p', '', 'record-feedback'); feedback.setAttribute('aria-live', 'polite');
  const list = el('div', undefined, 'record-list');
  section.append(title, el('p', 'IPOs you save from the feed appear here. Your watchlist stays in this browser on this device.'), stats, warning, feedback, list);
  const show = text => { feedback.textContent = text; };
  function run(action, success) { try { action(); show(success); } catch (error) { show(error.message); warning.textContent = store.getWarning() || ''; } }
  function render() {
    const state = store.getState(), saved = state.records.filter(record => record.savedAt);
    stats.replaceChildren(el('p', `${saved.length} saved`));
    warning.textContent = store.getWarning() || ''; warning.hidden = !warning.textContent;
    list.replaceChildren(el('h3', 'Saved IPOs'));
    if (!saved.length) list.append(el('p', 'No saved IPOs yet. Save an IPO from the feed to see it here.'));
    for (const record of saved) {
      const issuer = catalogue.ipos.find(ipo => ipo.id === record.ipoId);
      const card = el('article', undefined, 'record-card'); card.append(el('h4', issuer?.issuer || `Missing issuer: ${record.ipoId}`));
      if (!issuer) card.append(el('p', 'This issuer is absent from the current catalogue. Its saved record is kept in this browser.'));
      if (record.savedAt) card.append(el('p', 'Saved to watchlist'));
      const actions = el('div', undefined, 'record-actions');
      if (issuer) actions.append(button('View IPO', () => onView(record.ipoId)));
      actions.append(button(record.savedAt ? 'Remove saved IPO' : 'Save IPO', () => run(() => store.toggleSaved(record.ipoId), 'Watchlist updated.')));
      card.append(actions); list.append(card);
    }
  }
  store.subscribe(render); render();
  section.refresh=render;return section;
}

return {createRecordsPanel};})();
(async()=>{const {createConnectedFeed}=modules["src/data/connected-feed.js"];
const {loadEnginePreview,previewStorage}=modules["src/data/engine-preview.js"];
const {matchesStory,formatLiveClock}=modules["src/domain/story-filters.js"];
const {createSocialStore}=modules["src/storage/social.js"];
const {sortFeed}=modules["src/domain/feed-order.js"];
const {attachSearchSuggestions}=modules["src/components/search-suggestions.js"];
const {openShareMenu}=modules["src/components/share-menu.js"];
const {copyText}=modules["src/domain/clipboard.js"];
const {loadCatalogue}=modules["src/data/catalogue.js"];
const {createIPOCard,formatDate}=modules["src/components/ipo-card.js"];
const {createRecordStore}=modules["src/storage/records.js"];
const {createRecordsPanel}=modules["src/components/records-panel.js"];
document.documentElement.classList.toggle('user-view',new URL(location.href).searchParams.get('view')==='user');
const $=selector=>document.querySelector(selector);
const updateClock=()=>{$('#live-clock').textContent=formatLiveClock();$('#live-clock').dateTime=new Date().toISOString();};updateClock();setInterval(updateClock,1000);document.addEventListener('visibilitychange',updateClock);
const status=$('#status');const finder=$('#discovery-dialog');let finderTrigger=null;
function closeFinder(){if(finder.open)finder.close();}
try {
 const requested='live';const mode=['demo','curated','preview','live'].includes(requested)?requested:location.protocol==='file:'?'demo':'live';const connected=mode==='live'?createConnectedFeed():null;const initial=connected?await connected.poll():null;if(connected&&!initial.catalogue)throw Error(initial.message);$('#catalogue-mode').value=mode;$('#catalogue-mode').onchange=()=>{const url=new URL(location.href);url.searchParams.set('catalogue',$('#catalogue-mode').value);url.hash='';location.href=url.href;};$('#engine-preview-notice').hidden=!['preview','live'].includes(mode);const preview=mode==='preview'?await loadEnginePreview():null;const catalogue=initial?.catalogue||(preview?preview.catalogue:await loadCatalogue(mode));let isolatedStorage;if(['preview','live'].includes(mode)){try{isolatedStorage=previewStorage(window.localStorage);}catch{isolatedStorage=null;}}const response=await fetch('./schemas/user-records.schema.json');if(!response.ok)throw new Error('Personal record schema could not load.');const schema=await response.json();const store=createRecordStore({schema,catalogue,...(['preview','live'].includes(mode)?{storage:isolatedStorage}:{})});const clock=()=>catalogue.mode==='demo'?catalogue.referenceAt:new Date().toISOString();
 if(catalogue.mode==='demo')$('#reference-clock').textContent=`Fixed demo clock: ${formatDate(catalogue.referenceAt)} · Catalogue updated ${formatDate(catalogue.updatedAt)}`;else{$('#dataset-badge').textContent='HISTORICAL REFERENCE';$('#dataset-description').textContent=catalogue.datasetLabel||'2024 IPOs · No live market data';$('#reference-clock').textContent=`Sources reflect historical observations · Source review ${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}).format(new Date(catalogue.reviewedAt||catalogue.updatedAt))} · Historical figures are not current fundamentals · Lifecycle uses current IST time`;}
 const cards=new Map();const feed=$('#feed-section'),records=$('#records-section');const announce=message=>{status.textContent=message;};let storyFilter='all';const social=createSocialStore(isolatedStorage);
 function navigate(view){if(view==='records'){suggestions.close();closeFinder();}feed.hidden=view!=='feed';records.hidden=view!=='records';$('#feed-nav').setAttribute('aria-pressed',String(view==='feed'));$('#records-nav').setAttribute('aria-pressed',String(view==='records'));}
 function viewIPO(id){storyFilter='all';navigate('feed');$('#search').value='';$('#lifecycle-filter').value='all';filter();const card=cards.get(id);if(card){card.scrollIntoView({behavior:'smooth',block:'start'});card.querySelector('h3').tabIndex=-1;card.querySelector('h3').focus({preventScroll:true});}else announce('This issue is not present in the current catalogue.');}
 async function share(id){const trigger=document.activeElement;const ipo=catalogue.ipos.find(issue=>issue.id===id);if(!ipo)return;const url=new URL(location.href);url.hash='ipo='+encodeURIComponent(id);const shareDate=date=>ipo.timelinePrecision==='date'&&date?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'}).format(new Date(date))+' IST':formatDate(date);const text=[`${ipo.issuer} · IPO Radar research`,ipo.isDemo?'FICTIONAL DEMO':catalogue.mode==='preview'?catalogue.previewScope==='current'?mode==='live'?'CONNECTED FEED · Official discovery · Partial coverage':'ENGINE PREVIEW · Current official discovery · Partial coverage':'ENGINE PREVIEW · Historical extraction · Partial coverage':'HISTORICAL SNAPSHOT · Not current fundamentals',ipo.priceBand?`Price band: ₹${ipo.priceBand.min}–₹${ipo.priceBand.max} · Lot: ${ipo.lotSize} shares`:'Price band unavailable',`Opens: ${shareDate(ipo.timeline.opensAt)}`,`Closes: ${shareDate(ipo.timeline.closesAt)}`,`Allotment: ${shareDate(ipo.timeline.allotmentPublishedAt||ipo.timeline.allotmentExpectedAt)} (${ipo.timeline.allotmentPublishedAt?'confirmed':'scheduled'})`,`Listing: ${shareDate(ipo.timeline.listedAt||ipo.timeline.listingExpectedAt)} (${ipo.timeline.listedAt?'confirmed':'scheduled'})`,...ipo.notes.map(note=>`${note.kind==='fact'?'FACT':'EDITORIAL ANALYSIS'}: ${note.text}`),'Sources:',...ipo.sources.filter(source=>source.url).map(source=>source.label+': '+source.url),'Research is informational; it does not predict returns.'].join('\n');const payload={title:ipo.issuer+' research · IPO Radar',text,url:url.href};openShareMenu(payload,`${ipo.issuer} · Swipe through IPO research, dates and risks. ${ipo.isDemo?'Fictional demo.':mode==='live'?'Connected official discovery; partial coverage.':'Historical snapshot; not current fundamentals.'}`);}
 function openComments(id){const trigger=document.activeElement;const ipo=catalogue.ipos.find(issue=>issue.id===id);const dialog=document.createElement('dialog');dialog.className='comments-dialog';dialog.setAttribute('aria-labelledby','comments-title');const title=document.createElement('h2');title.id='comments-title';title.textContent=ipo.issuer+' · Your comments';const info=document.createElement('p');info.textContent='Personal comments, saved only in this browser on this device.';const list=document.createElement('div');list.className='personal-comments';const render=()=>{list.replaceChildren();const comments=social.get(id).comments;if(!comments.length){const empty=document.createElement('p');empty.textContent='What stood out in the research?';list.append(empty);}for(const comment of comments){const entry=document.createElement('article');const text=document.createElement('p');text.textContent=comment.text;const time=document.createElement('small');time.textContent=formatDate(comment.at);entry.append(text,time);list.append(entry);}};const label=document.createElement('label');label.textContent='Your comment';const input=document.createElement('textarea');input.maxLength=1000;input.placeholder='Add your take…';input.setAttribute('aria-label','Your comment');label.append(input);const feedback=document.createElement('p');feedback.setAttribute('role','status');const add=document.createElement('button');add.textContent='Add comment';add.type='button';add.onclick=()=>{try{const state=social.addComment(id,input.value);cards.get(id).setSocial(state);input.value='';render();feedback.textContent=social.getWarning()||'Comment saved on this device.';}catch(error){feedback.textContent=error.message;}};const close=document.createElement('button');close.textContent='Close';close.type='button';close.onclick=()=>dialog.close();dialog.append(title,info,list,label,feedback,add,close);document.body.append(dialog);render();dialog.addEventListener('close',()=>{dialog.remove();trigger?.focus({preventScroll:true});});dialog.showModal();input.focus();}
 function renderCards(){cards.clear();$('#catalogue').replaceChildren();for(const ipo of catalogue.ipos){const card=createIPOCard(ipo,{now:clock(),onSave:id=>{try{store.toggleSaved(id);}catch(error){refreshSaved();announce(error.message);}},onShare:share,onComment:openComments,currentPreview:catalogue.previewScope==='current',onLike:id=>{try{const state=social.toggleLike(id);cards.get(id).setSocial(state);announce(social.getWarning()||(state.liked?'Liked on this device.':'Like removed.'));}catch(error){announce(error.message);}}});card.setSocial(social.get(ipo.id));cards.set(ipo.id,card);$('#catalogue').append(card);if(document.body.classList.contains('evidence-mode'))card.setEvidence(true);}}renderCards();
 function filter(){const ordered=sortFeed(catalogue.ipos,clock());if(ordered.some((ipo,i)=>$('#catalogue').children[i]!==cards.get(ipo.id)))for(const ipo of ordered)$('#catalogue').append(cards.get(ipo.id));const query=$('#search').value.trim().toLocaleLowerCase();const stage=$('#lifecycle-filter').value;let count=0;for(const ipo of catalogue.ipos){const card=cards.get(ipo.id);const visible=ipo.issuer.toLocaleLowerCase().includes(query)&&(stage==='all'||card.dataset.lifecycle===stage)&&matchesStory(ipo,storyFilter,clock());card.hidden=!visible;if(visible)count++;}$('#count').textContent=`${count} of ${catalogue.ipos.length} issues`;$('#empty').hidden=count!==0;if(catalogue.previewScope==='current')$('#empty').textContent='No matching IPOs in the available source coverage. Other sources or event dates are unverified; this does not establish that no IPOs exist.';$('#finder-results').textContent=`Show ${count} ${count===1?'IPO':'IPOs'} →`;document.querySelectorAll('.story').forEach(button=>button.setAttribute('aria-pressed',String(button.id===({closing:'story-closing',allotment:'story-allotment',listing:'story-listing'}[storyFilter]||(stage==='open'?'story-open':stage==='upcoming'?'story-upcoming':'story-all')))));}
 function refreshSaved(){for(const [id,card]of cards)card.setSaved(store.isSaved(id));const warning=store.getWarning();$('#storage-warning').hidden=!warning;$('#storage-warning').textContent=warning||'';}
 const recordsPanel=createRecordsPanel({store,catalogue,onView:viewIPO});records.append(recordsPanel);store.subscribe(refreshSaved);refreshSaved();filter();
 const suggestions=attachSearchSuggestions($('#search'),catalogue.ipos,{onChange:filter,onSelect:ipo=>{viewIPO(ipo.id);$('#search').value=ipo.issuer;filter();closeFinder();}});$('#lifecycle-filter').addEventListener('change',filter);$('#reset').onclick=()=>{suggestions.close();$('#search').value='';$('#lifecycle-filter').value='all';filter();};$('#feed-nav').onclick=()=>navigate('feed');$('#records-nav').onclick=()=>navigate('records');$('#evidence-toggle').onclick=()=>{const viewport=$('#main').getBoundingClientRect();const anchor=[...cards.values()].find(card=>!card.hidden&&card.getBoundingClientRect().bottom>viewport.top&&card.getBoundingClientRect().top<viewport.bottom);const anchorTop=anchor?.getBoundingClientRect().top;const enabled=$('#evidence-toggle').getAttribute('aria-pressed')!=='true';$('#evidence-toggle').setAttribute('aria-pressed',String(enabled));document.body.classList.toggle('evidence-mode',enabled);$('#evidence-state').textContent=enabled?'Evidence on':'Show sources';$('#evidence-toggle').setAttribute('aria-label',enabled?'Hide evidence view':'Show facts, risks and sources');for(const card of cards.values())card.setEvidence(enabled);if(anchor)$('#main').scrollBy(0,anchor.getBoundingClientRect().top-anchorTop);announce(enabled?'Evidence view enabled. Sources, facts and editorial analysis are labelled on each issue.':'Standard view enabled.');};
 function deepLink(){const match=location.hash.match(/^#ipo=(.+)$/);if(match){try{viewIPO(decodeURIComponent(match[1]));}catch{announce('This issue link is invalid.');}}}window.addEventListener('hashchange',deepLink);if(preview)$('#engine-preview-notice').textContent=preview.message;announce((preview?(preview.previewLoaded?'Engine snapshot loaded: '+catalogue.ipos.length+(catalogue.previewScope==='current'?' current IPOs from available sources.':' historical IPOs.'):'Preview unavailable; historical catalogue loaded.'):null)||`${catalogue.mode==='demo'?'Demo catalogue':'Historical reference'} ready. Swipe research or choose a slide dot.`);deepLink();
 $('#share-nav').onclick=()=>{const url=new URL(location.href);url.hash='';url.search='?catalogue='+mode;openShareMenu({title:'Share IPO Radar',text:'Before the buzz, check the evidence.\n\nI thought you’d like IPO Radar: swipe through IPO dates, key figures and sourced risks, then save interesting companies to your watchlist.\n\n'+(catalogue.mode==='demo'?'This link opens a fictional product demo.':mode==='live'?'This link opens connected official-source IPO discovery with partial research coverage.':'This link opens historical IPO research, not current market data.')+'\nInformational research; not investment advice.',url:url.href},'Before the buzz, check the evidence. Explore IPO research with IPO Radar.');};const main=$('#main');const showFeed=()=>{navigate('feed');main.scrollTo({top:0,behavior:'smooth'});};const resetFeed=()=>{storyFilter='all';$('#reset').click();showFeed();};$('#story-saved').onclick=()=>{navigate('records');main.scrollTop=0;};$('#story-closing').onclick=()=>{storyFilter='closing';$('#search').value='';$('#lifecycle-filter').value='all';filter();showFeed();announce('Showing IPOs closing today in IST.');};$('#story-upcoming').onclick=()=>{storyFilter='all';$('#search').value='';$('#lifecycle-filter').value='upcoming';filter();showFeed();announce('Showing upcoming IPOs from available source coverage.');};$('#story-open').onclick=()=>{storyFilter='all';$('#search').value='';$('#lifecycle-filter').value='open';filter();showFeed();announce('Showing open IPOs from available source coverage.');};const eventStory=kind=>{storyFilter=kind;$('#search').value='';$('#lifecycle-filter').value='all';filter();showFeed();announce(kind==='allotment'?'Showing confirmed allotments from today and the previous two IST calendar days.':'Showing IPOs scheduled or confirmed to list today or tomorrow in IST.');};$('#story-allotment').onclick=()=>eventStory('allotment');$('#story-listing').onclick=()=>eventStory('listing');$('#story-all').onclick=resetFeed;const openFinder=()=>{finderTrigger=document.activeElement;storyFilter='all';navigate('feed');filter();finder.showModal();$('#search').focus();};$('#search-nav').onclick=openFinder;$('#finder-open').onclick=openFinder;$('#finder-close').onclick=closeFinder;$('#finder-results').onclick=()=>{closeFinder();showFeed();};finder.addEventListener('close',()=>{suggestions.close();if(finderTrigger?.isConnected)finderTrigger.focus({preventScroll:true});});$('#feed-nav').addEventListener('click',()=>main.scrollTo({top:0,behavior:'smooth'}));$('#records-nav').addEventListener('click',()=>{main.scrollTop=0;});$('#reset').addEventListener('click',()=>{storyFilter='all';filter();});$('#lifecycle-filter').addEventListener('change',()=>{storyFilter='all';filter();});
 if(connected){
  function describeConnection(result){$('#engine-preview-notice').textContent=result.message;$('#dataset-badge').textContent=result.state==='stale'?'CONNECTED · STALE':'CONNECTED FEED';$('#dataset-description').textContent='Official-source discovery · Partial research coverage';$('#reference-clock').textContent=result.message;}
  describeConnection(initial);announce('Connected feed loaded: '+catalogue.ipos.length+' IPOs from available official sources.');
  async function refreshFeed(){const result=await connected.poll();if(result.changed&&result.catalogue){const anchor=[...cards.values()].find(card=>!card.hidden&&card.getBoundingClientRect().bottom>$('#main').getBoundingClientRect().top);const anchorId=anchor?.id,top=anchor?.getBoundingClientRect().top;Object.assign(catalogue,result.catalogue);renderCards();suggestions.update(catalogue.ipos);recordsPanel.refresh();refreshSaved();filter();const replacement=anchorId&&document.getElementById(anchorId);if(replacement)$('#main').scrollBy(0,replacement.getBoundingClientRect().top-top);announce('Connected feed updated: '+catalogue.ipos.length+' IPOs.');}describeConnection(result);}
  setInterval(()=>{if(!document.hidden&&!finder.open&&!document.querySelector('dialog[open]'))refreshFeed();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))refreshFeed();});
 }
 if(catalogue.mode!=='demo')setInterval(()=>{for(const card of cards.values())card.updateLifecycle(clock());filter();},60000);
} catch(error) {status.textContent='The app could not load. '+error.message+' Restart the local preview and reload.';status.classList.add('warning');const retry=document.createElement('button');retry.type='button';retry.textContent='Retry feed connection';retry.onclick=()=>location.reload();status.append(' ',retry);}
})();