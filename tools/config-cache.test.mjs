/* The config every phone asks for on arrival, served from the script cache.

   What it has to do: answer repeat asks without going back to the sheet,
   give the next phone whatever an admin has just saved (not the old answer
   for another twenty seconds), forget itself when it expires, never carry
   anything private, and still answer from the sheet if the cache is broken. */
import { load, OWNER } from './booth-admin-harness.mjs';

let bad=0;
const check=(l,c,x)=>{ if(!c) bad++; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const H = load();
const own = H.signIn(OWNER);
const cfg = () => H.call({action:'config'});
const row = k => H.tabs['Settings'].rows.find(r=>r[0]===k);

console.log('a repeat ask is served from the cache');
H.call({action:'admin.settings', token:own.token, settings:{welcome:'show', passcode:'booth-secret-2026', lock_message:'public message'}});
const first = cfg();
check('first ask is answered, and the answer is kept', first.ok===true && H.CACHE.has('config.v1'), [...H.CACHE.keys()]);
row('lock_message')[1] = 'EDITED BY HAND IN THE SHEET';
check('a second ask within the window does not go back to the sheet', cfg().settings.lock_message==='public message', cfg().settings.lock_message);
const text = H.CACHE.get('config.v1').v;
check('what is kept is what config already gives anybody: no passcode', !/booth-secret-2026/.test(text) && !('passcode' in JSON.parse(text).settings), Object.keys(JSON.parse(text).settings));
check('...and it is the same body the first phone got', JSON.stringify(first)===text || JSON.stringify(JSON.parse(text))===JSON.stringify(first));

console.log('\nan admin save is seen by the very next phone');
let r = H.call({action:'admin.settings', token:own.token, settings:{games_off:'uv-card,deep-lab'}});
check('the save is accepted', r.ok===true, r);
check('...and the cache was dropped with it', !H.CACHE.has('config.v1'));
check('the next ask has the new games_off at once', cfg().settings.games_off==='uv-card,deep-lab', cfg().settings.games_off);
check('...and the hand edit that was waiting out the window is read now too', cfg().settings.lock_message==='EDITED BY HAND IN THE SHEET', cfg().settings.lock_message);

r = H.call({action:'admin.section.set', token:own.token, id:'qrcore', mode:'hidden'});
check('hiding a section drops it too: the next ask lists it hidden', r.ok && cfg().section_states.some(s=>s.id==='qrcore'&&s.mode==='hidden'), cfg().section_states);
r = H.call({action:'admin.segment.save', token:own.token, segment:{title:'Cached?', after:'range', visible:true, mode:'show', description:'x'}});
check('adding a segment drops it too: the next ask carries the segment', r.ok && cfg().segments.some(s=>s.title==='Cached?'), cfg().segments);
const id = cfg().segments.find(s=>s.title==='Cached?').id;
H.call({action:'admin.segment.delete', token:own.token, id});
check('deleting it drops it too: gone from the next ask', !cfg().segments.some(s=>s.title==='Cached?'));

console.log('\nexpiry');
cfg(); check('kept again', H.CACHE.has('config.v1'));
row('lock_message')[1] = 'second hand edit';
H.CACHE.get('config.v1').exp = Date.now() - 1;               // the twenty seconds are up
check('once it has expired the sheet is read again', cfg().settings.lock_message==='second hand edit', cfg().settings.lock_message);
const kept = H.CACHE.get('config.v1');
check('...and kept for about twenty seconds, no longer', kept && kept.exp-Date.now()<=20500 && kept.exp-Date.now()>15000, kept && kept.exp-Date.now());

console.log('\na cache that fails changes nothing');
const g = H.CACHE.get, s = H.CACHE.set;
H.CACHE.get = () => { throw new Error('cache down'); };
H.CACHE.set = () => { throw new Error('cache down'); };
row('lock_message')[1] = 'read from the sheet';
const broken = cfg();
check('a cache that throws on read and write: still answered, from the sheet', broken.ok===true && broken.settings.lock_message==='read from the sheet', broken);
check('...and an admin save still works', H.call({action:'admin.settings', token:own.token, settings:{welcome:'hide'}}).ok===true);
H.CACHE.get = g; H.CACHE.set = s;

console.log('\nwhat else uses it');
check('the GET form (?config=1) answers too', JSON.parse(H.m.doGet({parameter:{config:'1'}})).ok===true);
check('every other action is untouched: unknown still unknown', H.call({action:'nope'}).ok===false);

console.log(bad ? '\n'+bad+' FAILED' : '\nall passed');
process.exit(bad?1:0);
