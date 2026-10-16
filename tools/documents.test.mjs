/* Documents to sign: a contract the admin writes, a visitor fills in and signs.

   What has to hold: a document is locked unless the admin says otherwise; the
   public config lists a document by title only, never its text, its passcode or
   the WhatsApp number; a locked one hands over its text only with the right
   passcode (its own, else the site's); a hidden one is not there at all; the
   signed PDF is kept as a private Drive file and listed for the admin only;
   anything that is not a PDF, or too large, is refused; and the gate for the
   admin calls is the "documents" area. */
import { load, OWNER } from './booth-admin-harness.mjs';

let bad=0;
const check=(l,c,x)=>{ if(!c) bad++; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const { call, signIn, tabs, DRIVE, SHEETS } = load();
const own = signIn(OWNER);
const A = o => call({ token: own.token, ...o });
const BODY = '# TEST COLLABORATION\n\nThis is made on {{Date|today}} between Us and {{Clinic name}}.\n\n1. **Terms**\n1.1 {{Clinic name}} agrees.';
const PDF = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

console.log('set up');
check('a Documents tab', tabs['Documents'] && tabs['Documents'].rows[0][0]==='id' && tabs['Documents'].rows[0].includes('body'), tabs['Documents'] && tabs['Documents'].rows[0]);
check('a Signed documents tab', tabs['Signed documents'] && tabs['Signed documents'].rows[0].includes('file_id'));
check('the public config starts with no documents', JSON.stringify(call({ action:'config' }).documents)==='[]');

console.log('\nadmin: add');
let r = A({ action:'admin.doc.save', doc:{ title:'Test collaboration', description:'For clinics', body:BODY,
  signer_fields:[{label:'Name Clinic', field:'Clinic name'}, {label:'Clinic Address', field:'Clinic address'}],
  our_name:'A Person', our_title:'PIC', our_email:'a@facerinna.test', whatsapp:'+60 12-345 6789' } });
check('saved', r.ok && /^doc-/.test(r.id), r);
const id = r.id;
const d0 = r.documents.find(x => x.id===id);
check('no mode given: locked', d0 && d0.mode==='locked', d0);
check('the WhatsApp number keeps only its digits', d0 && d0.whatsapp==='60123456789', d0 && d0.whatsapp);
check('signer fields kept', d0 && d0.signer_fields.length===2 && d0.signer_fields[0].field==='Clinic name', d0 && d0.signer_fields);
check('no title: refused', !A({ action:'admin.doc.save', doc:{ body:'x' } }).ok);
check('no text: refused', !A({ action:'admin.doc.save', doc:{ title:'x', body:'  ' } }).ok);
check('too long: refused', !A({ action:'admin.doc.save', doc:{ title:'x', body:'a'.repeat(45001) } }).ok);
check('a signature that is not a picture: refused', !A({ action:'admin.doc.save', doc:{ title:'x', body:'y', our_signature:'javascript:alert(1)' } }).ok);
check('the write was flushed before the lock let go', SHEETS.unflushedReleases===0, SHEETS);

console.log('\npublic: locked');
let cfg = call({ action:'config' });
const pubDoc = cfg.documents.find(x => x.id===id);
check('listed by title, marked locked', pubDoc && pubDoc.title==='Test collaboration' && pubDoc.locked===true, cfg.documents);
const cfgText = JSON.stringify(cfg);
check('the config carries none of the text, the number or the signer', !cfgText.includes('agrees') && !cfgText.includes('60123456789') && !cfgText.includes('a@facerinna.test'));
r = call({ action:'doc.get', id });
check('no passcode: no text', !r.ok && r.locked && !r.doc, r);
A({ action:'admin.settings', settings:{ passcode:'site123' } });
r = call({ action:'doc.get', id, passcode:'nope' });
check('wrong passcode: no text', !r.ok && !r.doc, r);
r = call({ action:'doc.get', id, passcode:'site123' });
check('the site passcode opens it', r.ok && r.doc.body===BODY && r.doc.whatsapp==='60123456789', r);
A({ action:'admin.doc.save', doc:{ ...d0, id, mode:'locked', passcode:'doc999' } });
check('its own passcode, once set, is the one', call({ action:'doc.get', id, passcode:'doc999' }).ok && !call({ action:'doc.get', id, passcode:'site123' }).ok);

console.log('\nshow / hide');
A({ action:'admin.doc.save', doc:{ ...d0, id, mode:'show' } });
check('shown: opens with no passcode', call({ action:'doc.get', id }).ok && call({ action:'config' }).documents[0].locked===false);
A({ action:'admin.doc.save', doc:{ ...d0, id, mode:'hidden' } });
check('hidden: not listed', call({ action:'config' }).documents.length===0);
check('hidden: not handed over', !call({ action:'doc.get', id }).ok);
check('hidden: cannot be signed', !call({ action:'doc.sign', id, pdf:PDF }).ok);
A({ action:'admin.doc.save', doc:{ ...d0, id, mode:'locked', passcode:'' } });

console.log('\nsigning');
r = call({ action:'doc.sign', id, pdf:PDF, values:{ 'Clinic name':'X' } });
check('locked, no passcode: not taken', !r.ok && r.locked, r);
r = call({ action:'doc.sign', id, passcode:'site123', pdf:Buffer.from('<html>hi</html>').toString('base64') });
check('not a PDF: refused', !r.ok, r);
r = call({ action:'doc.sign', id, passcode:'site123', pdf:'' });
check('no PDF: refused', !r.ok, r);
const before = SHEETS.unflushedReleases;
r = call({ action:'doc.sign', id, passcode:'site123', pdf:'data:application/pdf;base64,'+PDF,
  values:{ 'Clinic name':'=HYPERLINK("x")', 'Date':'16 October 2026' }, signer:'=Dr X', device:'dev_abc123' });
check('signed', r.ok && /^sig-/.test(r.id), r);
check('flushed before the lock let go', SHEETS.unflushedReleases===before, SHEETS);
const row = tabs['Signed documents'].rows[1];
const file = DRIVE.files[row[5]];
check('the PDF is a Drive file, private', file && file.access==='PRIVATE' && file.mime==='application/pdf', file);
check('in its own folder', DRIVE.folders.some(f => f.name==='FACERINNA signed documents'));
check('a signer name that looks like a formula is kept as text', String(row[4]).startsWith("'="), row[4]);
check('nothing about the signed copy goes public', !JSON.stringify(call({ action:'config' })).includes(r.id));

console.log('\na flood');
{
  const H2 = load(); const o2 = H2.signIn(OWNER);
  const r2 = H2.call({ token:o2.token, action:'admin.doc.save', doc:{ title:'Open', body:'x {{Name}}', mode:'show' } });
  let ok = 0, last;
  for (let i = 0; i < 45; i++) { last = H2.call({ action:'doc.sign', id:r2.id, pdf:PDF }); if (last.ok) ok++; }
  check('forty in ten minutes, then "try again in a few minutes"', ok === 40 && !last.ok && last.reason === 'busy', { ok, last });
  check('...and no Drive file for the refused ones', Object.keys(H2.DRIVE.files).length === 40);
}

console.log('\nadmin: signed copies');
let s = A({ action:'admin.doc.signed' });
check('listed, newest first, with what was filled in', s.ok && s.signed[0].id===r.id && s.signed[0].values['Date']==='16 October 2026' && s.signed[0].doc_title==='Test collaboration', s);
let g = A({ action:'admin.get' });
check('admin.get carries the documents and the signed copies', g.documents && g.documents.length===1 && g.signed && g.signed.length===1);
let f = A({ action:'admin.doc.file', id:r.id });
check('download hands the PDF back', f.ok && /\.pdf$/.test(f.name), f);
check('signed copies: signed out, nothing', !call({ action:'admin.doc.signed' }).ok && !call({ action:'admin.doc.file', id:r.id }).ok);

console.log('\nstaff without the documents area');
A({ action:'admin.team.save', person:{ email:'staff@facerinna.test', name:'S', role:'staff', access:['gifts'], active:true } });
const st = signIn('staff@facerinna.test');
const S = o => call({ token: st.token, ...o });
check('cannot list signed copies', S({ action:'admin.doc.signed' }).reason==='forbidden');
check('cannot download one', S({ action:'admin.doc.file', id:r.id }).reason==='forbidden');
check('cannot save a document', S({ action:'admin.doc.save', doc:{ title:'x', body:'y' } }).reason==='forbidden');
check('admin.get leaves documents out', !('documents' in S({ action:'admin.get' })));
A({ action:'admin.team.save', person:{ email:'staff@facerinna.test', name:'S', role:'staff', access:['documents'], active:true } });
check('with the area: may list', S({ action:'admin.doc.signed' }).ok);

console.log('\nremove');
s = A({ action:'admin.doc.signed.delete', id:r.id });
check('a signed copy removed: off the list, the file in the bin', s.ok && s.signed.length===0 && file.trashed, s);
r = A({ action:'admin.doc.save', doc:{ title:'Second', body:'Two' } });
const id2 = r.id;
r = A({ action:'admin.doc.order', ids:[id2, id] });
check('reorder', r.ok && r.documents[0].id===id2, r.documents && r.documents.map(x=>x.id));
r = A({ action:'admin.doc.delete', id });
check('delete', r.ok && r.documents.length===1 && r.documents[0].id===id2, r);
check('a deleted document cannot be opened', !call({ action:'doc.get', id, passcode:'site123' }).ok);

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
