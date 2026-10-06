/* The booth admin script, loaded for real against in-memory tabs with the
   Google services stubbed -- the same stand-ins booth-admin.test.mjs uses,
   made reusable so a browser test can put the real script behind a local
   server. Each call to load() is a fresh sheet and a fresh script. */
import fs from 'fs';
import crypto from 'node:crypto';

export const BOOK_ID = '1J9QAO7PUO4caLhDBsKMGZ5tofv4Gqy5-QSVlo_hBEso';
export const OWNER = 'owner@facerinna.test';

export function load(){
  const src = fs.readFileSync('/workspace/facerinna-showcase/tools/booth-admin.gs','utf8');
  const tabs = {};
  /* Writes not yet flushed. A lock let go with writes still pending is how a
     real sheet hands the next run a stale value; the test can see it here. */
  const SHEETS = { pending: 0, flushes: 0, unflushedReleases: 0, writes: 0 };
  const wrote = () => { SHEETS.pending++; SHEETS.writes++; };
  const mkSheet = o => ({
    getLastRow: () => o.rows.length,
    appendRow: r => { wrote(); o.rows.push(r.slice()); },
    deleteRow: n => { o.rows.splice(n-1, 1); },
    setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
    getRange: (r,c,nr,nc) => {
      const put = (ri,ci,v) => { while(o.rows.length<=ri) o.rows.push([]);
                                 while(o.rows[ri].length<=ci) o.rows[ri].push('');
                                 o.rows[ri][ci]=v; };
      const range = {
        /* as Sheets does: a leading apostrophe marks the cell as text and is not part of its value */
        getValues: () => { const out=[]; for(let i=r-1;i<r-1+(nr||1);i++){ const row=o.rows[i]||[]; const line=[];
          for(let j=c-1;j<c-1+(nc||1);j++){ const v=row[j]===undefined?'':row[j]; line.push(typeof v==='string'&&v[0]==="'"?v.slice(1):v); } out.push(line);} return out; },
        setValue: v => { wrote(); for(let i=r-1;i<r-1+(nr||1);i++) put(i,c-1,v); return range; },
        setValues: vals => { wrote(); vals.forEach((row,i) => row.forEach((v,j) => put(r-1+i, c-1+j, v))); return range; },
        setFontWeight(){ return range; },
      };
      return range;
    },
  });
  const SpreadsheetApp = { flush: () => { SHEETS.flushes++; SHEETS.pending = 0; }, openById: id => {
    if(id!==BOOK_ID) throw new Error('no book '+id);
    return { getSheetByName: n => tabs[n] ? mkSheet(tabs[n]) : null,
             insertSheet: n => { tabs[n]={rows:[]}; return mkSheet(tabs[n]); } };
  }};
  const mails=[];
  const MailApp = { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 };
  let LOCK_FREE=true;
  const LockService = { getScriptLock: () => ({ waitLock(){}, releaseLock(){ if(SHEETS.pending) SHEETS.unflushedReleases++; LOCK_FREE=true; },
    tryLock(){ if(!LOCK_FREE) return false; LOCK_FREE=false; return true; } }) };
  const ContentService = { MimeType:{JSON:'j'}, createTextOutput: s => ({ setMimeType: () => s }) };
  let uuid=0;
  const Utilities = { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12,'0'),
                      sleep(){},
                      DigestAlgorithm: { SHA_256: 'SHA-256' },
                      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()),
                      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
                      base64Decode: str => Array.from(Buffer.from(String(str), 'base64')),
                      newBlob: (bytes, mime, name) => ({ bytes, mime, name }) };
  /* Drive: files with the one thing the script asks of them -- who can open
     them. DRIVE.files is the whole store, so a test can read what the public
     could and could not fetch. */
  const DRIVE = { files: {}, folders: [], failShare: false, n: 0 };
  const mkFile = (blob) => { const id = 'drv' + String(++DRIVE.n).padStart(6,'0');
    const f = { id, name: blob.name, mime: blob.mime, bytes: blob.bytes.length, access: 'PRIVATE', trashed: false,
      getId: () => id,
      setSharing: (a, p) => { if(DRIVE.failShare) throw new Error('Sharing outside the domain is not allowed'); f.access = a; },
      setTrashed: t => { f.trashed = t; } };
    DRIVE.files[id] = f; return f; };
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 'VIEW', NONE: 'NONE' },
    getFoldersByName: n => { const hit = DRIVE.folders.filter(x => x.name === n); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
    createFolder: n => { const fo = { name: n, createFile: mkFile }; DRIVE.folders.push(fo); return fo; },
    getFileById: id => { if(!DRIVE.files[id]) throw new Error('no file '+id); return DRIVE.files[id]; } };
  const PROPS={};
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k in PROPS ? PROPS[k] : null),
    setProperty: (k,v) => { PROPS[k]=String(v); },
    deleteProperty: k => { delete PROPS[k]; } }) };
  /* Apps Script's script cache: shared by every run, values forgotten after
     their TTL. The test can reach the store to age an entry. */
  const CACHE = new Map();
  const CacheService = { getScriptCache: () => ({
    get: k => { const e = CACHE.get(k); if(!e) return null; if(e.exp <= Date.now()){ CACHE.delete(k); return null; } return e.v; },
    put: (k,v,secs) => { if(String(v).length > 100*1024) throw new Error('Argument too large: value'); CACHE.set(k,{v:String(v), exp:Date.now()+(secs||600)*1000}); },
    remove: k => { CACHE.delete(k); } }) };
  const Session = { getEffectiveUser: () => ({ getEmail: () => OWNER }) };
  const Logger = { log(){} };
  const m = eval(`(() => { ${src}
    return { doPost, doGet, setUp }; })()`);
  const call = o => JSON.parse(m.doPost({ postData:{ contents: JSON.stringify(o), type:'text/plain' } }));
  /* A session the way a person gets one: ask for a code, type it in. */
  const signIn = email => {
    /* the one-a-minute limit on codes is booth-admin.test.mjs's to check;
       here a second sign-in for the same address should just work */
    delete PROPS['admincode:' + email];
    const before = mails.length;
    call({ action:'code', email });
    const mail = mails.slice(before).find(x => x.to === email);
    if(!mail) return null;
    const code = (mail.subject.match(/(\d{6})$/)||[])[1];
    return call({ action:'redeem', email, code });
  };
  m.setUp();
  return { m, call, signIn, tabs, mails, PROPS, CACHE, DRIVE, SHEETS };
}
