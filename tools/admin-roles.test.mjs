/* Roles on the booth admin: the real script, its gate and what it guards.

   What it has to do: an admin holds every area and the People list; a staff
   member holds only the areas ticked for them, and is refused everything
   else on the script, not only in the page -- the passcode is not even sent
   to somebody without the page area. A tick or an untick takes effect on
   that person's next call. Nobody changes their own row, the owner cannot
   be changed from the page at all, and a row from before roles is still an
   admin. */
import { load, OWNER } from './booth-admin-harness.mjs';

let bad=0;
const check=(l,c,x)=>{ if(!c) bad++; console.log((c?'  PASS  ':'  FAIL  ')+l+(!c&&x!==undefined?'  -> '+JSON.stringify(x):'')); };
const { call, signIn, tabs, mails } = load();
const rowOf = e => tabs['Admins'].rows.find(r => String(r[0]).toLowerCase() === e);

console.log('the owner');
const own = signIn(OWNER);
check('the owner signs in with a code', own && own.ok && own.token, own);
check('...and the sign-in says: admin, every area', own.role==='admin' && own.access.length===10, own);
let g = call({ action:'admin.get', token:own.token });
check('admin.get: me is the owner, an admin', g.me && g.me.owner===true && g.me.role==='admin', g.me);
check('admin.get: the ten areas come with it', Array.isArray(g.perms) && g.perms.map(p=>p[0]).join()==='counter,guide,page,games,gift,stock,claims,sections,segments,privacy', g.perms);
check('admin.get: an admin gets the passcode, the list and the quota', 'passcode' in g.settings && g.admins.length===1 && g.quota===100, Object.keys(g));
check('the Admins tab names all eight columns', tabs['Admins'].rows[0].join()==='email,active,name,added,role,access,updated,by', tabs['Admins'].rows[0]);

console.log('\na row from before roles');
tabs['Admins'].rows.push(['old@clinic.test','yes','Old hand','']);
const old = signIn('old@clinic.test');
check('a row with no role is an admin, as every row was', old.ok && old.role==='admin' && old.access.length===10, old);
check('...and gets the People list', (call({ action:'admin.get', token:old.token }).admins||[]).length===2);

console.log('\nadding a staff member');
let r = call({ action:'admin.team.save', token:own.token, person:{ email:'Aina@Clinic.test', name:'Aina, counter', role:'staff', access:['guide','counter'] } });
check('the owner adds staff', r.ok && r.admins.some(a=>a.email==='aina@clinic.test' && a.role==='staff'), r);
let row = rowOf('aina@clinic.test');
check('the row: address in lower case, active, staff, areas in the list order', row && row[1]==='yes' && row[4]==='staff' && row[5]==='counter, guide', row);
check('...stamped with who and when', row[7]===OWNER && row[6] instanceof Date && row[3] instanceof Date, row);
check('a bad address is refused', call({ action:'admin.team.save', token:own.token, person:{ email:'not-an-address' } }).ok===false);
r = call({ action:'admin.team.save', token:own.token, person:{ email:'ben@clinic.test', name:'=HYPERLINK("http://x","y")', role:'staff', access:['counter','root','page','counter'] } });
row = rowOf('ben@clinic.test');
check('an area that does not exist is dropped, and none twice', row[5]==='counter, page', row[5]);
check('a name that would be a formula is stored as text', String(row[2]).startsWith("'="), row[2]);

console.log('\nwhat staff can and cannot do');
const aina = signIn('aina@clinic.test');
check('staff sign in, and are told their areas', aina.ok && aina.role==='staff' && aina.access.join()==='counter,guide', aina);
g = call({ action:'admin.get', token:aina.token });
check('admin.get: no settings at all, so no passcode', g.ok && Object.keys(g.settings).length===0, g.settings);
check('admin.get: no People list, no quota, no segments, no section states', !('admins' in g) && !('quota' in g) && !('segments' in g) && !('section_rows' in g), Object.keys(g));
check('whoami: no preview of locked parts of the booth page', call({ action:'whoami', token:aina.token }).preview===false);
let x = call({ action:'admin.gift.redeem', token:aina.token, claim:'nope' });
check('counter: the gate lets her through (the claim is what fails)', x.ok===false && /claim/.test(x.error), x);
check('the guide opens', call({ action:'admin.guide', token:aina.token }).ok===true);
const before = JSON.stringify(tabs['Settings'].rows);
x = call({ action:'admin.settings', token:aina.token, settings:{ welcome:'hide' } });
check('page settings: refused, and says which area', x.ok===false && x.reason==='forbidden' && x.area==='page' && /Page & passcode/.test(x.error), x);
check('...and the sheet is untouched', JSON.stringify(tabs['Settings'].rows)===before);
check('sections: refused', call({ action:'admin.section.set', token:aina.token, id:'qrcore', mode:'hidden' }).reason==='forbidden');
check('segments: refused', call({ action:'admin.segment.save', token:aina.token, segment:{ title:'x' } }).reason==='forbidden');
check('segment order and delete: refused', call({ action:'admin.segment.order', token:aina.token, ids:[] }).reason==='forbidden'
  && call({ action:'admin.segment.delete', token:aina.token, id:'x' }).reason==='forbidden');
