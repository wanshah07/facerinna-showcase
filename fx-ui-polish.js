/* Local, progressive UI polish. Game loops remain dependency-free. */
(function(){
'use strict';
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.Lenis){
 var lenis=new Lenis({duration:0.75,smoothWheel:true,syncTouch:false});
 function frame(t){lenis.raf(t);requestAnimationFrame(frame)}requestAnimationFrame(frame);
 document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var el=document.querySelector(a.getAttribute('href'));if(el){e.preventDefault();lenis.scrollTo(el)}})});
}
if(window.lucide) lucide.createIcons({attrs:{'aria-hidden':'true',width:20,height:20}});
if(window.Motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
 var cards=document.querySelectorAll('.card, .hero-card, .product-card');
 if(cards.length) Motion.animate(cards,{opacity:[0,1],transform:['translateY(8px)','translateY(0)']},{duration:.35,easing:'ease-out'});
}
})();