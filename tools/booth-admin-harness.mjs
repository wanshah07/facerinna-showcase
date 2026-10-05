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
  const mkSheet = o => ({
    getLastRow: () => o.rows.length,
    appendRow: r => o.rows.push(r.slice()),
    deleteRow: n => { o.rows.splice(n-1, 1); },
    setFrozenRows(){}, setColumnWidth(){}, hideColumns(){},
    getRange: (r,c,nr,nc) => {
      const put = (ri,ci,v) => { while(o.rows.length<=ri) o.rows.push([]);
                                 while(o.rows[ri].length<=ci) o.rows[ri].push('');
                                 o.rows[ri][ci]=v; };
      const range = {
        getValues: () => { const out=[]; for(let i=r-1;i<r-1+(nr||1);i++){ const row=o.rows[i]||[]; const line=[];
          for(let j=c-1;j<c-1+(nc||1);j++) line.push(row[j]===undefined?'':row[j]); out.push(line);} return out; },
        setValue: v => { for(let i=r-1;i<r-1+(nr||1);i++) put(i,c-1,v); return range; },
        setValues: vals => { vals.forEach((row,i) => row.forEach((v,j) => put(r-1+i, c-1+j, v))); return range; },
        setFontWeight(){ return range; },
      };
      return range;
    },
  });
  const SpreadsheetApp = { openById: id => {
    if(id!==BOOK_ID) throw new Error('no book '+id);
    return { getSheetByName: n => tabs[n] ? mkSheet(tabs[n]) : null,
             insertSheet: n => { tabs[n]={rows:[]}; return mkSheet(tabs[n]); } };
  }};
  const mails=[];
  const MailApp = { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 };
  let LOCK_FREE=true;
  const LockService = { getScriptLock: () => ({ waitLock(){}, releaseLock(){ LOCK_FREE=true; },
    tryLock(){ if(!LOCK_FREE) return false; LOCK_FREE=false; return true; } }) };
  const ContentService = { MimeType:{JSON:'j'}, createTextOutput: s => ({ setMimeType: () => s }) };
  let uuid=0;
  const Utilities = { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12,'0'),
                      sleep(){},
                      DigestAlgorithm: { SHA_256: 'SHA-256' },
                      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()),
                      base64Encode: bytes => Buffer.from(bytes).toString('base64') };
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
  return { m, call, signIn, tabs, mails, PROPS, CACHE };
}