x = call({ action:'admin.team.save', token:aina.token, person:{ email:'friend@x.test', role:'admin' } });
check('People: refused, and nobody was added', x.ok===false && /Only an admin/.test(x.error) && !rowOf('friend@x.test'), x);
check('removing someone: refused', call({ action:'admin.team.remove', token:aina.token, email:'ben@clinic.test' }).ok===false && !!rowOf('ben@clinic.test'));

console.log('\nticking and unticking, live');
call({ action:'admin.team.save', token:own.token, person:{ email:'aina@clinic.test', role:'staff', access:['guide'] } });
x = call({ action:'admin.gift.redeem', token:aina.token, claim:'nope' });
check('untick Counter: her very next scan is refused, same session', x.reason==='forbidden' && x.area==='counter', x);
call({ action:'admin.team.save', token:own.token, person:{ email:'aina@clinic.test', role:'staff', access:['guide','privacy'] } });
g = call({ action:'admin.get', token:aina.token });
check('tick Privacy: she gets the four privacy settings and nothing else', Object.keys(g.settings).sort().join()==='privacy_address,privacy_email,privacy_entity,privacy_retention', Object.keys(g.settings));
x = call({ action:'admin.settings', token:aina.token, settings:{ privacy_entity:'FACERINNA Sdn. Bhd.' } });
check('...and can save them', x.ok===true && x.settings.privacy_entity==='FACERINNA Sdn. Bhd.' && !('passcode' in x.settings), x);
x = call({ action:'admin.settings', token:aina.token, settings:{ privacy_entity:'Changed', passcode:'mine' } });
check('one key outside her areas refuses the whole save', x.reason==='forbidden' && x.area==='page', x);
check('...so the privacy key in it was not written either', call({ action:'admin.get', token:own.token }).settings.privacy_entity==='FACERINNA Sdn. Bhd.');
call({ action:'admin.team.save', token:own.token, person:{ email:'aina@clinic.test', role:'staff', access:['page'] } });
g = call({ action:'admin.get', token:aina.token });
check('tick Page: now the passcode is hers to see', 'passcode' in g.settings && !('gift_products' in g.settings), Object.keys(g.settings));
check('...and the booth page previews for her', call({ action:'whoami', token:aina.token }).preview===true);

console.log('\nno one changes their own row; the owner is not changed here');
x = call({ action:'admin.team.save', token:own.token, person:{ email:OWNER, role:'staff', access:[] } });
check('the owner cannot demote themselves', x.ok===false && rowOf(OWNER)[4]!=='staff', x);
x = call({ action:'admin.team.save', token:old.token, person:{ email:OWNER, role:'staff', access:[] } });
check('another admin cannot touch the owner', x.ok===false && /owner/i.test(x.error), x);
check('...nor remove them', call({ action:'admin.team.remove', token:old.token, email:OWNER }).ok===false && !!rowOf(OWNER));
x = call({ action:'admin.team.save', token:old.token, person:{ email:'old@clinic.test', role:'admin', active:false } });
check('an admin cannot change their own row', x.ok===false && /own access/.test(x.error), x);
tabs['Admins'].rows[1][4]='staff';
check('even set to staff in the sheet, the owner stays an admin', call({ action:'whoami', token:own.token }).role==='admin');

