/* Local, progressive UI polish. Game loops remain dependency-free. */
(function(){
'use strict';
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.Lenis){
 var lenis=new Lenis({duration:0.75,smoothWheel:true,syncTouch:false});
 function frame(t){lenis.raf(t);requestAnimationFrame(frame)}requestAnimationFrame(frame);
 /* Anchor links (the header, the footer, the Booth button) are NOT handled here. index.html owns them:
    it lands the segment under the header, then re-measures and corrects while the page settles.
    A second handler here that called lenis.scrollTo(el) took the click first, measured once, and
    landed up to half a screen off on wide screens, where the layout shifts while the page scrolls. */
}
if(window.lucide) lucide.createIcons({attrs:{'aria-hidden':'true',width:20,height:20}});
if(window.Motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
 var cards=document.querySelectorAll('.card, .hero-card, .product-card');
 if(cards.length) Motion.animate(cards,{opacity:[0,1],transform:['translateY(8px)','translateY(0)']},{duration:.35,easing:'ease-out'});
}
})();