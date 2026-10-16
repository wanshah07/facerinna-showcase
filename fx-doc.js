/* fx-doc.js -- a document to fill in and sign, on screen and as a PDF.

   The admin writes the document as plain text, one paragraph to a line:

     # TITLE                    a centred, bold title
     ## Heading                 a bold line
     1.  1.1  10.2              a clause number: hangs at the left margin
     (a)  (iv)  a)  -           a sub-item: hangs one step in
       text / > text            a line that starts with spaces (or >) sits one step in
     **bold**  __underline__
     {{Clinic name}}            a yellow box the signer fills in; the same label twice is one value
     {{Date|today}}             ...filled with today's date to begin with
     {{Phone|optional}}         ...that may stay empty
     [[sign Facerinna, | the Clinic,]]   where the signatures go (else at the end)
     a blank line               a little more space

   Everything here runs in the browser: FxDoc.parse reads the text, FxDoc.html
   draws it, FxDoc.pdf writes the signed PDF -- A4, Helvetica, the boxes still
   yellow, the signatures as pictures. No library: the PDF is a few objects of
   text, which is all a contract needs. */
(function(){
var HELV=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
var HELVB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
var WINANSI={'8364':128,'8218':130,'402':131,'8222':132,'8230':133,'8224':134,'8225':135,'710':136,'8240':137,'352':138,'8249':139,'338':140,'381':142,'8216':145,'8217':146,'8220':147,'8221':148,'8226':149,'8211':150,'8212':151,'732':152,'8482':153,'353':154,'8250':155,'339':156,'382':158,'376':159};
var STEP = 30;          /* one indent step, in points */

/* ------------------------------------------------------------------ parse */
function inline(s, fields, seen){
  var runs=[], b=false, u=false, re=/\{\{([^{}]*)\}\}|\*\*|__/g, at=0, m;
  function text(t){ if(t) runs.push({ s:t, b:b, u:u }); }
  while((m=re.exec(s))){
    text(s.slice(at, m.index)); at=re.lastIndex;
    if(m[0]==='**'){ b=!b; continue; }
    if(m[0]==='__'){ u=!u; continue; }
    var parts=m[1].split('|'), label=parts[0].replace(/\s+/g,' ').trim().slice(0,60), opt={};
    parts.slice(1).forEach(function(p){ opt[p.trim().toLowerCase()]=true; });
    if(!label) continue;
    var key=label.toLowerCase();
    if(!seen[key]){ seen[key]={ label:label, today:!!opt.today, optional:!!opt.optional }; fields.push(seen[key]); }
    else { if(opt.today) seen[key].today=true; if(!opt.optional) seen[key].optional=false; }
    runs.push({ f:seen[key].label, b:b, u:u });
  }
  text(s.slice(at));
  return runs;
}
function parse(body, signFields){
  var lines=String(body||'').replace(/\r\n?/g,'\n').replace(/[​-‍﻿]/g,'').split('\n');
  var blocks=[], fields=[], seen={}, gap=false, m;
  lines.forEach(function(raw){
    var line=raw.replace(/\s+$/,'');
    if(!line.trim()){ if(blocks.length) gap=true; return; }
    var blk;
    if((m=line.match(/^\s*\[\[\s*sign(?:atures?)?\b\s*(.*?)\]\]$/i))){
      var caps=m[1].split('|');
      blk={ t:'sign', left:(caps[0]||'').trim(), right:(caps[1]||'').trim() };
    } else if((m=line.match(/^#\s+(.*)$/))) blk={ t:'title', runs:inline(m[1], fields, seen) };
    else if((m=line.match(/^##\s+(.*)$/))) blk={ t:'head', runs:inline(m[1], fields, seen) };
    else {
      var lvl=(/^\s/.test(line) || /^>/.test(line)) ? 1 : 0, tok='';
      line=line.replace(/^\s*>?\s*/,'');
      if((m=line.match(/^(\d{1,3}(?:\.\d{1,3})*\.?)\s+(\S.*)$/))){ tok=m[1]; line=m[2]; lvl=0; }
      else if((m=line.match(/^(\([a-zA-Z0-9]{1,5}\)|[a-z]\)|[•\-–])\s+(\S.*)$/))){ tok=m[1]==='-'||m[1]==='–'?'•':m[1]; line=m[2]; lvl=1; }
      blk={ t:'p', lvl:lvl, tok:tok, runs:inline(line, fields, seen) };
    }
    blk.gap=gap; gap=false;
    blocks.push(blk);
  });
  if(!blocks.some(function(x){ return x.t==='sign'; })) blocks.push({ t:'sign', left:'', right:'', gap:true });
  /* the signer's own lines under their signature: a label, and the box it takes
     its value from -- one of the document's own, or a new one */
  var sf=(signFields||[]).map(function(f){
    var label=String(f && (f.label||f) || '').trim(), field=String(f && f.field || label).trim();
    if(!label) return null;
    var key=field.toLowerCase();
    if(!seen[key]){ seen[key]={ label:field, today:false, optional:false, signOnly:true }; fields.push(seen[key]); }
    return { label:label, field:seen[key].label };
  }).filter(Boolean);
  return { blocks:blocks, fields:fields, signFields:sf };
}

/* ----------------------------------------------------------------- dates */
var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function ordinal(n){ var s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
function longDate(d){ d=d||new Date(); return ordinal(d.getDate())+' '+MONTHS[d.getMonth()]+' '+d.getFullYear(); }

/* ------------------------------------------------------------------ HTML */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function runsHtml(runs, o){
  return runs.map(function(r){
    var inner;
    if(r.f!=null){
      var v=(o.values||{})[r.f];
      if(o.edit) inner='<input class="fx-in" type="text" data-f="'+esc(r.f)+'" aria-label="'+esc(r.f)+'" placeholder="'+esc(r.f)+'" size="'+Math.max(6, Math.min(36, (v||r.f).length))+'" value="'+esc(v||'')+'" maxlength="300" autocomplete="off">';
      else inner='<mark class="fx-mk" data-f="'+esc(r.f)+'">'+(v ? esc(v) : esc(r.f))+'</mark>';
    } else inner=esc(r.s);
    if(r.u) inner='<u>'+inner+'</u>';
    if(r.b) inner='<b>'+inner+'</b>';
    return inner;
  }).join('');
}
/* o: { values, edit, sign: function(block) -> html for the signature block } */
function html(model, o){
  o=o||{};
  return model.blocks.map(function(b){
    var g=b.gap?' fx-gap':'';
    if(b.t==='title') return '<h2 class="fx-title'+g+'">'+runsHtml(b.runs,o)+'</h2>';
    if(b.t==='head')  return '<h3 class="fx-head'+g+'">'+runsHtml(b.runs,o)+'</h3>';
    if(b.t==='sign')  return '<div class="fx-sign'+g+'">'+(o.sign ? o.sign(b) : '')+'</div>';
    return '<p class="fx-p fx-l'+b.lvl+(b.tok?' fx-tok':'')+g+'">'+(b.tok?'<span class="fx-n">'+esc(b.tok)+'</span>':'')+
      '<span class="fx-t">'+runsHtml(b.runs,o)+'</span></p>';
  }).join('');
}

/* ------------------------------------------------------------------- PDF */
function code(ch){
  var c=ch.charCodeAt(0);
  if(c>=32 && c<127) return c;
  if(c>=160 && c<=255) return c;
  if(WINANSI[c]) return WINANSI[c];
  if(c===9 || c===10) return 32;
  return 63;   /* '?' for what Helvetica cannot draw */
}
function width(s, bold, size){
  var t=bold?HELVB:HELV, w=0;
  for(var i=0;i<s.length;i++){ var c=code(s[i]); w+=t[c-32]||556; }
  return w*size/1000;
}
function hex(s){ var o=''; for(var i=0;i<s.length;i++){ var c=code(s[i]); o+=(c<16?'0':'')+c.toString(16); } return '<'+o+'>'; }
function n2(x){ return (Math.round(x*100)/100).toString(); }

/* runs -> words: each a piece of text with its style; a filled box is yellow */
function words(runs, values){
  var out=[];
  runs.forEach(function(r){
    var s, hl=false;
    if(r.f!=null){ s=String((values||{})[r.f]||'').replace(/\s+/g,' ').trim(); hl=true; if(!s) s='            '; }
    else s=r.s;
    var parts=s.split(/( +)/);
    parts.forEach(function(p, i){
      if(p==='') return;
      if(/^ +$/.test(p)){ if(out.length) out[out.length-1].sp=true; return; }
      out.push({ s:p, b:r.b, u:r.u, hl:hl, sp:false, glue: i===0 && out.length && !out[out.length-1].sp });
    });
  });
  return out;
}
/* break words into lines no wider than w */
function lines(ws, w, size){
  var out=[], cur=[], cw=0, spw=width(' ',false,size);
  function measure(ln){ return ln.reduce(function(a,x,i){ return a+x.w+(i && !x.glue ? spw : 0); },0); }
  ws.forEach(function(x){
    x.w=width(x.s,x.b,size);
    var add=(cur.length && !x.glue ? spw : 0)+x.w;
    if(cur.length && cw+add>w){
      /* a word glued to the one before it -- the quote after (“Facerinna --
         goes down with it, back to the last space */
      var k=cur.length;
      if(x.glue){ k=cur.length-1; while(k>0 && cur[k].glue) k--; }
      if(k>0){
        var rest=cur.slice(k); out.push(cur.slice(0,k));
        if(rest.length) rest[0]=Object.assign({}, rest[0], { glue:false });
        cur=rest; cw=measure(cur); add=(cur.length && !x.glue ? spw : 0)+x.w;
      }
    }
    cur.push(x); cw+=add;
  });
  if(cur.length) out.push(cur);
  return out;
}

/* d: { title, values, signFields, ours:{caption,name,title,email,sig}, theirs:{caption,sig,name,date},
        footer }   sig: { jpeg: Uint8Array, w, h } */
function pdf(model, d){
  var W=595.28, H=841.89, L=62, R=W-62, TOP=H-64, BOT=70, SIZE=10.2, LEAD=13.6;
  var pages=[], ops=null, y=0, images=[];
  function page(){ ops=[]; pages.push(ops); y=TOP; }
  function need(h){ if(y-h<BOT) page(); }
  function txt(x, yy, s, bold, size){ ops.push('BT /'+(bold?'F2':'F1')+' '+n2(size)+' Tf '+n2(x)+' '+n2(yy)+' Td '+hex(s)+' Tj ET'); }
  function rect(x, yy, w, h, rgb){ ops.push(rgb+' rg '+n2(x)+' '+n2(yy)+' '+n2(w)+' '+n2(h)+' re f 0 g'); }
  function hline(x1, x2, yy, wdt){ ops.push(n2(wdt||0.6)+' w '+n2(x1)+' '+n2(yy)+' m '+n2(x2)+' '+n2(yy)+' l S'); }
  function image(sig, x, yy, maxW, maxH){
    if(!sig || !sig.jpeg) return;
    var k=Math.min(maxW/sig.w, maxH/sig.h), w=sig.w*k, h=sig.h*k, n=images.length+1;
    images.push(sig);
    ops.push('q '+n2(w)+' 0 0 '+n2(h)+' '+n2(x)+' '+n2(yy)+' cm /Im'+n+' Do Q');
  }
  /* a paragraph: words laid into lines, justified but for the last, boxes yellow */
  function para(runs, x0, size, bold, center, justify){
    var ws=words(runs, d.values); if(bold) ws.forEach(function(x){ x.b=true; });
    var ls=lines(ws, R-x0, size), lead=size*LEAD/SIZE, spw=width(' ',false,size);
    ls.forEach(function(ln, li){
      need(lead);
      y-=lead;
      var natural=ln.reduce(function(a,x,i){ return a+x.w+(i && !x.glue ? spw : 0); },0);
      var gaps=ln.filter(function(x,i){ return i && !x.glue; }).length;
      var extra=(justify && li<ls.length-1 && gaps) ? Math.max(0, Math.min((R-x0-natural)/gaps, spw*3)) : 0;
      var x=center ? x0+(R-x0-natural)/2 : x0;
      ln.forEach(function(wd, i){
        if(i && !wd.glue) x+=spw+extra;
        if(wd.hl){
          var prev=ln[i-1], join=prev && prev.hl && !wd.glue;
          rect(join ? x-spw-extra-0.3 : x-1.5, y-2.6, wd.w+(join?spw+extra+0.3:1.5)+1.5, size+3.2, '1 0.93 0.2');
        }
        txt(x, y, wd.s, wd.b, size);
        if(wd.u){ var pu=ln[i-1], ju=pu && pu.u && !wd.glue; hline(ju ? x-spw-extra : x, x+wd.w, y-1.4, 0.5); }
        x+=wd.w;
      });
    });
  }
  page();
  function signHeight(){ return 18+66+Math.max(3, (d.signFields||[]).length+2)*LEAD+LEAD*2; }
  model.blocks.forEach(function(b, bi){
    if(b.gap) y-=LEAD*0.5;
    var nx=model.blocks[bi+1];
    if((b.t==='head' || b.t==='title') && nx && nx.t==='sign') need(LEAD*2+signHeight());
    if(b.t==='title'){ y-=4; para(b.runs, L, 13, true, true, false); y-=10; return; }
    if(b.t==='head'){ y-=2; para(b.runs, L, 10.8, true, false, false); y-=4; return; }
    if(b.t==='sign'){ signBlock(b); return; }
    var x0=L+(b.lvl*STEP), xt=x0+(b.tok?STEP:0);
    if(b.tok){
      need(LEAD);
      var tokY=y-LEAD;
      txt(x0, tokY, b.tok, !!(b.runs[0] && b.runs[0].b), SIZE);
    }
    para(b.runs, xt, SIZE, false, false, true);
    y-=3.5;
  });
  function signBlock(b){
    var colW=(R-L-30)/2, xl=L, xr=L+colW+30;
    need(signHeight());
    y-=8;
    txt(xl, y-SIZE, b.left || (d.ours && d.ours.caption) || 'FACERINNA', true, SIZE);
    txt(xr, y-SIZE, b.right || (d.theirs && d.theirs.caption) || 'Signed by', true, SIZE);
    y-=SIZE+8;
    var lineY=y-62;
    image(d.ours && d.ours.sig, xl, lineY+4, colW*0.8, 54);
    image(d.theirs && d.theirs.sig, xr, lineY+4, colW*0.8, 54);
    ops.push('0 g'); hline(xl, xl+colW*0.85, lineY); hline(xr, xr+colW*0.85, lineY);
    var yl=lineY, yr=lineY;
    var FS=SIZE-0.6;
    /* label: value, the value wrapped under itself (an address is long), three lines at most */
    function line(x, yy, label, value, hl){
      var s=label ? label+': ' : '', lw=width(s,false,FS), max=colW-lw-4, out=[], cur='';
      String(value||'').replace(/\s+/g,' ').trim().split(' ').forEach(function(wd){
        var t=cur ? cur+' '+wd : wd;
        if(cur && width(t,false,FS)>max){ out.push(cur); cur=wd; } else cur=t;
      });
      if(cur) out.push(cur);
      if(out.length>3){ out=out.slice(0,3); out[2]+='\u2026'; }
      out=out.map(function(v){ while(v.length>1 && width(v,false,FS)>max) v=v.slice(0,-2)+'\u2026'; return v; });
      txt(x, yy, s, false, FS);
      out.forEach(function(v, i){
        var ly=yy-i*(LEAD-1.5);
        if(hl) rect(x+lw-1.2, ly-2.4, width(v,false,FS)+2.4, SIZE+2.2, '1 0.93 0.2');
        txt(x+lw, ly, v, false, FS);
      });
      return Math.max(1, out.length);
    }
    var o=d.ours||{};
    [['Name',o.name],['Designation',o.title],['Email',o.email]].forEach(function(p){ if(p[1]){ yl-=LEAD; var n=line(xl, yl, p[0], p[1]); yl-=(n-1)*(LEAD-1.5); } });
    (d.signFields||[]).forEach(function(f){ yr-=LEAD; var n=line(xr, yr, f.label, (d.values||{})[f.field], true); yr-=(n-1)*(LEAD-1.5); });
    var t=d.theirs||{};
    if(t.name){ yr-=LEAD; line(xr, yr, 'Signed by', t.name, false); }
    if(t.date){ yr-=LEAD; line(xr, yr, 'Date', t.date, false); }
    y=Math.min(yl, yr)-LEAD;
  }

  /* footers, now the page count is known */
  pages.forEach(function(p, i){
    p.push('0.45 g');
    var f=(d.footer||'')+'   Page '+(i+1)+' of '+pages.length;
    var fw=width(f,false,7.5);
    p.push('BT /F1 7.5 Tf '+n2((W-fw)/2)+' 34 Td '+hex(f)+' Tj ET');
    p.push('0 g');
  });

  /* ---- the file ---- */
  var chunks=[], offs=[], len=0;
  function put(s){ var u=(typeof s==='string') ? latin1(s) : s; chunks.push(u); len+=u.length; }
  function latin1(s){ var u=new Uint8Array(s.length); for(var i=0;i<s.length;i++) u[i]=s.charCodeAt(i)&255; return u; }
  var nObj=0, objs=[];
  function reserve(){ return ++nObj; }
  var cat=reserve(), pagesId=reserve(), f1=reserve(), f2=reserve(), info=reserve();
  var imgIds=images.map(function(){ return reserve(); });
  var pageIds=pages.map(function(){ return [reserve(), reserve()]; });
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  function obj(id, body, stream){
    offs[id]=len;
    put(id+' 0 obj\n'+body+(stream ? '\nstream\n' : '\nendobj\n'));
    if(stream){ put(stream); put('\nendstream\nendobj\n'); }
  }
  obj(cat, '<< /Type /Catalog /Pages '+pagesId+' 0 R >>');
  obj(pagesId, '<< /Type /Pages /Count '+pages.length+' /Kids ['+pageIds.map(function(p){ return p[0]+' 0 R'; }).join(' ')+'] >>');
  obj(f1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(f2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  var now=new Date(), pad=function(n){ return (n<10?'0':'')+n; };
  var stamp='D:'+now.getUTCFullYear()+pad(now.getUTCMonth()+1)+pad(now.getUTCDate())+pad(now.getUTCHours())+pad(now.getUTCMinutes())+pad(now.getUTCSeconds())+'Z';
  obj(info, '<< /Title '+hex(d.title||'Document')+' /Producer (FACERINNA booth) /CreationDate ('+stamp+') >>');
  images.forEach(function(im, i){
    obj(imgIds[i], '<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.jpeg.length+' >>', im.jpeg);
  });
  var xobj=images.length ? ' /XObject << '+images.map(function(_, i){ return '/Im'+(i+1)+' '+imgIds[i]+' 0 R'; }).join(' ')+' >>' : '';
  pages.forEach(function(p, i){
    var content=p.join('\n');
    obj(pageIds[i][0], '<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+n2(W)+' '+n2(H)+'] /Resources << /Font << /F1 '+f1+' 0 R /F2 '+f2+' 0 R >>'+xobj+' >> /Contents '+pageIds[i][1]+' 0 R >>');
    obj(pageIds[i][1], '<< /Length '+content.length+' >>', latin1(content));
  });
  var xref=len;
  var x='xref\n0 '+(nObj+1)+'\n0000000000 65535 f \n';
  for(var i=1;i<=nObj;i++) x+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
  put(x+'trailer\n<< /Size '+(nObj+1)+' /Root '+cat+' 0 R /Info '+info+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  var out=new Uint8Array(len), at=0;
  chunks.forEach(function(c){ out.set(c, at); at+=c.length; });
  return { bytes:out, pages:pages.length };
}

/* a picture (data URL or canvas) as a JPEG on white, for the PDF */
function jpegOf(src, maxW){
  return new Promise(function(res){
    function draw(img, w, h){
      var k=Math.min(1, (maxW||600)/w), c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(w*k)); c.height=Math.max(1,Math.round(h*k));
      var g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
      var b64=c.toDataURL('image/jpeg',0.92).split(',')[1], bin=atob(b64), u=new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
      res({ jpeg:u, w:c.width, h:c.height });
    }
    if(!src) return res(null);
    if(src.getContext) return draw(src, src.width, src.height);
    var im=new Image(); im.onload=function(){ draw(im, im.naturalWidth, im.naturalHeight); }; im.onerror=function(){ res(null); }; im.src=src;
  });
}

window.FxDoc={ parse:parse, html:html, pdf:pdf, jpegOf:jpegOf, longDate:longDate, esc:esc, _width:width };
})();