console.log('\npromoting, turning off, removing');
call({ action:'admin.team.save', token:own.token, person:{ email:'ben@clinic.test', role:'admin' } });
const ben = signIn('ben@clinic.test');
check('made an admin: every area and People', ben.role==='admin' && call({ action:'admin.get', token:ben.token }).admins.length>=3, ben);
check('the sheet says admin with no list of areas', rowOf('ben@clinic.test')[4]==='admin' && rowOf('ben@clinic.test')[5]==='', rowOf('ben@clinic.test'));
call({ action:'admin.team.save', token:own.token, person:{ email:'aina@clinic.test', role:'staff', access:['counter'], active:false } });
check('turned off: her session stops at once', call({ action:'whoami', token:aina.token }).error==='signed out');
const mailsBefore = mails.length;
call({ action:'code', email:'aina@clinic.test' });
check('...and no code is mailed to her', mails.length===mailsBefore);
call({ action:'admin.team.save', token:own.token, person:{ email:'aina@clinic.test', role:'staff', access:['counter'], active:true } });
check('turned back on: the same session works again', call({ action:'whoami', token:aina.token }).ok===true);
x = call({ action:'admin.team.remove', token:ben.token, email:'aina@clinic.test' });
check('an admin removes her; the row is gone', x.ok && !rowOf('aina@clinic.test') && !x.admins.some(a=>a.email==='aina@clinic.test'), x);
check('...and so is her session', call({ action:'whoami', token:aina.token }).error==='signed out');

console.log('\nhand-edited rows grant less, not more');
tabs['Admins'].rows.push(['typo@clinic.test','yes','Typo','', 'Staf', 'counter, Guide ;segments , nonsense']);
const typo = signIn('typo@clinic.test');
check('a misspelt role is staff, not admin', typo.role==='staff', typo);
check('its areas are read loosely but only real ones count', typo.access.join()==='counter,guide,segments', typo.access);
tabs['Admins'].rows.push(['caps@clinic.test','YES','Caps','', 'ADMIN', '']);
check('ADMIN in capitals is an admin', signIn('caps@clinic.test').role==='admin');

/* ------------------------------------------------------------ stock
   The wheel is what is in stock. A product at 0 is off it, restocking puts
   it back, each gift takes one off, and with nothing left no new code is
   handed out -- a code the counter could not honour is worse than none. */
console.log('\nthe wheel is the stock');
const stockTab = () => tabs['Gift stock'].rows.slice(1);
g = call({ action:'admin.get', token:own.token });
check('the stock list starts from the old products, not counted', g.stock.length===8 && g.stock.every(x=>x.quantity===null && x.on_wheel), g.stock);
const P = g.stock.map(x=>x.product);
// count them all: two of the first, none of the rest
P.forEach((name,i)=>call({ action:'admin.stock.set', token:own.token, product:name, quantity: i===0 ? 2 : 0 }));
g = call({ action:'admin.get', token:own.token });
check('set counts: one product on the wheel, seven off', g.stock.filter(x=>x.on_wheel).map(x=>x.product).join()===P[0], g.stock);
check('a count that is not a number is refused', call({ action:'admin.stock.set', token:own.token, product:P[1], quantity:'lots' }).ok===false);
check('a negative count is refused', call({ action:'admin.stock.set', token:own.token, product:P[1], quantity:-3 }).ok===false);
call({ action:'admin.settings', token:own.token, settings:{ gift_active:'yes' } });
const tick = r => { const c = call({ action:'gift.claim', device:r, score:9000, game:'facy-run', name:'T' }); return c; };
const cA = tick('devAAAA1'), cB = tick('devBBBB1'), cC = tick('devCCCC1');
let sp = call({ action:'admin.gift.redeem', token:own.token, claim:cA.claim });
check('the wheel holds only what is in stock', sp.ok && sp.products.join()===P[0] && sp.product===P[0] && sp.index===0, sp);
check('...and the gift comes off the count: 1 left', sp.left===1 && stockTab()[0][1]===1, [sp.left, stockTab()[0]]);
sp = call({ action:'admin.gift.redeem', token:own.token, claim:cB.claim });
check('the last one goes: 0 left', sp.ok && sp.left===0 && stockTab()[0][1]===0, sp);
sp = call({ action:'admin.gift.redeem', token:own.token, claim:cC.claim });
check('with nothing in stock the scan is refused, and says so', sp.ok===false && /out of stock/.test(sp.error), sp);
check('...and that code is not spent: it can be scanned after a restock', !tabs['Gifts'].rows.find(r=>r[0]===cC.claim)[6]);
check('a device that already holds a code still gets it back', tick('devCCCC1').claim===cC.claim);
check('a new device gets no code while nothing is in stock', tick('devDDDD1').reason==='nostock');
x = call({ action:'admin.stock.set', token:own.token, product:P[3], add:5 });
check('restock by adding: the product is back on the wheel', x.ok && x.stock.find(s=>s.product===P[3]).quantity===5 && x.stock.find(s=>s.product===P[3]).on_wheel, x);
sp = call({ action:'admin.gift.redeem', token:own.token, claim:cC.claim });
check('...and the waiting code now spins onto it', sp.ok && sp.product===P[3] && sp.left===4, sp);
check('adding a new product puts it on the list', call({ action:'admin.stock.set', token:own.token, product:'Travel kit', quantity:3 }).stock.some(s=>s.product==='Travel kit' && s.quantity===3));
check('matching a product ignores capitals: no duplicate', call({ action:'admin.stock.set', token:own.token, product:'travel KIT', add:2 }).stock.filter(s=>/travel kit/i.test(s.product)).length===1
  && stockTab().find(r=>r[0]==='Travel kit')[1]===5);
check('removing takes it off the list', !call({ action:'admin.stock.remove', token:own.token, product:'Travel kit' }).stock.some(s=>s.product==='Travel kit'));
check('the public config never carries the stock', !('stock' in call({ action:'config' })) && !('gift_products' in call({ action:'config' }).settings));

console.log('\nletting a device play again');
g = call({ action:'admin.get', token:own.token });
check('claims list, newest first, with who scanned it', g.claims[0].device==='devCCCC1' && g.claims[0].product===P[3] && g.claims[0].by===OWNER, g.claims[0]);
check('...and without the codes themselves', !('claim' in g.claims[0]));
x = call({ action:'admin.claims.reset', token:own.token, device:'devAAAA1' });
check('reset: the row is stamped, not deleted', x.ok && x.reset===1 && tabs['Gifts'].rows.find(r=>r[1]==='devAAAA1')[9] instanceof Date
  && tabs['Gifts'].rows.find(r=>r[1]==='devAAAA1')[10]===OWNER, x);
const again = tick('devAAAA1');
check('the device earns a new code on its next run', again.ok && again.claim && again.claim!==cA.claim && !again.redeemed, again);
check('...and its old, spent code still reads as a receipt', call({ action:'admin.gift.redeem', token:own.token, claim:cA.claim }).already===true);
check('reset twice in a row: nothing live, nothing to reset the second time',
  call({ action:'admin.claims.reset', token:own.token, device:'devAAAA1' }).ok===true
  && call({ action:'admin.claims.reset', token:own.token, device:'devAAAA1' }).ok===false);
sp = call({ action:'admin.gift.redeem', token:own.token, claim:again.claim });
check('a code reset before it was spent is cancelled: no second gift', sp.ok===false && /cancelled/.test(sp.error), sp);
check('nonsense is not a device', call({ action:'admin.claims.reset', token:own.token, device:'x' }).ok===false);

console.log('\nstock and claims are areas like the rest');
call({ action:'admin.team.save', token:own.token, person:{ email:'store@clinic.test', role:'staff', access:['stock'] } });
const store = signIn('store@clinic.test');
g = call({ action:'admin.get', token:store.token });
check('stock staff see the stock and not the claims', Array.isArray(g.stock) && !('claims' in g), Object.keys(g));
check('...can restock', call({ action:'admin.stock.set', token:store.token, product:P[1], add:4 }).ok===true);
check('...cannot reset a device', call({ action:'admin.claims.reset', token:store.token, device:'devBBBB1' }).reason==='forbidden');
check('...cannot switch the gift off (that is Gift rules)', call({ action:'admin.settings', token:store.token, settings:{ gift_active:'no' } }).area==='gift');
call({ action:'admin.team.save', token:own.token, person:{ email:'store@clinic.test', role:'staff', access:['claims'] } });
check('tick Claims instead: now resetting works and restocking does not',
  call({ action:'admin.claims.reset', token:store.token, device:'devBBBB1' }).ok===true
  && call({ action:'admin.stock.set', token:store.token, product:P[1], add:1 }).reason==='forbidden');

console.log(bad ? `\n${bad} FAILED` : '\nroles, stock and resets: the script is the lock');
process.exit(bad?1:0);
