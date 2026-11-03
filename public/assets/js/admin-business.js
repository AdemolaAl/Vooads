/* Vooads admin: business extensions (Oct 2026).
   Customer spend + revenue dashboard, customer page, Connect VooSquare wizard + agent roles, the role builder, the payment
   method wizard (with sandbox test and bank transfers), the AI model wizard and the no-code AI tools builder.
   Loaded by admin.html before its main script; admin.html hands over its building blocks (window.VA_EXT). */
(function () {
'use strict';
(window.VA_EXT = window.VA_EXT || []).push(function (A) {
const { $, $$, esc, S, can, clone, num, money, int, parseDate, ago, fdate, initials, debounce, api, GET, POST, PUT, DEL, tryGet, toast, act, copy, IC, ico, FACE, ARR, SECTIONS, VIEWS, route, openDrawer, closeDrawer, modal, confirmDel, sw, statusPill, emptyCard, tbl, customerDrawer, istat, METHOD_INFO, uploadImage, ACTION_LABEL } = A;
const TI = window.VooToolIcons || { svg: () => '', names: [] };

// ---------------------------------------------------------------- styles
const css = document.createElement('style');
css.textContent = `
:root{--mono:var(--sans)}
.num,.kpi .v,.tile b,.mny{font-variant-numeric:tabular-nums}
.k,.inp.mono,.codeblock,.tplcheck,.endpoint code,.copybox code{font-family:var(--sans)!important}
.mny.neg{color:var(--bad)}.mny.pos{color:var(--good)}.mny.dim{color:var(--mut2)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.toolbar .grow{min-width:180px}
.srch{position:relative}.srch>svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--mut2);pointer-events:none}.srch input.inp{padding-left:38px}
.toolbar select.inp{flex:1 1 150px}
.note.good{background:var(--good-bg);border-color:#BFE6CC;color:#0E5F33}
.rng-in{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rng-in input{max-width:150px}
.sumstrip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border-bottom:1px solid var(--line)}
.sumstrip div{background:#fff;padding:12px 18px}.sumstrip span{display:block;font-size:12px;font-weight:700;color:var(--mut)}.sumstrip b{font-size:18px;letter-spacing:-.03em}
@media (max-width:760px){.sumstrip{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tbl th.sorth{cursor:pointer;user-select:none;transition:color .15s}.tbl th.sorth:hover{color:var(--ink)}
.tbl th.sorth i{font-style:normal;opacity:.35;margin-left:4px}.tbl th.sorth.on{color:var(--ink)}.tbl th.sorth.on i{opacity:1}
.cbar{display:block;height:4px;border-radius:9px;background:var(--soft);overflow:hidden;margin-top:6px;min-width:60px}.cbar i{display:block;height:100%;border-radius:9px;background:var(--ink);transform-origin:left;animation:barin .8s var(--ease) both}
@keyframes barin{from{transform:scaleX(0)}}
.cust-h{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.cust-h .avatar{width:56px;height:56px;font-size:18px}
.cust-h h2{font-size:clamp(22px,3vw,30px);letter-spacing:-.045em;word-break:break-word}
.backl{display:inline-flex;align-items:center;gap:6px;color:var(--mut);font-weight:700;font-size:13.5px;text-decoration:none;margin-bottom:14px}.backl svg{width:16px;height:16px}.backl:hover{color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px;animation:up .45s var(--ease) both;animation-delay:calc(var(--i,0)*45ms)}
.tile span{font-size:12px;font-weight:700;color:var(--mut)}.tile b{display:block;font-size:22px;letter-spacing:-.04em;margin-top:4px}.tile small{display:block;color:var(--mut2);font-size:12px;margin-top:2px}
.tile b span{font-size:inherit;font-weight:inherit;color:inherit}.tile b .mny.neg{color:var(--bad)}
.tile.ink{background:var(--ink);border-color:var(--ink);color:#fff}.tile.ink span{color:#B9B2A4}.tile.ink small{color:#8F897C}
.tl{display:grid}
.tl .ev{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;position:relative;animation:up .4s var(--ease) both;animation-delay:calc(var(--i,0)*35ms)}
.tl .ev::before{content:"";position:absolute;left:17px;top:46px;bottom:-10px;width:2px;background:var(--line)}
.tl .ev:last-child::before{display:none}
.tl .dot2{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--soft);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink)}
.tl .dot2 svg{width:16px;height:16px}
.tl .ev.refund .dot2{background:var(--bad-bg);color:var(--bad);box-shadow:none}.tl .ev.payment .dot2,.tl .ev.topup .dot2{background:var(--good-bg);color:var(--good);box-shadow:none}
.tl .ev b{font-size:14px}.tl .ev small{display:block;color:var(--mut2);font-size:12.5px}
.fin{display:grid;gap:14px}
.fin-k{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:1000px){.fin-k{grid-template-columns:repeat(2,minmax(0,1fr))}}
.fchart{width:100%;height:220px;display:block;overflow:visible}
.fchart .ar{fill:url(#fgrad);opacity:0;animation:fadeup .9s var(--ease) .2s forwards}
.fchart .ln2{fill:none;stroke:var(--ink);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:2400;stroke-dashoffset:2400;animation:draw 1.5s var(--ease) forwards}
.fchart .rf{fill:var(--bad);opacity:.85}
.fchart .hit{fill:transparent;cursor:crosshair}.fchart .hit:hover{fill:rgba(11,11,10,.04)}
.fchart .gl{stroke:var(--line);stroke-dasharray:3 4}
.fchart text{font-family:var(--sans);font-size:11px;fill:#A19E95}
@keyframes fadeup{to{opacity:1}}
.tops{display:grid}
.topr{display:grid;grid-template-columns:22px 34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;border-radius:10px;transition:background .15s;animation:up .4s var(--ease) both;animation-delay:calc(var(--i,0)*40ms)}
.topr:last-child{border-bottom:0}.topr:hover{background:var(--soft)}
.topr .rk{font-weight:800;color:var(--mut2);font-size:13px;text-align:center}
.topr .avatar{width:34px;height:34px;font-size:12px}
.topr .nm{min-width:0}.topr .nm b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.topr .nm small{display:block;color:var(--mut2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topr .v{text-align:right;font-weight:800}
.wz{display:grid;gap:18px}
.wz-steps{display:flex;gap:4px;align-items:center;overflow-x:auto;scrollbar-width:none;margin:-2px -2px 0;padding:2px}
.wz-steps::-webkit-scrollbar{display:none}
.wz-steps button{display:flex;align-items:center;gap:8px;border:0;background:none;font:inherit;font-weight:700;font-size:13px;color:var(--mut2);padding:5px 11px 5px 5px;border-radius:999px;white-space:nowrap;cursor:pointer;transition:background .2s,color .2s}
.wz-steps button:disabled{cursor:default}
.wz-steps button i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:11.5px;background:#fff;box-shadow:inset 0 0 0 1.5px var(--line2);transition:all .3s var(--ease)}
.wz-steps button i svg{width:13px;height:13px}
.wz-steps button.on{color:var(--ink);background:#fff;box-shadow:0 0 0 1px var(--line),0 6px 14px -10px rgba(11,11,10,.3)}
.wz-steps button.on i{background:var(--ink);color:#fff;box-shadow:none}
.wz-steps button.done{color:var(--ink)}.wz-steps button.done i{background:var(--good);color:#fff;box-shadow:none}
.wz-steps .sep{flex:0 0 14px;height:1.5px;background:var(--line2);border-radius:2px}
.wz-pane{animation:wzin .38s var(--ease) both;display:grid;gap:14px}
@keyframes wzin{from{opacity:0;transform:translateX(16px)}}
.wz-pane h3{font-size:19px;letter-spacing:-.035em}.wz-pane>p.sub,.wz-pane .lead2{color:var(--mut);font-size:14px;margin-top:-6px}
.wz-foot{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:14px}
.picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.pick{border:1.5px solid var(--line2);border-radius:16px;padding:14px;cursor:pointer;background:#fff;text-align:left;font:inherit;color:inherit;display:grid;gap:8px;align-content:start;transition:border-color .2s,box-shadow .2s,transform .25s var(--ease);position:relative}
.pick:hover{transform:translateY(-2px);border-color:var(--ink)}
.pick.on{border-color:var(--ink);box-shadow:0 0 0 3px rgba(11,11,10,.07)}
.pick.on::after{content:"";position:absolute;top:12px;right:12px;width:18px;height:18px;border-radius:50%;background:var(--ink) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center/11px no-repeat;animation:pop .25s var(--ease)}
.pick .pi{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;color:#fff;background:var(--ink);font-weight:800;font-size:14px;letter-spacing:-.03em}
.pick .pi svg{width:19px;height:19px}
.pick b{font-size:14.5px;letter-spacing:-.02em}.pick small{color:var(--mut);font-size:12.5px;line-height:1.45}
.pick:disabled{opacity:.45;cursor:not-allowed;transform:none}
.checks{display:grid;gap:8px}
.chk2{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:14px;background:#fff;animation:up .35s var(--ease) both;animation-delay:calc(var(--i,0)*70ms)}
.chk2 .ic{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;margin-top:1px}
.chk2 .ic svg{width:12px;height:12px}
.chk2.ok .ic{background:var(--good)}.chk2.no .ic{background:var(--bad)}
.chk2 b{font-size:14px;display:block}.chk2 span{font-size:13px;color:var(--mut);word-break:break-word}
.codeblock{white-space:pre-wrap;word-break:break-all;background:var(--ink);color:#E8E4DA;border-radius:14px;padding:12px 14px;font-size:12.5px;line-height:1.55;max-height:280px;overflow:auto}
.hl{background:var(--brand-soft);border:1px solid var(--brand-soft2);border-radius:14px;padding:12px 14px;font-size:13.5px;color:var(--brand-dd)}
.rows2{display:grid;gap:8px}
.cprow{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr);gap:10px;align-items:center}
.cprow>span{font-size:13px;font-weight:700;color:var(--mut)}
@media (max-width:560px){.cprow{grid-template-columns:1fr;gap:4px}}
.rb-sum{background:var(--soft);border:1px solid var(--line);border-radius:16px;padding:12px 14px;font-size:13.5px;color:#3B3832;line-height:1.55}
.rb-group{border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:12px;background:#fff;animation:up .4s var(--ease) both;animation-delay:calc(var(--i,0)*45ms)}
.rb-gh{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--soft);border-bottom:1px solid var(--line)}
.rb-gh .gi{width:30px;height:30px;border-radius:10px;background:var(--ink);color:#fff;display:grid;place-items:center;flex:none}.rb-gh .gi svg{width:15px;height:15px}
.rb-gh b{font-size:14.5px;flex:1}.rb-gh small{color:var(--mut2);font-size:12px;font-weight:700}
.rb-row{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);font-size:14px;cursor:pointer}
.rb-row:last-child{border-bottom:0}.rb-row:hover{background:#FCFBF8}
.rb-row span{min-width:0}
.vsq{overflow:hidden;position:relative}
.vsq-h{display:flex;gap:16px;align-items:center;padding:20px 22px;flex-wrap:wrap}
.vsq-orb{width:54px;height:54px;border-radius:17px;background:var(--ink);display:grid;place-items:center;color:#fff;position:relative;flex:none}
.vsq-orb svg{width:24px;height:24px}
.vsq-orb::after{content:"";position:absolute;inset:-5px;border-radius:21px;border:1.5px solid var(--brand);opacity:0;animation:orb 2.6s var(--ease) infinite}
.vsq.ok .vsq-orb::after{border-color:var(--good)}
@keyframes orb{0%{opacity:.7;transform:scale(.92)}100%{opacity:0;transform:scale(1.18)}}
.vsq-h h3{font-size:19px;letter-spacing:-.035em}.vsq-h p{color:var(--mut);font-size:13.5px;margin-top:3px;max-width:62ch}
.vsq-b{border-top:1px solid var(--line);padding:20px 22px;background:linear-gradient(180deg,#FDFCFA,#fff)}
.pingbox{display:grid;gap:10px}
.pingrow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:12px 14px;background:#fff}
.pingrow .lane{height:3px;border-radius:3px;background:var(--line);position:relative;overflow:hidden;min-width:60px}
.pingrow .lane i{position:absolute;top:-3px;width:9px;height:9px;border-radius:50%;background:var(--brand);left:-10px}
.pingrow.run .lane i{animation:lane 1.1s linear infinite}
.pingrow.ok .lane{background:var(--good)}.pingrow.no .lane{background:var(--bad)}
@keyframes lane{to{left:100%}}
.pingrow .end{font-weight:800;font-size:13px;white-space:nowrap}
.pingrow p{grid-column:1/-1;font-size:13px;color:var(--mut);margin:0}
.agrow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:8px;align-items:center}
@media (max-width:560px){.agrow{grid-template-columns:1fr auto}.agrow select{grid-column:1/-1;order:3}}
.tcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.tcard{padding:18px;display:grid;gap:12px;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:transform .25s var(--ease),box-shadow .25s;animation:up .45s var(--ease) both;animation-delay:calc(var(--i,0)*45ms)}
.tcard:hover{transform:translateY(-3px);box-shadow:0 26px 44px -32px rgba(11,11,10,.45)}
.tcard .top{display:flex;gap:12px;align-items:center}
.ticon{width:44px;height:44px;border-radius:14px;background:var(--ink);color:#fff;display:grid;place-items:center;flex:none}
.ticon svg{width:21px;height:21px}
.tcard h4{font-size:16px;letter-spacing:-.03em}.tcard p{font-size:13px;color:var(--mut);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tstat{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;background:var(--soft);box-shadow:inset 0 0 0 1px var(--line);color:var(--mut)}
.tstat::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.tstat.live{color:var(--good);background:var(--good-bg);box-shadow:none}.tstat.live::before{animation:none}
.tstat.testing{color:#4A3BD1;background:#ECE9FF;box-shadow:none}.tstat.paused{color:var(--warn);background:var(--warn-bg);box-shadow:none}
.tb{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start}
@media (max-width:1100px){.tb{grid-template-columns:1fr}}
.tb-sec{padding:18px 20px;display:grid;gap:14px}
.tb-sec>h3{font-size:16px;letter-spacing:-.03em;display:flex;align-items:center;gap:10px}
.tb-sec>h3 .n{width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;font-size:12px;display:grid;place-items:center;flex:none}
.icgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:6px}
.icgrid button{aspect-ratio:1;border:1px solid var(--line2);border-radius:12px;background:#fff;display:grid;place-items:center;cursor:pointer;color:var(--ink);transition:all .2s var(--ease)}
.icgrid button:hover{border-color:var(--ink);transform:translateY(-1px)}
.icgrid button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.fldc{border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:10px;background:#fff;animation:up .3s var(--ease) both}
.fldc .fh{display:flex;gap:8px;align-items:center}
.fldc .fh b{flex:1;font-size:14px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fldc .fgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
@media (max-width:640px){.fldc .fgrid{grid-template-columns:1fr 1fr}}
.chipins{display:flex;flex-wrap:wrap;gap:5px}
.chipins button{font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line2);background:#fff;border-radius:999px;padding:4px 10px;cursor:pointer;transition:all .15s}
.chipins button:hover{background:var(--ink);color:#fff;border-color:var(--ink)}
.phone{position:sticky;top:16px;background:var(--ink);border-radius:30px;padding:10px;box-shadow:0 40px 70px -40px rgba(11,11,10,.6)}
.phone .scr{background:var(--app);border-radius:22px;padding:16px;display:grid;gap:12px;min-height:360px;align-content:start}
.phone .ph-h{display:flex;gap:10px;align-items:center}
.phone .ph-h b{font-size:15px;letter-spacing:-.02em}.phone .ph-h small{display:block;color:var(--mut);font-size:12px}
.phone .ph-cap{text-align:center;color:#8F897C;font-size:11.5px;font-weight:700;padding:8px 0 2px;letter-spacing:.04em}
.tryout{display:grid;gap:8px}
.tryout img,.tryout video{width:100%;border-radius:14px;background:var(--ink)}
.tryout ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:14px}
.pricebox{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pricebox div{background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.pricebox span{font-size:11.5px;font-weight:700;color:var(--mut);display:block}.pricebox b{font-size:17px}
@media (max-width:560px){.pricebox{grid-template-columns:1fr 1fr}}
.tb-bar{position:sticky;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:30;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:20px;padding:10px 12px;box-shadow:0 24px 50px -30px rgba(11,11,10,.45);margin-top:14px}
.tb-bar .grow{min-width:120px}
.vh{display:grid}.vh .li{gap:10px}
.proof{width:64px;height:64px;border-radius:12px;background:var(--soft) center/cover no-repeat;border:1px solid var(--line);flex:none;cursor:zoom-in}
.mlogo img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.seg.sm button{padding:6px 10px;font-size:13px}
.ovhide{color:var(--mut2)!important}
`;
document.head.appendChild(css);

// ---------------------------------------------------------------- helpers
Object.assign(IC, {
  features: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  history: 'M12 8v4l3 3M3.05 11a9 9 0 1 1 .5 4M3 4v5h5',
  bank: 'M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10 12 3l10 7z',
});
const GROUP_IC = { support: 'headset', users: 'customers', money: 'coin', content: 'blog', settings: 'settings', ai: 'features', other: 'list' };
const usd = (n, dp = 2) => (num(n) < 0 ? '−' : '') + money(Math.abs(num(n)), dp);
const usd0 = (n) => (num(n) < 0 ? '−' : '') + money(Math.abs(num(n)), Math.abs(num(n)) >= 1000 ? 0 : 2);
const mny = (n, cls = '') => `<span class="mny ${num(n) < 0 ? 'neg' : ''} ${cls}">${usd(n)}</span>`;
const go = (h) => { try { history.pushState(null, '', h); } catch { location.hash = h; return; } route(); };
const seg = (id, opts, cur, cls = '') => `<div class="seg ${cls}" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const segWire = (root, id, fn) => $$('#' + id + ' button', root).forEach((b) => b.onclick = () => { $$('#' + id + ' button', root).forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem('va_x_' + k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('va_x_' + k, JSON.stringify(v)); } catch {} } };
const checkList = (steps) => `<div class="checks">${steps.map((x, i) => `<div class="chk2 ${x.ok ? 'ok' : 'no'}" style="--i:${i}"><span class="ic">${ico(x.ok ? 'check' : 'x')}</span><div><b>${esc(x.label)}</b><span>${esc(x.note || '')}</span></div></div>`).join('')}</div>`;
const wzSteps = (labels, cur, done = []) => `<div class="wz-steps">${labels.map((l, i) => `${i ? '<span class="sep"></span>' : ''}<button type="button" data-step="${i}" class="${i === cur ? 'on' : done.includes(i) ? 'done' : ''}" ${done.includes(i) || i === cur ? '' : 'disabled'}><i>${done.includes(i) && i !== cur ? ico('check') : i + 1}</i>${esc(l)}</button>`).join('')}</div>`;
const copyRow = (label, value, secret = false) => `<div class="cprow"><span>${esc(label)}</span><div class="copybox"><code title="${esc(value)}">${esc(value)}</code><button type="button" class="btn ghost xs" data-cp="${esc(value)}">${ico('copy')} Copy</button></div></div>${secret ? '' : ''}`;
const wireCopies = (root) => $$('[data-cp]', root).forEach((b) => b.onclick = () => copy(b.dataset.cp));
const swOn = (b) => b.getAttribute('aria-checked') === 'true';
const swToggle = (b, v) => { const on = v === undefined ? !swOn(b) : !!v; b.setAttribute('aria-checked', on); return on; };
const dateIn = (d) => d.toISOString().slice(0, 10);
function rangeOf(r) {
  const t = new Date();
  if (r === '30d') return { from: dateIn(new Date(t - 29 * 864e5)), to: dateIn(t) };
  if (r === '90d') return { from: dateIn(new Date(t - 89 * 864e5)), to: dateIn(t) };
  if (r === 'ytd') return { from: t.getUTCFullYear() + '-01-01', to: dateIn(t) };
  return { from: '', to: '' };
}

Object.assign(ACTION_LABEL, {
  'finance.export': 'Exported customer spend (CSV)', 'voosquare.connect': 'Connected VooSquare', 'voosquare.agents': 'Mapped VooSquare agents to roles',
  'payment.approve': 'Approved a bank transfer', 'payment.reject': 'Rejected a bank transfer', 'payment_method.test': 'Tested a payment method', 'integrations.test': 'Ran a connection test',
  'feature.add': 'Created an AI tool', 'feature.edit': 'Edited an AI tool', 'feature.publish': 'Published an AI tool', 'feature.status': 'Changed an AI tool status',
  'feature.restore': 'Restored an AI tool version', 'feature.testers': 'Changed AI tool testers', 'feature.delete': 'Deleted an AI tool',
});

// AI tools section, right after AI providers.
const pi = SECTIONS.findIndex((s) => s.id === 'providers');
SECTIONS.splice(pi < 0 ? SECTIONS.length : pi + 1, 0, { id: 'features', label: 'AI tools', perm: 'features.view', group: 'Setup', title: ['AI tools.', 'Build without code.'], desc: 'Create new AI tools for customers: inputs, a prompt, a model and a price. Test them, then publish. Live customers are never affected by edits.' });
const custSec = SECTIONS.find((s) => s.id === 'customers');
if (custSec) { custSec.title = ['Your customers.', 'Who pays, who profits.']; custSec.desc = 'Every customer with what they spent (after refunds), credits bought and used, what their AI cost you, and profit. Sort, filter by date and export.'; }

// ================================================================ Overview: revenue block
const baseOverview = VIEWS.overview;
VIEWS.overview = async (el, acts) => {
  await baseOverview(el, acts);
  if (!el.isConnected) return;
  if (!can('users.finance')) {
    // Money is hidden for this role: no "$0" that looks real.
    const hero = $('.kpi.hero', el); if (hero) { $('.v', hero).textContent = '—'; $('.s', hero).textContent = 'Money is hidden for your role'; $('.spark', hero)?.remove(); }
    const rc = $('.grid2 .card', el); if (rc && /Revenue/.test(rc.textContent)) rc.querySelector('.card-b').innerHTML = `<div class="na" style="padding:8px 0"><span class="ic">${ico('lock')}</span><div><b>Revenue is hidden</b><p>Your role does not include "See money". Ask the owner if you need it.</p></div></div>`;
    $$('td[data-l="Amount"]', el).forEach((td) => { td.textContent = '—'; td.classList.add('ovhide'); });
    return;
  }
  // The revenue block below replaces the older 14-day revenue card; sign-ups and jobs get the full width.
  const old = $$('.grid2 > .card', el).find((c) => /Paid checkouts per day/.test(c.textContent));
  if (old) { const sib = old.parentNode; old.remove(); if (sib.children.length === 1) sib.style.gridTemplateColumns = '1fr'; }
  const host = document.createElement('div');
  host.className = 'fin';
  const k6 = $('.kpis', el);
  (k6 ? k6.parentNode : el).insertBefore(host, k6 ? k6.nextSibling : el.firstChild);
  let days = store.get('ovdays', 30);
  const draw = async () => {
    let d;
    try { d = await GET('/api/admin/finance/overview?days=' + days); } catch (e) { host.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
    const maxV = Math.max(1, ...d.top_spenders.map((t) => t.net_usd));
    host.innerHTML = `<div class="fin-k">
        <div class="tile ink" style="--i:0"><span>Total revenue</span><b>${usd0(d.total_revenue_usd)}</b><small>after ${usd0(d.refunds_usd)} refunds · all time</small></div>
        <div class="tile" style="--i:1"><span>MRR</span><b>${usd0(d.mrr_usd)}</b><small>${int(d.paying)} paying ${d.paying === 1 ? 'customer' : 'customers'}</small></div>
        <div class="tile" style="--i:2"><span>ARPU</span><b>${usd(d.arpu_usd)}</b><small>per paying customer, per month</small></div>
        <div class="tile" style="--i:3"><span>Profit, 30 days</span><b class="mny ${d.profit_30d_usd < 0 ? 'neg' : ''}">${usd0(d.profit_30d_usd)}</b><small>${usd0(d.revenue_30d_usd)} in − ${usd0(d.ai_cost_30d_usd)} AI cost</small></div></div>
      <div class="grid2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
        <div class="card"><div class="card-h"><div><h3>Revenue</h3><p>Net per day: paid minus refunds (red)</p></div>${seg('ovd', [[30, '30 days'], [90, '90 days'], [365, '1 year']], days, 'sm')}</div><div class="card-b" id="fch"></div></div>
        <div class="card"><div class="card-h"><div><h3>Top 10 spenders</h3><p>Lifetime, after refunds</p></div>${can('users.view') ? '<a class="btn ghost xs" href="#/customers">All customers</a>' : ''}</div>
          <div class="card-b tops">${d.top_spenders.length ? d.top_spenders.map((t, i) => `<a class="topr" href="#/customers/${t.id}" style="--i:${i}"><span class="rk">${i + 1}</span><span class="avatar">${esc(initials(t.name || t.email))}</span><span class="nm"><b>${esc(t.name || t.email)}</b><small>${esc(t.plan_id ? t.plan_id + ' plan' : 'No plan')} · ${int(t.credits_used)} credits used</small><span class="cbar"><i style="width:${Math.max(4, t.net_usd / maxV * 100).toFixed(1)}%"></i></span></span><span class="v">${usd0(t.net_usd)}</span></a>`).join('') : emptyCard('No paying customers yet', 'They show up here after the first payment.')}</div></div>
      </div>`;
    segWire(host, 'ovd', (v) => { days = Number(v); store.set('ovdays', days); draw(); });
    $('#fch', host).innerHTML = revenueChart(d.series, $('#fch', host).clientWidth);
    if (window.matchMedia('(max-width:900px)').matches) $('.grid2', host).style.gridTemplateColumns = '1fr';
  };
  await draw();
};
function revenueChart(series, width) {
  const W = Math.max(280, Math.round(width || 720)), H = W < 500 ? 180 : 220, P = { l: 44, r: 8, t: 12, b: 24 };
  const n = series.length, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxV = Math.max(1, ...series.map((x) => Math.max(x.net, x.gross))), maxR = Math.max(0, ...series.map((x) => x.refunds));
  const top = maxV * 1.12, bot = maxR ? maxR * 1.3 : 0, span = top + bot;
  const y = (v) => P.t + ih * (top - v) / span, x = (i) => P.l + (n === 1 ? iw / 2 : i * iw / (n - 1));
  const pts = series.map((s, i) => [x(i), y(Math.max(0, s.net))]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const bw = Math.max(2, iw / n * 0.6);
  const refunds = series.map((s, i) => s.refunds ? `<rect class="rf" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(0).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(-s.refunds) - y(0)).toFixed(1)}" rx="2"/>` : '').join('');
  const grid = [0, .5, 1].map((f) => { const v = top / 1.12 * f; return `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${P.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v)}</text>`; }).join('');
  const step = Math.ceil(n / (W < 500 ? 4 : 7));
  const labels = series.map((s, i) => (i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step / 2) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${new Date(s.day + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text>` : '').join('');
  const hits = series.map((s, i) => `<rect class="hit" x="${(x(i) - iw / n / 2).toFixed(1)}" y="${P.t}" width="${(iw / n).toFixed(1)}" height="${ih}"><title>${s.day}: ${usd(s.net)} net${s.refunds ? ' (' + usd(s.gross) + ' paid, ' + usd(s.refunds) + ' refunded)' : ''}</title></rect>`).join('');
  const total = series.reduce((a, s) => a + s.net, 0);
  return `<div class="row between" style="margin-bottom:6px"><b class="num" style="font-size:22px;letter-spacing:-.04em">${usd0(total)}</b><span class="hint">${n} days · net</span></div>
    <svg class="fchart" viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="Net revenue per day"><defs><linearGradient id="fgrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF4A1C" stop-opacity=".22"/><stop offset="1" stop-color="#FF4A1C" stop-opacity="0"/></linearGradient></defs>${grid}<path class="ar" d="${area}"/><path class="ln2" d="${line}" vector-effect="non-scaling-stroke"/>${refunds}${labels}${hits}</svg>`;
}

// ================================================================ Customers list + customer page
const COLS = [
  { k: 'customer', t: 'Customer', sort: 'joined' }, { k: 'plan', t: 'Plan' },
  { k: 'spend', t: 'Lifetime spend', sort: 'spend', money: 1, r: 1 }, { k: 'credits', t: 'Credits bought / used', sort: 'credits_used', r: 1 },
  { k: 'ai', t: 'AI cost', sort: 'ai_cost', money: 1, r: 1 }, { k: 'profit', t: 'Profit', sort: 'profit', money: 1, r: 1 }, { k: 'active', t: 'Last active', sort: 'last_active' },
];
VIEWS.customers = async (el, acts) => {
  const sub = (location.hash.match(/^#\/customers\/(\d+)/) || [])[1];
  if (sub) return customerPage(el, acts, Number(sub));
  const fin = can('users.finance');
  const st = Object.assign({ q: '', status: '', plan: '', sort: fin ? 'spend' : 'joined', dir: 'desc', range: 'all', from: '', to: '' }, store.get('cust', {}));
  if (!fin && ['spend', 'profit', 'ai_cost'].includes(st.sort)) st.sort = 'joined';
  st.offset = 0; st.rows = [];
  let plans = [];
  if (can('pricing.view')) { try { plans = (await GET('/api/admin/pricing')).pricing.plans || []; } catch {} }
  acts.innerHTML = fin ? `<button class="btn ghost sm" id="csv">${ico('download')} Export CSV</button>` : '';
  el.innerHTML = `<div class="stack">
    <div class="card"><div class="card-h" style="display:grid;gap:10px">
      <div class="toolbar"><div class="srch grow">${ico('search')}<input class="inp sm" id="q" type="search" placeholder="Search by email or name" value="${esc(st.q)}"></div>
        <select class="inp sm" id="pl" style="max-width:170px" aria-label="Plan"><option value="">All plans</option><option value="paying">Paying</option><option value="free">Free</option>${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <select class="inp sm" id="so" style="max-width:190px" aria-label="Sort">${COLS.filter((c) => c.sort && (fin || !c.money)).map((c) => `<option value="${c.sort}">${c.sort === 'joined' ? 'Newest customers' : c.sort === 'spend' ? 'Top spenders' : c.sort === 'last_active' ? 'Recently active' : c.sort === 'credits_used' ? 'Most credits used' : c.sort === 'ai_cost' ? 'Highest AI cost' : 'Most profit'}</option>`).join('')}</select></div>
      <div class="toolbar">${seg('stf', [['', 'All'], ['active', 'Active'], ['suspended', 'Suspended'], ['banned', 'Banned']], st.status, 'sm')}
        ${seg('rg', [['all', 'All time'], ['30d', '30 days'], ['90d', '90 days'], ['ytd', 'This year'], ['custom', 'Dates']], st.range, 'sm')}
        <div class="rng-in" id="cust-r" ${st.range === 'custom' ? '' : 'hidden'}><input class="inp sm" type="date" id="fr" value="${esc(st.from)}" aria-label="From"><span class="hint">to</span><input class="inp sm" type="date" id="to" value="${esc(st.to)}" aria-label="To"></div></div>
      ${st.range !== 'all' ? '' : ''}<p class="hint" id="rnote" style="margin:0"></p></div>
      ${fin ? '<div class="sumstrip" id="sum"></div>' : ''}
      <div id="list"><div class="card-b"><div class="sk"></div><div class="sk" style="margin-top:10px;width:70%"></div></div></div>
      <div class="card-b" id="more" hidden style="text-align:center"><button class="btn ghost sm">Load more</button></div></div></div>`;
  $('#pl').value = st.plan; $('#so').value = st.sort;
  const qs = (extra = {}) => { const r = st.range === 'custom' ? { from: st.from, to: st.to } : rangeOf(st.range); const p = new URLSearchParams({ q: st.q, status: st.status, plan: st.plan, sort: st.sort, dir: st.dir, from: r.from || '', to: r.to || '', limit: 50, offset: st.offset, ...extra }); return p.toString(); };
  const save = () => store.set('cust', { q: st.q, status: st.status, plan: st.plan, sort: st.sort, dir: st.dir, range: st.range, from: st.from, to: st.to });
  const load = async (append) => {
    if (!append) st.offset = 0;
    const r = await GET('/api/admin/finance/customers?' + qs());
    st.rows = append ? st.rows.concat(r.users) : r.users;
    $('#more').hidden = st.rows.length >= r.total;
    const rr = st.range === 'custom' ? { from: st.from, to: st.to } : rangeOf(st.range);
    $('#rnote').textContent = `${int(r.total)} customer${r.total === 1 ? '' : 's'}` + (rr.from || rr.to ? ` · money and credits from ${rr.from || 'the start'} to ${rr.to || 'today'}` : ' · lifetime numbers') + (fin ? '' : ' · money is hidden for your role');
    if (fin && r.totals) $('#sum').innerHTML = `<div><span>Spend (net)</span><b>${usd0(r.totals.net_usd)}</b></div><div><span>Refunds</span><b>${usd0(r.totals.refunds_usd)}</b></div><div><span>AI cost</span><b>${usd0(r.totals.ai_cost_usd)}</b></div><div><span>Profit</span><b class="mny ${r.totals.profit_usd < 0 ? 'neg' : ''}">${usd0(r.totals.profit_usd)}</b></div>`;
    const cols = COLS.filter((c) => fin || !c.money);
    const maxSpend = Math.max(1, ...st.rows.map((u) => num(u.net_usd)));
    $('#list').innerHTML = st.rows.length ? `<div class="tblw"><table class="tbl cards"><thead><tr>${cols.map((c) => `<th class="${c.r ? 'r ' : ''}${c.sort ? 'sorth' : ''}${c.sort === st.sort ? ' on' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''}>${c.t}${c.sort ? `<i>${c.sort === st.sort ? (st.dir === 'asc' ? '↑' : '↓') : '↕'}</i>` : ''}</th>`).join('')}</tr></thead><tbody>${st.rows.map((u) => `<tr class="click" data-id="${u.id}">
        <td class="lead" data-l="Customer"><div class="row" style="flex-wrap:nowrap;gap:10px"><span class="avatar" style="width:32px;height:32px;font-size:11.5px">${esc(initials(u.name || u.email))}</span><span style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</b><span class="sub">${esc(u.name || 'No name')}${u.country ? ' · ' + esc(u.country) : ''}${u.status !== 'active' ? ' · ' + esc(u.status) : ''}</span></span></div></td>
        <td data-l="Plan">${u.plan_active ? `<span class="pill ink">${esc(u.plan_id)}</span>` : '<span class="pill plain">Free</span>'}</td>
        ${fin ? `<td class="r" data-l="Lifetime spend"><b class="mny">${usd(u.net_usd)}</b>${u.refunds_usd ? `<span class="sub">${usd(u.refunds_usd)} refunded</span>` : ''}<span class="cbar" style="margin-left:auto;max-width:120px"><i style="width:${Math.max(2, num(u.net_usd) / maxSpend * 100).toFixed(1)}%"></i></span></td>` : ''}
        <td class="r num" data-l="Credits">${int(u.credits_bought)} / ${int(u.credits_used)}<span class="sub">${int(u.balance)} left</span></td>
        ${fin ? `<td class="r" data-l="AI cost">${mny(u.ai_cost_usd, 'dim')}</td><td class="r" data-l="Profit"><b>${mny(u.profit_usd)}</b></td>` : ''}
        <td data-l="Last active" class="nowrap">${ago(u.last_active || u.last_seen_at)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyCard('No customers found', st.q ? 'Try a different search or date range.' : 'Customers appear here after they sign up.');
    $$('#list tr[data-id]').forEach((tr) => tr.onclick = () => go('#/customers/' + tr.dataset.id));
    $$('#list th[data-sort]').forEach((th) => th.onclick = () => { const k = th.dataset.sort; if (st.sort === k) st.dir = st.dir === 'desc' ? 'asc' : 'desc'; else { st.sort = k; st.dir = k === 'joined' || k === 'last_active' || ['spend', 'profit', 'ai_cost', 'credits_used'].includes(k) ? 'desc' : 'asc'; } $('#so').value = st.sort; save(); load().catch((e) => toast(e.message, true)); });
  };
  const reload = () => { save(); load().catch((e) => toast(e.message, true)); };
  $('#q').oninput = debounce((e) => { st.q = e.target.value.trim(); reload(); });
  $('#pl').onchange = (e) => { st.plan = e.target.value; reload(); };
  $('#so').onchange = (e) => { st.sort = e.target.value; st.dir = 'desc'; reload(); };
  segWire(el, 'stf', (v) => { st.status = v; reload(); });
  segWire(el, 'rg', (v) => { st.range = v; $('#cust-r').hidden = v !== 'custom'; if (v !== 'custom') reload(); });
  ['fr', 'to'].forEach((k) => $('#' + k).onchange = () => { st.from = $('#fr').value; st.to = $('#to').value; reload(); });
  $('#more button').onclick = (e) => { st.offset = st.rows.length; act(e.currentTarget, () => load(true)); };
  $('#csv') && ($('#csv').onclick = () => { st.offset = 0; const a = document.createElement('a'); a.href = '/api/admin/finance/customers.csv?' + qs(); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Export started'); });
  await load();
};

async function customerPage(el, acts, id) {
  $('.phead', el.parentElement)?.setAttribute('hidden', '');
  acts.innerHTML = '';
  const d = await GET('/api/admin/finance/customers/' + id);
  const u = d.user, b = u.balance, s = d.summary, fin = d.money;
  document.title = (u.name || u.email) + ' · Vooads Admin';
  const lim = d.can.limits || {};
  const limTxt = can('*') ? 'Owners have no credit limit.' : [lim.max_credit_grant != null ? `up to ${int(lim.max_credit_grant)} at a time` : '', lim.max_credit_grant_day != null ? `${int(Math.max(0, lim.max_credit_grant_day - d.can.granted_today))} left today` : ''].filter(Boolean).join(' · ') || 'No limit on your role.';
  const tabs = [['timeline', fin ? 'Spend timeline' : 'Payments', fin || d.payments.length], ['jobs', `Jobs (${d.jobs.length})`, 1], ['credits', 'Credits', 1], ['tickets', `Tickets (${d.tickets.length})`, d.can.tickets], ['refs', `Referrals (${d.referrals.length})`, 1], ['mail', 'Mail', !!(window.VooMail && VooMail.mountUserHistory && (can('mail.view') || can('users.view')))]].filter((t) => t[2]);
  el.innerHTML = `<a class="backl" href="#/customers">${ico('back')} All customers</a>
    <div class="stack">
    <div class="card pad"><div class="cust-h"><span class="avatar">${esc(initials(u.name || u.email))}</span><div class="grow"><h2>${esc(u.name || u.email)}</h2><p class="hint" style="font-size:14px">${esc(u.email)} · #${u.id} · joined ${esc(fdate(u.created_at))}</p>
      <div class="row" style="gap:6px;margin-top:8px">${statusPill(u.status)} ${b.planActive ? `<span class="pill ink">${esc(u.plan_id)} · ${esc(u.plan_period || 'month')}</span><span class="pill plain">renews ${ago(u.plan_expires_at)}</span>` : '<span class="pill plain">No active plan</span>'}${u.auto_renew ? ' <span class="pill good">Auto-renew</span>' : ''}${u.voo_id ? ' <span class="pill sky">Voo ID</span>' : ''}${u.country ? ` <span class="pill plain">${esc(u.country)}</span>` : ''}</div></div>
      <div class="row" style="gap:8px">${d.can.credits ? `<button class="btn brand sm" id="cr">${ico('plus')} Credits</button>` : ''}${d.can.ban ? (u.status === 'active' ? `<button class="btn ghost sm" data-st="suspended">Suspend</button><button class="btn dghost sm" data-st="banned">Ban</button>` : `<button class="btn ghost sm" data-st="active">${ico('undo')} ${u.status === 'banned' ? 'Unban' : 'Reactivate'}</button>`) : ''}${d.can.edit ? `<button class="iconbtn" id="ed" title="Edit details and plan" aria-label="Edit details and plan">${ico('edit')}</button>` : ''}</div></div>
      ${u.ban_reason ? `<div class="note warn" style="margin-top:12px"><b>Reason on file:</b> ${esc(u.ban_reason)}</div>` : ''}</div>
    <div class="tiles">${(fin ? [['Lifetime spend', usd0(s.net_usd), s.refunds_usd ? usd0(s.refunds_usd) + ' refunded' : s.payments + ' payment' + (s.payments === 1 ? '' : 's'), 'ink'], ['AI cost to us', usd(s.ai_cost_usd), 'real provider cost'], ['Profit', `<span class="mny ${s.profit_usd < 0 ? 'neg' : ''}">${usd0(s.profit_usd)}</span>`, s.net_usd ? Math.round(s.profit_usd / s.net_usd * 100) + '% margin' : '—']] : [])
      .concat([['Credits left', int(b.total), `${int(b.plan)} plan · ${int(b.topup)} top-up · ${int(b.trial)} trial`], ['Bought / used', `${int(s.credits_bought)} / ${int(s.credits_used)}`, `${int(s.jobs)} job${s.jobs === 1 ? '' : 's'}`], ['Last active', ago(u.last_seen_at), u.last_seen_at ? fdate(u.last_seen_at) : '']])
      .map((t, i) => `<div class="tile ${t[3] || ''}" style="--i:${i}"><span>${t[0]}</span><b>${t[1]}</b><small>${esc(t[2])}</small></div>`).join('')}</div>
    <div class="card"><div class="card-h" style="padding-bottom:0;border-bottom:0"><div class="tabs" id="ctabs" style="margin:0;width:100%">${tabs.map((t, i) => `<button data-t="${t[0]}" class="${i ? '' : 'on'}">${esc(t[1])}</button>`).join('')}</div></div><div class="card-b" id="tabb"></div></div></div>`;
  const panes = {
    timeline: () => fin ? (d.timeline.length ? `<div class="tl">${d.timeline.map((e, i) => `<div class="ev ${e.type}" style="--i:${i}"><span class="dot2">${ico(e.type === 'refund' ? 'undo' : e.type === 'topup' ? 'plus' : e.type === 'payment' ? 'wallet' : 'clock')}</span><div style="min-width:0"><b>${esc(e.label)}</b><small>${esc(fdate(e.at))} · ${esc(e.adapter || '')}${e.discount_code ? ' · code ' + esc(e.discount_code) + ' (−' + usd(e.discount_usd) + ')' : ''}${e.type === 'pending' || e.type === 'review' || e.type === 'failed' ? ' · ' + esc(e.status) + ' · ' + usd(e.quoted_usd) : ''}</small></div><b class="mny ${e.amount_usd < 0 ? 'neg' : e.amount_usd > 0 ? 'pos' : 'dim'}">${e.amount_usd > 0 ? '+' : ''}${usd(e.amount_usd)}</b></div>`).join('')}</div>` : emptyCard('No payments yet', 'Payments, top-ups and refunds show up here.'))
      : (d.payments.length ? `<div class="list">${d.payments.map((p) => `<div class="li"><div class="m"><b>${esc(p.kind === 'plan' ? 'Plan ' + (p.plan_id || '') : 'Top-up ' + (p.topup_id || ''))}</b><small>${esc(p.adapter || '')} · ${fdate(p.created_at)}</small></div>${statusPill(p.status)}</div>`).join('')}</div>` : '<p class="muted">No payments yet.</p>'),
    jobs: () => d.jobs.length ? tbl([{ t: 'Job' }, { t: 'Status' }, { t: 'Credits', r: 1 }, ...(fin ? [{ t: 'Our AI cost', r: 1 }] : []), { t: 'When' }], d.jobs.map((j) => `<tr><td class="lead" data-l="Job"><b>#${j.id} · ${esc(j.label)}</b><span class="sub">${esc(j.type)}${j.level ? ' · ' + esc(j.level) : ''}${j.seconds ? ' · ' + j.seconds + 's' : ''}${j.demo ? ' · demo' : ''}${j.error ? ' · ' + esc(String(j.error).slice(0, 80)) : ''}</span></td><td data-l="Status">${statusPill(j.status)}${j.refunded ? ' <span class="pill violet">refunded</span>' : ''}</td><td class="r num" data-l="Credits">${int(j.credits)}</td>${fin ? `<td class="r" data-l="Our AI cost">${j.ai_cost_usd ? usd(j.ai_cost_usd, 3) : j.est_cost_usd && j.demo ? `<span class="mny dim" title="Demo job: no real cost">${usd(0)}</span>` : '<span class="mny dim">—</span>'}</td>` : ''}<td class="nowrap" data-l="When">${ago(j.created_at)}</td></tr>`)) : '<p class="muted">No jobs yet.</p>',
    credits: () => `${d.can.credits ? `<div class="hl" style="margin-bottom:14px">Your credit limit: ${esc(limTxt)} Every change needs a reason and is saved in the activity log.</div>` : ''}${d.ledger.length ? `<div class="list">${d.ledger.map((l) => `<div class="li"><div class="m">${esc(l.reason || '—')}<small>${esc(typeof l.bucket === 'string' && l.bucket.startsWith('{') ? 'job' : l.bucket || '')} · ${fdate(l.created_at)}</small></div><span class="${l.delta >= 0 ? 'pos' : 'neg'} num">${l.delta >= 0 ? '+' : ''}${int(l.delta)}</span></div>`).join('')}</div>` : '<p class="muted">No credit movements yet.</p>'}`,
    tickets: () => d.tickets.length ? `<div class="list">${d.tickets.map((t) => `<a class="li" href="#/inbox" style="text-decoration:none;color:inherit"><div class="m"><b>#${t.id} · ${esc(t.subject)}</b><small>${esc(t.category)} · ${esc(t.priority)} · updated ${ago(t.updated_at)}</small></div>${statusPill(t.status === 'open' ? 'pending' : t.status === 'solved' ? 'done' : t.status)}</a>`).join('')}</div>` : '<p class="muted">No tickets.</p>',
    refs: () => `<p class="hint" style="margin-bottom:8px">Referral code <b>${esc(u.ref_code || '—')}</b>${u.referred_by ? ' · referred by code ' + esc(u.referred_by) : ''}</p>${d.referrals.length ? `<div class="list">${d.referrals.map((x) => `<a class="li" href="#/customers/${x.id}" style="text-decoration:none;color:inherit"><div class="m"><b>${esc(x.name || x.email)}</b><small>${esc(x.email)} · joined ${ago(x.created_at)}</small></div>${fin ? `<b class="mny">${usd(x.net_usd)}</b>` : ''}</a>`).join('')}</div>` : '<p class="muted">Nobody yet.</p>'}`,
  };
  // Mail tab: email preferences, tags, campaigns and automatic emails (VooMail, GET/PUT /api/admin/mail/users/:id).
  panes.mail = () => '<div id="cmail"></div>';
  const show = (k) => { $('#tabb').innerHTML = panes[k](); $$('#ctabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === k)); if (k === 'mail') VooMail.mountUserHistory($('#cmail'), id); };
  $$('#ctabs button').forEach((t) => t.onclick = () => show(t.dataset.t));
  show(tabs[0][0]);
  const reload = () => customerPage(el, acts, id);
  $('#ed') && ($('#ed').onclick = () => customerDrawer(id, reload));
  $('#cr') && ($('#cr').onclick = () => modal({
    title: 'Add or remove credits', ok: 'Apply credits',
    body: `<div class="hl">${esc(limTxt)}</div><div class="fields"><div class="fld"><label>Credits</label><input class="inp" id="g-amt" type="number" step="1" placeholder="100 or -50"><small>Minus removes credits.</small></div><div class="fld"><label>Bucket</label><select class="inp" id="g-b"><option value="topup">Top-up (never expires)</option><option value="plan">Plan (resets on renewal)</option><option value="trial">Trial</option></select></div><div class="fld full"><label>Reason (saved in the log)</label><input class="inp" id="g-r" maxlength="120" placeholder="e.g. Refund for failed video #123"></div></div>`,
    onOk: async (w, btn) => { const x = await act(btn, () => POST(`/api/admin/users/${id}/credits`, { amount: Number($('#g-amt', w).value), bucket: $('#g-b', w).value, reason: $('#g-r', w).value.trim() }), (y) => (y.applied >= 0 ? 'Added ' : 'Removed ') + int(Math.abs(y.applied)) + ' credits'); if (!x) return false; reload(); },
  }));
  $$('[data-st]', el).forEach((bt) => bt.onclick = () => {
    const s2 = bt.dataset.st;
    if (s2 === 'active') return modal({ title: (u.status === 'banned' ? 'Unban ' : 'Reactivate ') + esc(u.email) + '?', body: `<p>They can log in and use the studio again.${u.status === 'banned' ? ' Credits removed on the ban are not given back automatically: add them with "Credits" if you want.' : ''}</p>`, ok: u.status === 'banned' ? 'Unban' : 'Reactivate', okClass: 'solid', onOk: async (w, btn) => { const x = await act(btn, () => POST(`/api/admin/users/${id}/status`, { status: 'active' }), 'Account active again'); if (!x) return false; reload(); } });
    const ban = s2 === 'banned';
    modal({ title: (ban ? 'Ban ' : 'Suspend ') + esc(u.email) + '?', ok: ban ? 'Ban and forfeit credits' : 'Suspend', okClass: ban ? 'danger' : 'solid',
      body: (ban ? `<div class="note bad"><b>Permanent.</b> All ${int(b.total)} credits are forfeited, they are logged out everywhere and get an email with your reason.</div>` : '<p>They cannot use the studio until you reactivate them. Credits are kept.</p>') + '<div class="fld"><label>Reason (the customer sees it)</label><textarea class="inp" id="m-r" rows="3" maxlength="300"></textarea></div>',
      onOk: async (w, btn) => { const x = await act(btn, () => POST(`/api/admin/users/${id}/status`, { status: s2, reason: $('#m-r', w).value.trim() }), ban ? 'Customer banned' : 'Account suspended'); if (!x) return false; reload(); } });
  });
}

// ================================================================ Team & roles (role builder)
const SCOPE_TXT = { all: 'Every ticket', assigned: 'Only tickets given to them' };
function roleSummary(perms, limits, groups) {
  if (perms.has('*')) return 'Full access to everything, including owners.';
  const on = groups.map((g) => [g.label, g.perms.filter((p) => perms.has(p.key))]).filter(([, l]) => l.length);
  if (!on.length) return 'Nothing yet. Turn on what this role may do.';
  const parts = on.map(([g, l]) => `<b>${esc(g)}</b>: ${esc(l.map((p) => p.label.charAt(0).toLowerCase() + p.label.slice(1)).join(', '))}`);
  const lim = [];
  if (perms.has('users.credits')) lim.push(limits.max_credit_grant === undefined || limits.max_credit_grant === '' ? 'no credit limit' : `up to ${int(limits.max_credit_grant)} credits at a time` + (limits.max_credit_grant_day !== undefined && limits.max_credit_grant_day !== '' ? `, ${int(limits.max_credit_grant_day)} a day` : ''));
  if (perms.has('payments.refund')) lim.push(limits.max_refund_usd === undefined || limits.max_refund_usd === '' ? 'refunds of any size' : `refunds up to ${usd(limits.max_refund_usd)}`);
  if (perms.has('tickets.view')) lim.push((limits.ticket_scope === 'assigned' ? 'only their own' : 'all') + ' tickets');
  return parts.join(' · ') + (lim.length ? `<br><span class="hint">Limits: ${esc(lim.join(' · '))}</span>` : '');
}
VIEWS.team = async (el, acts) => {
  const manage = can('staff.manage');
  const r = await GET('/api/admin/staff');
  const reload = () => VIEWS.team(el, acts);
  const roleOf = (id) => r.roles.find((x) => x.id === id);
  const total = Object.keys(r.all_permissions).length;
  const ORDER = ['Owner', 'Admin', 'Support agent', 'Finance', 'Content editor'];
  const sorted = r.roles.slice().sort((a, b) => { const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id - b.id; });
  if (manage) acts.innerHTML = `<button class="btn ghost sm" id="newrole">${ico('plus')} New role</button><button class="btn brand sm" id="inv">${ico('userplus')} Invite someone</button>`;
  el.innerHTML = `<div class="stack"><div id="invbox"></div>
    <div class="card"><div class="card-h"><div><h3>People</h3><p>${r.staff.length} on the team</p></div></div>
    ${tbl([{ t: 'Person' }, { t: 'Role' }, { t: 'Status' }, { t: 'Last login' }, { t: '' }], r.staff.map((s) => {
      const self = s.id === S.me.staff.id;
      return `<tr data-id="${s.id}"><td class="lead" data-l="Person"><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(s.name || s.email))}</span><div style="min-width:0"><b>${esc(s.name || '—')}${self ? ' <span class="pill plain">You</span>' : ''}</b><span class="sub">${esc(s.email)}</span></div></div></td>
      <td data-l="Role">${manage && !self ? `<select class="inp sm" data-role style="min-width:150px">${sorted.map((x) => `<option value="${x.id}" ${x.id === s.role_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<span class="pill ink">${esc(roleOf(s.role_id)?.name || '—')}</span>`}</td>
      <td data-l="Status">${s.status === 'invited' ? '<span class="pill warn">Invite pending</span>' : statusPill(s.status)}</td><td data-l="Last login" class="nowrap">${ago(s.last_login_at)}</td>
      <td class="r nowrap" data-l="">${manage && !self ? `${s.status !== 'invited' ? `<button class="btn ghost xs" data-tog>${s.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''} <button class="iconbtn" data-rm title="Remove" aria-label="Remove">${ico('trash')}</button>` : ''}</td></tr>`;
    }))}</div>
    <div><div class="row between" style="margin-bottom:12px"><div><h3 style="font-size:18px;letter-spacing:-.03em">Roles</h3><p class="hint">Tap a role to see or change what it can do, in plain words.</p></div></div>
    <div class="roles stagger">${sorted.map((x, i) => {
      const full = x.permissions.includes('*'); const n = full ? total : x.permissions.length;
      const people = r.staff.filter((s) => s.role_id === x.id).length;
      const L = x.limits || {};
      return `<button class="card role" data-role-id="${x.id}" style="--i:${i}"><h4>${esc(x.name)} ${full ? '<span class="pill ink">Full access</span>' : x.system ? '<span class="pill plain">Preset</span>' : '<span class="pill violet">Custom</span>'}</h4><p>${esc(x.description || '')}</p>
        <div class="permbar"><i style="width:${Math.round(n / total * 100)}%"></i></div><div class="row between hint"><span>${full ? 'Everything' : n + ' of ' + total + ' things'}${L.max_credit_grant != null ? ' · ' + int(L.max_credit_grant) + ' cr max' : ''}${L.max_credit_grant_day != null ? ' · ' + int(L.max_credit_grant_day) + '/day' : ''}${L.max_refund_usd != null ? ' · refunds ≤ ' + usd0(L.max_refund_usd) : ''}${L.ticket_scope === 'assigned' ? ' · own tickets' : ''}</span><span>${people} ${people === 1 ? 'person' : 'people'}</span></div></button>`;
    }).join('')}</div></div></div>`;
  $$('[data-role-id]', el).forEach((b) => b.onclick = () => roleBuilder(roleOf(Number(b.dataset.roleId)), r, reload));
  $('#newrole') && ($('#newrole').onclick = () => roleBuilder(null, r, reload));
  $('#inv') && ($('#inv').onclick = () => { const w = modal({
    title: 'Invite someone to the admin', ok: 'Send invite',
    body: `<div class="fld"><label>Email</label><input class="inp" id="i-em" type="email" placeholder="name@company.com"></div><div class="fld"><label>Name (optional)</label><input class="inp" id="i-nm" maxlength="60"></div>
      <div class="fld"><label>Role</label><select class="inp" id="i-rl">${sorted.filter((x) => can('*') || !x.permissions.includes('*')).map((x) => `<option value="${x.id}" ${x.name === 'Support agent' ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><small id="i-desc"></small></div>`,
    onOk: async (w2, btn) => {
      const x = await act(btn, () => POST('/api/admin/staff', { email: $('#i-em', w2).value.trim(), name: $('#i-nm', w2).value.trim(), role_id: Number($('#i-rl', w2).value) }), 'Invite created');
      if (!x) return false;
      await reload();
      $('#invbox').innerHTML = `<div class="card pad invite-link"><div class="row between"><div><h3 style="font-size:17px">Invite link ready</h3><p class="hint">We emailed it${S.me.email_live ? '' : ' (email is not set up, so it was printed to the server log)'}. It works once.</p></div><button class="iconbtn" id="ix" aria-label="Dismiss">${ico('x')}</button></div><div class="copybox" style="margin-top:12px"><code>${esc(x.invite_url)}</code><button class="btn brand xs" id="icp">${ico('copy')} Copy link</button></div></div>`;
      $('#icp').onclick = () => copy(x.invite_url); $('#ix').onclick = () => { $('#invbox').innerHTML = ''; };
    },
  });
  const descUpd = () => { const ro = roleOf(Number($('#i-rl', w).value)); $('#i-desc', w).innerHTML = ro ? roleSummary(new Set(ro.permissions), ro.limits || {}, r.perm_groups || []) : ''; };
  $('#i-rl', w).onchange = descUpd; descUpd(); });
  $$('tr[data-id]', el).forEach((tr) => {
    const s = r.staff.find((x) => x.id === Number(tr.dataset.id));
    $('[data-role]', tr) && ($('[data-role]', tr).onchange = async (e) => { if (!await act(null, () => PUT('/api/admin/staff/' + s.id, { role_id: Number(e.target.value) }), (s.name || s.email) + ' is now ' + roleOf(Number(e.target.value)).name)) e.target.value = s.role_id; });
    $('[data-tog]', tr) && ($('[data-tog]', tr).onclick = (e) => act(e.currentTarget, () => PUT('/api/admin/staff/' + s.id, { status: s.status === 'active' ? 'disabled' : 'active' }), s.status === 'active' ? 'Access disabled and logged out' : 'Access enabled').then((x) => x && reload()));
    $('[data-rm]', tr) && ($('[data-rm]', tr).onclick = () => modal({ title: 'Remove ' + esc(s.name || s.email) + '?', body: '<p>They lose admin access right away. Their past actions stay in the activity log.</p>', ok: 'Remove', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/staff/' + s.id), 'Removed from the team'); if (!x) return false; reload(); } }));
  });
};
// Dependencies: turning a permission on also turns on what it needs to be useful.
const NEEDS = { 'tickets.reply': 'tickets.view', 'tickets.close': 'tickets.view', 'tickets.assign': 'tickets.view', 'tickets.manage': 'tickets.view', 'calls.handle': 'tickets.view', 'users.edit': 'users.view', 'users.credits': 'users.view', 'users.ban': 'users.view', 'users.finance': 'users.view', 'payments.refund': 'payments.view', 'payments.manage': 'payments.view', 'pricing.manage': 'pricing.view', 'blog.edit': 'blog.view', 'emails.edit': 'emails.view', 'settings.manage': 'settings.view', 'staff.manage': 'staff.view', 'providers.manage': 'providers.view', 'features.manage': 'features.view' };
function roleBuilder(role, meta, done) {
  const manage = can('staff.manage');
  const isOwner = role && role.permissions.includes('*');
  const editable = manage && !isOwner;
  const groups = meta.perm_groups || [];
  const perms = new Set(role ? role.permissions : ['dashboard.view']);
  const L = Object.assign({}, role?.limits || {});
  const presets = (meta.presets || []).filter((p) => !p.permissions.includes('*'));
  const d = openDrawer({
    title: role ? esc(role.name) : 'New role',
    sub: isOwner ? 'Owners can do everything. This role cannot be changed.' : role?.system ? 'Preset role: you can change it, not delete it.' : 'Turn on what this role may do. Plain words, no codes.',
    body: `<div class="stack" style="display:grid;gap:16px">
      <div class="fields"><div class="fld"><label>Role name</label><input class="inp sm" id="rn" maxlength="40" value="${esc(role?.name || '')}" placeholder="e.g. Weekend support" ${editable ? '' : 'readonly'}></div>
        <div class="fld"><label>What they do</label><input class="inp sm" id="rd" maxlength="200" value="${esc(role?.description || '')}" placeholder="One line for the team" ${editable ? '' : 'readonly'}></div></div>
      ${editable ? `<div><div class="hint" style="margin-bottom:8px;font-weight:700">Start from a preset</div><div class="chips">${presets.map((p, i) => `<button type="button" class="btn ghost xs" data-pre="${i}" title="${esc(p.description)}">${esc(p.name)}</button>`).join('')}<button type="button" class="btn ghost xs" data-pre="none">Clear all</button></div></div>` : ''}
      <div class="rb-sum" id="rsum"></div>
      <div id="rgroups"></div>
      ${isOwner ? '' : `<div class="card pad" style="display:grid;gap:12px;box-shadow:none"><h4 style="font-size:15px">Limits</h4>
        <div class="fields">
          <div class="fld"><label>Credits per grant</label><input class="inp sm" id="l1" type="number" min="0" value="${esc(L.max_credit_grant ?? '')}" placeholder="No limit" ${editable ? '' : 'readonly'}><small>Most credits in one go. 0 = cannot give credits.</small></div>
          <div class="fld"><label>Credits per day</label><input class="inp sm" id="l2" type="number" min="0" value="${esc(L.max_credit_grant_day ?? '')}" placeholder="No limit" ${editable ? '' : 'readonly'}><small>All their grants in 24 hours together.</small></div>
          <div class="fld"><label>Refund limit (USD)</label><input class="inp sm" id="l3" type="number" min="0" step="0.01" value="${esc(L.max_refund_usd ?? '')}" placeholder="No limit" ${editable ? '' : 'readonly'}><small>Biggest payment they can refund or approve.</small></div>
          <div class="fld full"><label>Which tickets they see</label><div class="rcards" id="rsc" style="grid-template-columns:repeat(2,minmax(0,1fr))">${Object.entries(SCOPE_TXT).map(([k, t]) => `<button type="button" class="rcard ${(L.ticket_scope === 'assigned' ? 'assigned' : 'all') === k ? 'on' : ''}" data-sc="${k}" ${editable ? '' : 'disabled'}><b><i></i>${t}</b><span>${k === 'all' ? 'Leads and experienced agents.' : 'New agents only see their own work.'}</span></button>`).join('')}</div></div>
        </div></div>`}
      </div>`,
    foot: editable ? `${role && !role.system ? '<button class="btn dghost sm" id="rdel" style="margin-right:auto">Delete role</button>' : ''}<button class="btn ghost sm" id="rcancel">Cancel</button><button class="btn brand sm" id="rsave">${role ? 'Save role' : 'Create role'} ${ARR()}</button>` : '',
  });
  const lims = () => isOwner ? {} : { max_credit_grant: $('#l1', d).value.trim(), max_credit_grant_day: $('#l2', d).value.trim(), max_refund_usd: $('#l3', d).value.trim(), ticket_scope: $('#rsc .rcard.on', d)?.dataset.sc || 'all' };
  const sum = () => { $('#rsum', d).innerHTML = roleSummary(perms, isOwner ? {} : lims(), groups); };
  const drawGroups = () => {
    $('#rgroups', d).innerHTML = isOwner ? '<div class="note brand"><b>Full access.</b> Owners can do everything, including managing other owners.</div>' : groups.map((g, gi) => {
      const n = g.perms.filter((p) => perms.has(p.key)).length;
      return `<div class="rb-group" style="--i:${gi}"><div class="rb-gh"><span class="gi">${ico(GROUP_IC[g.id] || 'list')}</span><b>${esc(g.label)}</b><small>${n} of ${g.perms.length}</small>${editable ? sw(n === g.perms.length, `data-gall="${gi}" aria-label="All of ${esc(g.label)}"`) : ''}</div>
        ${g.perms.map((p) => `<div class="rb-row" data-row="${esc(p.key)}"><span>${esc(p.label)}</span>${sw(perms.has(p.key), `data-p="${esc(p.key)}" ${editable ? '' : 'disabled'} aria-label="${esc(p.label)}"`)}</div>`).join('')}</div>`;
    }).join('');
    if (!editable) return;
    $$('[data-p]', d).forEach((b) => b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.p; if (perms.has(k)) perms.delete(k); else { perms.add(k); if (NEEDS[k]) perms.add(NEEDS[k]); } drawGroups(); sum(); });
    $$('[data-row]', d).forEach((row) => row.onclick = () => $(`[data-p="${row.dataset.row}"]`, row).click());
    $$('[data-gall]', d).forEach((b) => b.onclick = () => { const g = groups[Number(b.dataset.gall)]; const all = g.perms.every((p) => perms.has(p.key)); g.perms.forEach((p) => (all ? perms.delete(p.key) : perms.add(p.key))); if (!all) g.perms.forEach((p) => NEEDS[p.key] && perms.add(NEEDS[p.key])); drawGroups(); sum(); });
  };
  drawGroups(); sum();
  if (!editable) return;
  $$('#rsc .rcard', d).forEach((b) => b.onclick = () => { $$('#rsc .rcard', d).forEach((x) => x.classList.toggle('on', x === b)); sum(); });
  ['l1', 'l2', 'l3'].forEach((k) => $('#' + k, d).oninput = sum);
  $$('[data-pre]', d).forEach((b) => b.onclick = () => {
    const p = b.dataset.pre === 'none' ? null : presets[Number(b.dataset.pre)];
    perms.clear(); (p ? p.permissions : []).forEach((x) => perms.add(x));
    const pl = p?.limits || {};
    $('#l1', d).value = pl.max_credit_grant ?? ''; $('#l2', d).value = pl.max_credit_grant_day ?? ''; $('#l3', d).value = pl.max_refund_usd ?? '';
    $$('#rsc .rcard', d).forEach((x) => x.classList.toggle('on', x.dataset.sc === (pl.ticket_scope === 'assigned' ? 'assigned' : 'all')));
    if (p && !$('#rn', d).value.trim()) $('#rn', d).value = p.name === 'Admin' || p.name === 'Finance' || p.name === 'Support agent' || p.name === 'Content editor' ? p.name + (meta.roles.some((x) => x.name === p.name) ? ' (copy)' : '') : p.name;
    if (p && !$('#rd', d).value.trim()) $('#rd', d).value = p.description;
    drawGroups(); sum(); toast(p ? p.name + ' preset applied. Review, then save.' : 'Cleared');
  });
  $('#rcancel', d).onclick = closeDrawer;
  $('#rdel', d) && ($('#rdel', d).onclick = () => confirmDel('the "' + esc(role.name) + '" role', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/roles/' + role.id), 'Role deleted'); if (!x) return false; closeDrawer(); done(); }));
  $('#rsave', d).onclick = async (e) => {
    const b = { name: $('#rn', d).value.trim(), description: $('#rd', d).value.trim(), permissions: [...perms], limits: lims() };
    if (await act(e.currentTarget, () => role ? PUT('/api/admin/roles/' + role.id, b) : POST('/api/admin/roles', b), role ? 'Role saved' : 'Role created')) { closeDrawer(); done(); }
  };
}

// ================================================================ Integrations: Connect VooSquare
const baseIntegrations = VIEWS.integrations;
VIEWS.integrations = async (el, acts) => {
  await baseIntegrations(el, acts);
  if (!el.isConnected) return;
  const host = document.createElement('div');
  host.className = 'card vsq';
  (el.firstElementChild || el).insertBefore(host, (el.firstElementChild || el).firstChild);
  await voosquareCard(host);
};
const VSTATE = { connected: ['good', 'Connected'], partial: ['warn', 'Partly connected'], error: ['bad', 'Needs attention'], not_connected: ['plain', 'Not connected'] };
async function voosquareCard(host) {
  const manage = can('settings.manage');
  let st;
  try { st = await GET('/api/admin/voosquare/status'); } catch (e) { host.innerHTML = `<div class="card-b"><div class="note bad">${esc(e.message)}</div></div>`; return; }
  const [cls, label] = VSTATE[st.state] || VSTATE.not_connected;
  host.classList.toggle('ok', st.state === 'connected');
  const done = (st.parts.login ? 1 : 0) + (st.parts.inbound ? 1 : 0) + (st.parts.support ? 1 : 0);
  host.innerHTML = `<div class="vsq-h"><span class="vsq-orb">${ico('link')}</span><div class="grow" style="min-width:220px"><div class="row" style="gap:8px"><h3>VooSquare</h3><span class="pill ${cls}"><span class="dot${st.state === 'connected' ? ' live' : ''}"></span>${label}</span></div>
      <p>One login for every Zedapex app, and one support inbox: tickets can be answered in VooSquare and here, with each agent's Vooads role.</p></div>
      ${manage ? `<button class="btn ${st.state === 'connected' ? 'ghost' : 'brand'} sm" id="vsgo">${st.state === 'not_connected' ? 'Connect VooSquare ' + ARR() : 'Manage connection'}</button>` : ''}</div>
    <div class="vsq-b" id="vsb" hidden></div>`;
  if (st.state !== 'not_connected') {
    const b = $('#vsb', host); b.hidden = false;
    b.innerHTML = `<div class="row" style="gap:6px">${[['Login', st.parts.login], ['Events signed', st.parts.events], ['Inbound key', st.parts.inbound], ['Tickets shared', st.parts.support]].map(([l, ok]) => `<span class="pill ${ok ? 'good' : 'plain'}">${ok ? '✓' : '○'} ${l}</span>`).join('')}${st.tests.out ? `<span class="pill ${st.tests.out.ok ? 'good' : 'bad'}">Vooads → VooSquare ${st.tests.out.ok ? 'OK' : 'failed'}</span>` : ''}${st.tests.in ? `<span class="pill ${st.tests.in.ok ? 'good' : 'bad'}">VooSquare → Vooads ${st.tests.in.ok ? 'OK' : 'failed'}</span>` : ''}</div>
      ${st.last_inbound_at ? `<p class="hint" style="margin-top:8px">Last call from VooSquare ${ago(st.last_inbound_at)}.</p>` : ''}`;
    void done;
  }
  $('#vsgo', host) && ($('#vsgo', host).onclick = () => voosquareWizard(host, st));
}
function chipFor(host, st) {
  const [cls, label] = VSTATE[st.state] || VSTATE.not_connected;
  const pill = $('.vsq-h .pill', host); if (pill) { pill.className = 'pill ' + cls; pill.innerHTML = `<span class="dot${st.state === 'connected' ? ' live' : ''}"></span>${label}`; }
  host.classList.toggle('ok', st.state === 'connected');
}
function voosquareWizard(host, st0) {
  const b = $('#vsb', host); b.hidden = false;
  const W = { step: 0, done: [], st: st0, connect: null, manual: false };
  if (st0.parts.login) W.done.push(0);
  if (st0.parts.inbound) W.done.push(1);
  const LABELS = ['Connect', 'Paste into VooSquare', 'Test', 'Agents'];
  const paint = () => {
    b.innerHTML = `<div class="wz">${wzSteps(LABELS, W.step, W.done)}<div class="wz-pane" id="vp"></div></div>`;
    $$('.wz-steps [data-step]', b).forEach((x) => x.onclick = () => { W.step = Number(x.dataset.step); paint(); });
    [s1, s2, s3, s4][W.step]($('#vp', b));
  };
  const next = () => { if (!W.done.includes(W.step)) W.done.push(W.step); W.step++; paint(); };
  function s1(p) {
    p.innerHTML = `<h3>Connect VooSquare</h3><p class="sub">In VooSquare open <b>Apps → Vooads → Connect</b> and copy the connection code. Paste it here.</p>
      ${W.manual ? `<div class="fields"><div class="fld full"><label>VooSquare issuer URL</label><input class="inp sm" id="vi" placeholder="https://id.voosquare.com" value="${esc(st0.issuer || '')}"></div>
        <div class="fld"><label>Client ID</label><input class="inp sm" id="vc" placeholder="vooads"></div><div class="fld"><label>Client secret</label><input class="inp sm" id="vs" type="password" autocomplete="new-password" placeholder="Paste the secret"></div>
        <div class="fld full"><label>Support events URL (optional)</label><input class="inp sm" id="ve" placeholder="https://api.voosquare.com/v1/support/events"></div>
        <div class="fld full"><label>Signing secret (optional)</label><input class="inp sm" id="vw" type="password" autocomplete="new-password" placeholder="Leave empty and Vooads makes one for you"></div></div>`
      : `<div class="fld"><label>Connection code</label><textarea class="inp" id="vcode" rows="4" placeholder="vsq1.eyJpc3N1ZXIiOi..." spellcheck="false"></textarea><small id="vprev">It holds the login details and where to send events. Nothing is saved until you press Connect.</small></div>`}
      <div class="wz-foot"><button type="button" class="linkbtn" id="vman">${W.manual ? 'Use a connection code instead' : 'Enter the details one by one'}</button><button class="btn brand sm" id="vconn">Connect ${ARR()}</button></div>`;
    $('#vman', p).onclick = () => { W.manual = !W.manual; paint(); };
    $('#vcode', p) && ($('#vcode', p).oninput = debounce(async (e) => {
      const v = e.target.value.trim(); if (!v) return;
      try { const r = await POST('/api/admin/voosquare/decode', { code: v }); $('#vprev', p).innerHTML = `<span class="pill good">Code OK</span> ${esc(r.fields.issuer)} · client ${esc(r.fields.client_id)}${r.fields.support_events_url ? ' · events to ' + esc(new URL(r.fields.support_events_url).host) : ''}`; }
      catch (er) { $('#vprev', p).innerHTML = `<span class="pill bad">Not readable</span> ${esc(er.message)}`; }
    }, 350));
    $('#vconn', p).onclick = async (e) => {
      const body = W.manual ? { issuer: $('#vi', p).value.trim(), client_id: $('#vc', p).value.trim(), client_secret: $('#vs', p).value.trim(), support_events_url: $('#ve', p).value.trim(), webhook_secret: $('#vw', p).value.trim() } : { code: $('#vcode', p).value.trim() };
      const r = await act(e.currentTarget, () => POST('/api/admin/voosquare/connect', body), 'VooSquare details saved');
      if (r) { W.connect = r; W.st = r.status; chipFor(host, W.st); next(); }
    };
  }
  function s2(p) {
    const c = W.connect || { urls: W.st.urls, return_code: null };
    p.innerHTML = `<h3>Paste these into VooSquare</h3><p class="sub">In VooSquare → Apps → Vooads, paste the return code (or each address). Secrets are shown once.</p>
      ${c.return_code ? `<div class="hl"><b>Copy the return code now.</b> It holds your new service key${/webhook/.test(atobSafe(c.return_code)) ? ' and signing secret' : ''}. Afterwards only a masked hint is shown.</div>${copyRow('Return code', c.return_code)}` : '<div class="note">Your service key and signing secret are already set. Press <b>New keys</b> only if VooSquare lost them (it stops working until you paste the new ones).</div>'}
      <div class="rows2">${copyRow('Tickets API', c.urls.tickets_url)}${copyRow('Stats API', c.urls.stats_url)}${copyRow('Dashboard summary', c.urls.summary_url)}${copyRow('Login redirect URL', c.urls.redirect_uri)}</div>
      <div class="wz-foot"><button class="btn ghost sm" id="vrot">${ico('refresh')} New keys</button><button class="btn brand sm" id="vnext">I pasted them ${ARR()}</button></div>`;
    wireCopies(p);
    $('#vnext', p).onclick = next;
    $('#vrot', p).onclick = () => modal({ title: 'Make new keys?', body: '<p>The service key and signing secret are replaced. VooSquare stops working with Vooads until you paste the new return code there.</p>', ok: 'Make new keys', okClass: 'danger', onOk: async (w, btn) => {
      const x = await act(btn, () => POST('/api/admin/voosquare/rotate'), 'New keys made. Paste the return code into VooSquare.');
      if (!x) return false;
      W.connect = x; W.st = x.status; s2(p);
    } });
  }
  function s3(p) {
    const st = W.st;
    p.innerHTML = `<h3>Test both ways</h3><p class="sub">Vooads sends a signed ping to VooSquare, then calls its own VooSquare API with the service key. Test addresses (*.test, *.example) are simulated.</p>
      <label class="swl">${sw(st.parts.support, 'id="vsup"')}<span>Answer tickets from VooSquare too</span></label>
      <div class="rcards" id="vmode" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[['both', 'Here and in VooSquare', 'Both inboxes can reply. Recommended.'], ['voosquare', 'Only in VooSquare', 'This inbox becomes read-only.']].map(([k, t, h]) => `<button type="button" class="rcard ${st.mode === k ? 'on' : ''}" data-m="${k}"><b><i></i>${t}</b><span>${h}</span></button>`).join('')}</div>
      <div class="pingbox"><div class="pingrow" id="po"><b>Vooads</b><span class="lane"><i></i></span><span class="end">VooSquare</span><p>${esc(st.tests.out?.note || 'Not tested yet.')}</p></div>
        <div class="pingrow" id="pin"><b>VooSquare</b><span class="lane"><i></i></span><span class="end">Vooads</span><p>${esc(st.tests.in?.note || 'Not tested yet.')}</p></div></div>
      <div class="wz-foot"><span class="hint">Results are saved for the status chip.</span><div class="row"><button class="btn ghost sm" id="vtest">${ico('bolt')} Run test</button><button class="btn brand sm" id="vnext">Next: agents ${ARR()}</button></div></div>`;
    const mark = (id, t) => { const r = $(id, p); r.classList.remove('run', 'ok', 'no'); if (t) { r.classList.add(t.ok ? 'ok' : 'no'); $('p', r).textContent = t.note; } };
    if (st.tests.out) mark('#po', st.tests.out); if (st.tests.in) mark('#pin', st.tests.in);
    const saveMode = async (patch) => { const r = await act(null, () => POST('/api/admin/voosquare/support', patch)); if (r) { W.st = r; chipFor(host, r); } };
    $('#vsup', p).onclick = async (e) => { const on = swToggle(e.currentTarget); await saveMode({ enabled: on, mode: $('#vmode .rcard.on', p)?.dataset.m || 'both' }); toast(on ? 'VooSquare can now read and answer tickets' : 'VooSquare support switched off'); };
    $$('#vmode .rcard', p).forEach((x) => x.onclick = async () => { $$('#vmode .rcard', p).forEach((y) => y.classList.toggle('on', y === x)); await saveMode({ mode: x.dataset.m }); });
    $('#vtest', p).onclick = async (e) => {
      $('#po', p).classList.add('run'); $('#pin', p).classList.add('run');
      const r = await act(e.currentTarget, () => POST('/api/admin/voosquare/test'));
      if (!r) { mark('#po'); mark('#pin'); return; }
      mark('#po', r.out); mark('#pin', r.in); W.st = r.status; chipFor(host, r.status);
      toast(r.out.ok && r.in.ok ? 'Both directions work' : 'One direction needs attention', !(r.out.ok && r.in.ok));
      if (r.out.ok && r.in.ok && !W.done.includes(2)) W.done.push(2);
    };
    $('#vnext', p).onclick = next;
  }
  async function s4(p) {
    p.innerHTML = '<div class="sk"></div>';
    const r = await GET('/api/admin/voosquare/agents');
    const roles = r.roles.filter((x) => !x.owner);
    const map = r.map.slice();
    const draw = () => {
      p.innerHTML = `<h3>Agents and their Vooads role</h3><p class="sub">VooSquare agents act with the role you pick here (what they can reply, close, assign and give). A Vooads team member with the same email uses their own role.</p>
        <div class="rows2" id="agl">${map.map((m, i) => `<div class="agrow"><input class="inp sm" data-ae="${i}" type="email" value="${esc(m.email)}" placeholder="agent@company.com"><select class="inp sm" data-ar="${i}">${roles.map((x) => `<option value="${x.id}" ${x.id === m.role_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="iconbtn" data-ax="${i}" aria-label="Remove">${ico('trash')}</button></div>`).join('') || '<p class="hint">No agents mapped yet.</p>'}</div>
        <div class="row"><button class="btn ghost xs" id="agadd">${ico('plus')} Add agent</button>${r.recent.filter((e) => !map.some((m) => m.email === e)).slice(0, 4).map((e) => `<button class="btn ghost xs" data-rec="${esc(e)}">${ico('plus')} ${esc(e)}</button>`).join('')}</div>
        <div class="fld"><label>Everyone else from VooSquare</label><select class="inp sm" id="agdef"><option value="none">Blocked (no Vooads role)</option>${roles.map((x) => `<option value="${x.id}" ${x.id === r.default_role_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><small>Pick "Blocked" to allow only the agents above.</small></div>
        <div class="wz-foot"><span class="hint">Owner access is never given to VooSquare agents.</span><button class="btn brand sm" id="agsave">Save agents ${ARR()}</button></div>`;
      if (!r.default_role_id) $('#agdef', p).value = 'none';
      $$('[data-ae]', p).forEach((x) => x.oninput = () => { map[Number(x.dataset.ae)].email = x.value.trim().toLowerCase(); });
      $$('[data-ar]', p).forEach((x) => x.onchange = () => { map[Number(x.dataset.ar)].role_id = Number(x.value); });
      $$('[data-ax]', p).forEach((x) => x.onclick = () => { map.splice(Number(x.dataset.ax), 1); draw(); });
      $$('[data-rec]', p).forEach((x) => x.onclick = () => { map.push({ email: x.dataset.rec, role_id: roles.find((y) => y.name === 'Support agent')?.id || roles[0]?.id }); draw(); });
      $('#agadd', p).onclick = () => { map.push({ email: '', role_id: roles.find((y) => y.name === 'Support agent')?.id || roles[0]?.id }); draw(); setTimeout(() => $$('[data-ae]', p).pop()?.focus(), 30); };
      $('#agsave', p).onclick = async (e) => { const x = await act(e.currentTarget, () => PUT('/api/admin/voosquare/agents', { map: map.filter((m) => m.email), default_role_id: $('#agdef', p).value }), 'Agents saved'); if (x) { if (!W.done.includes(3)) W.done.push(3); host.querySelector('#vsb').hidden = true; voosquareCard(host); } };
    };
    draw();
  }
  paint();
}
function atobSafe(code) { try { return atob(String(code).replace(/^vsq1\./, '').replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } }

// ================================================================ Payments: bank transfers waiting for review
const basePayments = VIEWS.payments;
VIEWS.payments = async (el, acts) => {
  await basePayments(el, acts);
  if (!el.isConnected) return;
  const r = await tryGet('/api/admin/payments/review');
  if (!r.ok) return;
  const list = r.data.payments.filter((p) => p.status === 'review' || p.proof_url);
  if (!list.length) return;
  const host = document.createElement('div'); host.className = 'card';
  (el.firstElementChild || el).insertBefore(host, (el.firstElementChild || el).firstChild);
  host.innerHTML = `<div class="card-h"><div><h3>Bank transfers waiting for review</h3><p>Check the receipt matches your bank statement, then approve (credits are added) or reject.</p></div><span class="pill warn">${list.length} waiting</span></div>
    <div class="card-b list">${list.map((p) => `<div class="li" data-id="${p.id}"><div class="row" style="flex-wrap:nowrap;gap:12px;min-width:0">${p.proof_url ? `<span class="proof" style="background-image:url('${esc(p.proof_url)}')" data-proof="${esc(p.proof_url)}" title="Open receipt"></span>` : ''}<div class="m"><b>${esc(p.reference)} · ${usd(p.amount_usd)}${p.amount_local && p.currency !== 'USD' ? ' · ' + esc(p.currency) + ' ' + num(p.amount_local).toLocaleString() : ''}</b><small>${esc(p.email || '')} · ${esc(p.kind === 'plan' ? 'Plan ' + (p.plan_id || '') : 'Top-up')} · ${esc(p.method_name || 'Bank transfer')} · ${ago(p.created_at)}${p.status === 'pending' ? ' · no receipt yet' : ''}</small></div></div>
      ${can('payments.refund') ? `<div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn ghost xs" data-rej>Reject</button><button class="btn brand xs" data-ok>${ico('check')} Approve</button></div>` : ''}</div>`).join('')}</div>`;
  $$('[data-proof]', host).forEach((x) => x.onclick = () => modal({ title: 'Receipt', body: `<img src="${esc(x.dataset.proof)}" alt="Receipt" style="width:100%;border-radius:14px">`, ok: '', cancel: 'Close', cls: 'wide' }));
  $$('.li[data-id]', host).forEach((li) => {
    const id = li.dataset.id;
    $('[data-ok]', li) && ($('[data-ok]', li).onclick = (e) => act(e.currentTarget, () => POST(`/api/admin/payments/${id}/approve`), 'Approved. Credits are in the customer\'s wallet.').then((x) => x && route()));
    $('[data-rej]', li) && ($('[data-rej]', li).onclick = () => modal({ title: 'Reject this transfer?', body: '<div class="fld"><label>Why (the customer sees this)</label><textarea class="inp" id="rj" rows="3" maxlength="300" placeholder="e.g. We could not find this transfer. Send the receipt with the reference VA-…"></textarea></div>', ok: 'Reject', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => POST(`/api/admin/payments/${id}/reject`, { note: $('#rj', w).value.trim() }), 'Rejected'); if (!x) return false; route(); } }));
  });
};

// ================================================================ Payment methods: add-method wizard
const PAY_TYPES = [
  ['gatevoo', 'Gatevoo', 'Your own crypto checkout: USDT and BTC.', '#0B0B0A', 'Gv'], ['stripe', 'Stripe', 'Cards, Apple Pay, Google Pay. Auto-renewing plans.', '#635BFF', 'St'],
  ['bachs', 'Bachs', 'Africa: naira for Nigeria, cards, bank transfer, mobile money, USDT.', '#1F4BFF', 'Ba'],
  ['paystack', 'Paystack', 'Nigeria, Ghana, Kenya, South Africa: cards, transfer, mobile money.', '#0BA4DB', 'Ps'], ['flutterwave', 'Flutterwave', 'Africa-wide cards and mobile money.', '#F5A623', 'Fw'],
  ['nowpayments', 'NOWPayments', 'Crypto with many coins.', '#26A17B', 'Np'], ['manual', 'Bank transfer', 'Customers pay into your bank and upload a receipt. You approve it.', '#3A3833', 'bank'],
  ['custom', 'Custom API', 'Any provider with a payment link and a signed webhook. No code.', '#FF4A1C', 'code'],
];
const baseMethods = VIEWS.methods;
VIEWS.methods = async (el, acts) => {
  await baseMethods(el, acts);
  if (!el.isConnected) return;
  let r; try { r = await GET('/api/admin/payment-methods'); } catch { return; }
  if (can('payments.manage')) { acts.innerHTML = `<button class="btn brand sm" id="addw">${ico('plus')} Add payment method</button>`; $('#addw').onclick = () => payWizard(r.adapters); }
  $$('.mcard', el).forEach((c) => {
    const m = r.methods.find((x) => x.id === Number(c.dataset.id)); if (!m) return;
    if (m.config?.logo_url) { const lg = $('.mlogo', c); if (lg) { lg.style.background = '#fff'; lg.style.boxShadow = 'inset 0 0 0 1px var(--line)'; lg.innerHTML = `<img src="${esc(m.config.logo_url)}" alt="">`; } }
    if (m.adapter === 'manual') { const lg = $('.mlogo', c); if (lg && !m.config?.logo_url) { lg.style.background = '#3A3833'; lg.innerHTML = ico('bank'); $('svg', lg).style.width = '20px'; } }
    const row = $('.row.end', c);
    if (row && can('payments.manage')) { const t = document.createElement('button'); t.className = 'btn ghost sm'; t.innerHTML = ico('bolt') + ' Test'; t.onclick = () => payTest(m); row.insertBefore(t, row.firstChild); }
  });
};
async function payTest(m) {
  const w = modal({ title: 'Sandbox test: ' + esc(m.name), body: '<div class="sk"></div><div class="sk" style="margin-top:10px;width:70%"></div>', ok: '', cancel: 'Close', cls: 'wide' });
  const x = await act(null, () => POST(`/api/admin/payment-methods/${m.id}/sandbox`));
  if (!x || !w.isConnected) return;
  $('.body', w).innerHTML = sandboxHTML(x);
}
function sandboxHTML(x) {
  return `<div class="note ${x.ok ? 'good' : 'bad'}"><b>${x.ok ? 'All checks passed.' : 'Some checks need you.'}</b> ${esc(x.note)} No money moves and nothing is saved.</div>${checkList(x.steps)}
    ${x.request ? `<details><summary class="hint" style="cursor:pointer;font-weight:700;margin:6px 0">The request Vooads sends to create a payment (sample $49 order)</summary><div class="codeblock">${esc(x.request.method + ' ' + x.request.url + '\n' + JSON.stringify({ headers: x.request.headers, body: x.request.body }, null, 2))}</div></details>` : ''}
    ${x.instructions ? `<div class="card pad" style="box-shadow:none;background:var(--soft)"><div class="hint" style="font-weight:700;margin-bottom:6px">What the customer sees</div><b>${esc(x.instructions.bank_name)} · ${esc(x.instructions.account_name)}</b><div style="font-size:20px;font-weight:800;letter-spacing:-.03em">${esc(x.instructions.account_number)}</div><div class="hint">Reference ${esc(x.instructions.reference)} · ${x.instructions.amount_local ? esc(x.instructions.currency) + ' ' + num(x.instructions.amount_local).toLocaleString() : usd(x.instructions.amount_usd)}</div>${x.instructions.extra ? `<p class="hint" style="margin-top:6px;white-space:pre-wrap">${esc(x.instructions.extra)}</p>` : ''}</div>` : ''}`;
}
// Custom API simple builder → payments/custom.js config (body template + headers built from plain fields).
const CUSTOM_SIMPLE = [
  { sec: 'Creating a payment' },
  { k: 'checkout_url', l: 'Create-payment URL', ph: 'https://api.provider.com/v1/payments', h: 'Vooads calls this when a customer checks out.', full: 1 },
  { k: 'method', l: 'Method', sel: ['POST', 'PUT', 'GET'] }, { k: 'response_url_path', l: 'Where the payment link is in the answer', ph: 'data.link', h: 'Dot path, e.g. data.authorization_url.' },
  { k: 'auth_name', l: 'Auth header name', ph: 'Authorization', d: 'Authorization' }, { k: 'auth_value', l: 'Auth header value', ph: 'Bearer {{secret}}', d: 'Bearer {{secret}}', h: '{{secret}} is the API key you paste below.' },
  { sec: 'What Vooads sends (field names in their API)' },
  { k: 'f_amount', l: 'Amount field', ph: 'amount', d: 'amount' }, { k: 'amount_fmt', l: 'Amount is sent as', sel: ['local money (e.g. 75950.00)', 'smallest unit (kobo/cents, e.g. 7595000)', 'US dollars (e.g. 49.00)'] },
  { k: 'f_currency', l: 'Currency field', ph: 'currency', d: 'currency' }, { k: 'currency', l: 'Currency code', ph: 'NGN', d: 'USD' }, { k: 'usd_rate', l: 'Local money per $1', ph: '1550', num: 1, d: '1' },
  { k: 'f_reference', l: 'Reference field', ph: 'reference', d: 'reference', h: 'Vooads sends va_<payment number> here.' }, { k: 'f_email', l: 'Customer email field (optional)', ph: 'email', d: 'email' },
  { k: 'f_return', l: 'Return URL field (optional)', ph: 'callback_url', d: 'callback_url', h: 'Where the customer goes after paying.' }, { k: 'f_webhook', l: 'Webhook URL field (optional)', ph: 'notify_url', h: 'Only if the API wants it per payment.' },
  { sec: 'Confirming the payment (webhook)' },
  { k: 'signature_header', l: 'Signature header', ph: 'x-signature', h: 'Header the provider signs webhooks with.' }, { k: 'signature_algo', l: 'Signature type', sel: ['sha256', 'sha512', 'none'] },
  { k: 'signature_prefix', l: 'Signature prefix (optional)', ph: 'sha256=' }, { k: 'paid_path', l: 'Success status field', ph: 'event', h: 'e.g. event or data.status' },
  { k: 'paid_value', l: 'Value that means paid', ph: 'charge.success' }, { k: 'payment_id_path', l: 'Where our reference comes back', ph: 'data.reference', h: 'Dot path to the reference Vooads sent.' },
  { k: 'amount_path', l: 'Paid amount field (optional)', ph: 'data.amount', h: 'Lets Vooads check the full amount was paid (main units).' },
];
function setPath(obj, path, val) { const ks = String(path || '').split('.').filter(Boolean); if (!ks.length) return; let o = obj; ks.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = val; }
function buildCustom(v) {
  const amtTok = /smallest/.test(v.amount_fmt || '') ? '{{amount_minor}}' : /US dollars/.test(v.amount_fmt || '') ? '{{amount_usd}}' : '{{amount_local}}';
  const body = {}, AMT = '\u0001AMT\u0001';
  if (v.f_amount) setPath(body, v.f_amount, AMT);
  if (v.f_currency) setPath(body, v.f_currency, '{{currency}}');
  if (v.f_reference) setPath(body, v.f_reference, '{{reference}}');
  if (v.f_email) setPath(body, v.f_email, '{{email}}');
  if (v.f_return) setPath(body, v.f_return, '{{success_url}}');
  if (v.f_webhook) setPath(body, v.f_webhook, '{{webhook_url}}');
  setPath(body, 'metadata.payment_id', '{{payment_id}}');
  return { body_template: JSON.stringify(body, null, 2).replace(JSON.stringify(AMT), amtTok), headers_json: v.auth_name ? JSON.stringify({ [v.auth_name]: v.auth_value || '' }) : '' };
}
function payWizard(adapters) {
  const W = { step: 0, done: [], type: null, m: null, v: {}, raw: false, test: null, logo: '' };
  const LABELS = ['Type', 'Set up', 'Test', 'Go live'];
  const d = openDrawer({ title: 'Add a payment method', sub: 'Pick, fill in, test in a sandbox, then switch it on.', body: '<div class="wz" id="pw"></div>' });
  const paint = () => {
    $('#pw', d).innerHTML = `${wzSteps(LABELS, W.step, W.done)}<div class="wz-pane" id="pp"></div>`;
    $$('#pw .wz-steps [data-step]', d).forEach((x) => x.onclick = () => { W.step = Number(x.dataset.step); paint(); });
    [p1, p2, p3, p4][W.step]($('#pp', d));
    $('.db', d).scrollTop = 0;
  };
  const next = () => { if (!W.done.includes(W.step)) W.done.push(W.step); W.step++; paint(); };
  const info = () => METHOD_INFO[W.type] || {};
  function p1(p) {
    p.innerHTML = `<h3>What kind of payment?</h3><div class="picks">${PAY_TYPES.filter(([k]) => adapters[k]).map(([k, l, h, c, s]) => `<button type="button" class="pick ${W.type === k ? 'on' : ''}" data-t="${k}" ${W.m && W.type !== k ? 'disabled' : ''}><span class="pi" style="background:${c}">${s === 'bank' || s === 'code' ? ico(s) : esc(s)}</span><b>${esc(l)}</b><small>${esc(h)}</small></button>`).join('')}</div>
      <div class="wz-foot"><span class="hint">${W.m ? 'Already created. Change details in the next step.' : 'It starts switched off.'}</span><button class="btn brand sm" id="n1" ${W.type ? '' : 'disabled'}>Next ${ARR()}</button></div>`;
    $$('[data-t]', p).forEach((b) => b.onclick = () => { W.type = b.dataset.t; $$('[data-t]', p).forEach((x) => x.classList.toggle('on', x === b)); $('#n1', p).disabled = false; });
    $('#n1', p).onclick = next;
  }
  const field = (f) => {
    if (f.sec) return `<div class="secth"><span>${esc(f.sec)}</span></div>`;
    const v = W.v[f.k] ?? f.d ?? '';
    const input = f.sel ? `<select class="inp sm" data-f="${f.k}">${f.sel.map((o) => `<option ${String(v || f.sel[0]) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : f.ta ? `<textarea class="inp sm" rows="3" data-f="${f.k}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`
      : `<input class="inp sm" data-f="${f.k}" ${f.secret ? 'type="password" autocomplete="new-password"' : f.num ? 'type="number" step="any" min="0"' : ''} value="${esc(f.secret ? '' : v)}" placeholder="${esc(f.ph || '')}">`;
    return `<div class="fld ${f.full ? 'full' : ''}"><label>${esc(f.l)}</label>${input}${f.h ? `<small>${esc(f.h)}</small>` : ''}</div>`;
  };
  const fieldsFor = () => {
    const a = adapters[W.type] || {}, I = info();
    const keys = [];
    if ((a.fields || []).includes('secret') || W.type === 'custom') keys.push({ k: '_secret', l: I.secret || 'Secret key', ph: W.m?.secret_set ? 'Saved. Leave blank to keep it.' : 'Paste the key', secret: 1, full: 1, h: 'Get it at ' + (I.keys || 'the provider dashboard') + '. Stored encrypted.' });
    if ((a.fields || []).includes('webhookSecret') || W.type === 'custom') keys.push({ k: '_wh', l: I.wh || 'Webhook secret', ph: W.m?.webhook_set ? 'Saved. Leave blank to keep it.' : 'Paste the webhook secret', secret: 1, full: 1 });
    if (W.type === 'stripe') keys.push({ k: '_pk', l: 'Publishable key (optional)', ph: 'pk_live_…', full: 1 });
    if (W.type === 'custom') return [...CUSTOM_SIMPLE.slice(0, 5), { sec: 'Keys' }, ...keys, ...CUSTOM_SIMPLE.slice(5)];
    const cfg = (a.config_fields || []).map((f) => ({ k: f.key, l: f.label, h: f.help, ph: f.placeholder || (f.default != null ? String(f.default) : ''), sel: f.options, ta: f.type === 'textarea', num: f.type === 'number', full: f.type === 'textarea' || /url/.test(f.key) }));
    return [...(keys.length ? [{ sec: 'Keys' }, ...keys] : []), ...(cfg.length ? [{ sec: W.type === 'manual' ? 'Your bank details' : 'Settings' }, ...cfg] : [])];
  };
  const collect = (p) => { $$('[data-f]', p).forEach((i) => { W.v[i.dataset.f] = i.value.trim(); }); };
  function p2(p) {
    const fs = fieldsFor();
    const I = info();
    p.innerHTML = `<h3>${esc(PAY_TYPES.find((x) => x[0] === W.type)?.[1] || 'Set up')}</h3>
      ${W.type === 'custom' ? '<p class="sub">Fill in the names their API uses. Vooads builds the request and checks the webhook for you.</p>' : I.hook ? `<p class="sub">${esc(I.hook)}</p>` : ''}
      <div class="fields">${fs.map(field).join('')}</div>
      ${W.type === 'custom' ? `<details id="rawd" ${W.raw ? 'open' : ''}><summary class="hint" style="cursor:pointer;font-weight:700">Advanced: edit the raw request template</summary><div class="fields" style="margin-top:10px"><div class="fld full"><label>Body template (JSON)</label><textarea class="inp sm" rows="9" id="rawb" spellcheck="false"></textarea><small>Built from the fields above. Edit it only if the API needs a shape the fields cannot make.</small></div><div class="fld full"><label>Headers (JSON)</label><textarea class="inp sm" rows="3" id="rawh" spellcheck="false"></textarea></div></div></details>` : ''}
      <div class="wz-foot"><button class="btn ghost sm" id="b2">Back</button><button class="btn brand sm" id="n2">${W.m ? 'Save and test' : 'Create and test'} ${ARR()}</button></div>`;
    const syncRaw = () => { if (W.type !== 'custom' || W.raw) return; collect(p); const c = buildCustom(W.v); $('#rawb', p).value = c.body_template; $('#rawh', p).value = c.headers_json; };
    if (W.type === 'custom') {
      if (W.v._rawb) { $('#rawb', p).value = W.v._rawb; $('#rawh', p).value = W.v._rawh || ''; } else syncRaw();
      $$('[data-f]', p).forEach((i) => i.addEventListener('input', debounce(syncRaw, 200)));
      $('#rawb', p).oninput = $('#rawh', p).oninput = () => { W.raw = true; W.v._rawb = $('#rawb', p).value; W.v._rawh = $('#rawh', p).value; };
    }
    $('#b2', p).onclick = () => { collect(p); W.step = 0; paint(); };
    $('#n2', p).onclick = async (e) => {
      collect(p);
      const config = clone(W.m?.config || {});
      for (const f of fs) if (f.k && !f.k.startsWith('_') && !/^f_|^auth_|^amount_fmt$/.test(f.k)) { const v = W.v[f.k]; if (v === '' || v === undefined) delete config[f.k]; else config[f.k] = f.num ? Number(v) : v; }
      if (W.type === 'custom') {
        const built = buildCustom(W.v);
        config.body_template = W.raw && $('#rawb', p).value.trim() ? $('#rawb', p).value.trim() : built.body_template;
        config.headers_json = W.raw ? $('#rawh', p).value.trim() : built.headers_json;
        try { JSON.parse(config.body_template.replace(/\{\{\s*\w+\s*\}\}/g, '1')); } catch { return toast('The body template is not valid JSON.', true); }
        config.wizard = { f_amount: W.v.f_amount, amount_fmt: W.v.amount_fmt, f_currency: W.v.f_currency, f_reference: W.v.f_reference, f_email: W.v.f_email, f_return: W.v.f_return, f_webhook: W.v.f_webhook, auth_name: W.v.auth_name, auth_value: W.v.auth_value };
      }
      const body = { config };
      if (W.v._secret) body.secret = W.v._secret; if (W.v._wh) body.webhook_secret = W.v._wh; if (W.v._pk !== undefined && W.type === 'stripe') body.public_key = W.v._pk;
      const x = await act(e.currentTarget, async () => {
        if (!W.m) W.m = (await POST('/api/admin/payment-methods', { adapter: W.type, name: PAY_TYPES.find((t) => t[0] === W.type)?.[1] })).method;
        return PUT('/api/admin/payment-methods/' + W.m.id, body);
      }, 'Saved (still switched off)');
      if (!x) return;
      W.m = x.method; W.test = null; next();
    };
  }
  async function p3(p) {
    p.innerHTML = `<h3>Test in the sandbox</h3><p class="sub">No money moves. Vooads checks your settings, builds the real request and runs a signed test webhook through your setup.</p><div id="tres"><div class="sk"></div><div class="sk" style="margin-top:10px;width:70%"></div></div>
      <div class="wz-foot"><button class="btn ghost sm" id="b3">Back</button><div class="row"><button class="btn ghost sm" id="again">${ico('refresh')} Test again</button>${!['manual', 'custom', 'test'].includes(W.type) ? `<button class="btn ghost sm" id="live">${ico('globe')} Check with ${esc(PAY_TYPES.find((t) => t[0] === W.type)?.[1] || 'provider')}</button>` : ''}<button class="btn brand sm" id="n3">Next ${ARR()}</button></div></div>`;
    const run = async () => { $('#tres', p).innerHTML = '<div class="sk"></div><div class="sk" style="margin-top:10px;width:70%"></div>'; const x = await act(null, () => POST(`/api/admin/payment-methods/${W.m.id}/sandbox`)); if (!x) { $('#tres', p).innerHTML = ''; return; } W.test = x; $('#tres', p).innerHTML = sandboxHTML(x); };
    $('#b3', p).onclick = () => { W.step = 1; paint(); };
    $('#again', p).onclick = run;
    $('#live', p) && ($('#live', p).onclick = async (e) => { const x = await act(e.currentTarget, () => POST(`/api/admin/payment-methods/${W.m.id}/test`)); if (x) toast((x.ok ? 'Provider says OK: ' : 'Provider check failed: ') + (x.note || ''), !x.ok); });
    $('#n3', p).onclick = () => { if (W.test && !W.test.ok) return modal({ title: 'Continue with failing checks?', body: '<p>Customers may not be able to pay, or payments may not confirm. You can still save it switched off.</p>', ok: 'Continue', onOk: () => { next(); } }); next(); };
    run();
  }
  function p4(p) {
    const m = W.m, c = m.config || {};
    const fx = ['paystack', 'flutterwave', 'custom', 'manual'].includes(W.type);
    W.logo = c.logo_url || '';
    p.innerHTML = `<h3>Go live</h3><p class="sub">What customers see at checkout, and where.</p>
      <div class="fields"><div class="fld full"><label>Display name</label><input class="inp sm" id="gn" maxlength="60" value="${esc(m.name)}"></div>
        <div class="fld full"><label>Logo (optional)</label><div class="row" style="flex-wrap:nowrap"><span class="mlogo" id="glp" style="background:${W.logo ? '#fff' : 'var(--soft)'};box-shadow:inset 0 0 0 1px var(--line);color:var(--mut)">${W.logo ? `<img src="${esc(W.logo)}" alt="">` : ico('image')}</span><label class="btn ghost sm" style="cursor:pointer">${ico('upload')} Upload<input type="file" id="gl" accept="image/png,image/jpeg,image/webp" hidden></label>${W.logo ? '<button class="linkbtn" id="glx">Remove</button>' : ''}</div><small>Square PNG or JPG, shown next to the name.</small></div>
        <div class="fld full"><label>Countries</label><input class="inp sm" id="gc" value="${esc((m.countries || []).join(', ') || '*')}" placeholder="* or NG, GH, KE"><div class="chips" style="margin-top:6px"><button type="button" class="btn ghost xs" data-cc="*">Everywhere</button><button type="button" class="btn ghost xs" data-cc="NG, GH, KE, ZA, CM">Africa core</button><button type="button" class="btn ghost xs" data-cc="NG">Nigeria</button><button type="button" class="btn ghost xs" data-cc="KE">Kenya</button></div></div>
        ${fx ? `<div class="fld"><label>Currency</label><input class="inp sm" id="gcur" value="${esc(c.currency || 'USD')}" maxlength="3" placeholder="NGN"></div><div class="fld"><label>Local money per $1</label><input class="inp sm" id="grate" type="number" step="any" min="0" value="${esc(c.usd_rate ?? '')}" placeholder="1550"><small id="gfx"></small></div>` : ''}
        <div class="fld"><label>Order at checkout</label><input class="inp sm" id="go" type="number" min="0" max="1000" value="${esc(m.sort)}"><small>Lower shows first.</small></div>
        <div class="fld"><label>Status</label><label class="swl" style="margin-top:6px">${sw(true, 'id="gen"')}<span>Customers can pay with it</span></label></div></div>
      <div class="wz-foot"><button class="btn ghost sm" id="b4">Back</button><button class="btn brand sm" id="gsave">Save ${ARR()}</button></div>`;
    const fxu = () => { const rt = Number($('#grate', p)?.value), cu = ($('#gcur', p)?.value || '').toUpperCase(); if ($('#gfx', p)) $('#gfx', p).textContent = cu === 'USD' ? 'USD needs no rate.' : rt ? 'A $49 plan costs ' + cu + ' ' + (49 * rt).toLocaleString() : 'Needed for non-USD.'; };
    $('#grate', p) && ($('#grate', p).oninput = fxu); $('#gcur', p) && ($('#gcur', p).oninput = fxu); fxu();
    $$('[data-cc]', p).forEach((b) => b.onclick = () => { $('#gc', p).value = b.dataset.cc; });
    $('#gen', p).onclick = (e) => swToggle(e.currentTarget);
    const keep = () => { W.m.name = $('#gn', p).value; W.m.countries = $('#gc', p).value.split(',').map((x) => x.trim()).filter(Boolean); W.m.sort = Number($('#go', p).value); if ($('#gcur', p)) W.m.config = { ...(W.m.config || {}), currency: $('#gcur', p).value, usd_rate: $('#grate', p).value }; };
    $('#gl', p).onchange = async (e) => { const f = e.target.files[0]; const url = await act(null, () => uploadImage(f), 'Logo uploaded'); if (url) { keep(); W.logo = url; W.m.config = { ...(W.m.config || {}), logo_url: url }; p4(p); } };
    $('#glx', p) && ($('#glx', p).onclick = () => { keep(); W.logo = ''; W.m.config = { ...(W.m.config || {}), logo_url: '' }; p4(p); });
    $('#b4', p).onclick = () => { W.step = 2; paint(); };
    $('#gsave', p).onclick = async (e) => {
      const config = clone(m.config || {});
      if (W.logo) config.logo_url = W.logo; else delete config.logo_url;
      if ($('#gcur', p)) { config.currency = $('#gcur', p).value.trim().toUpperCase() || 'USD'; const rt = $('#grate', p).value; if (rt) config.usd_rate = Number(rt); }
      const x = await act(e.currentTarget, () => PUT('/api/admin/payment-methods/' + m.id, { name: $('#gn', p).value.trim() || m.name, countries: $('#gc', p).value, sort: Number($('#go', p).value), enabled: swOn($('#gen', p)), config }), (y) => y.method.enabled ? y.method.name + ' is live' : 'Saved, switched off');
      if (x) { closeDrawer(); route(); }
    };
  }
  paint();
}

// ================================================================ AI providers: "Add AI model" wizard
const baseProviders = VIEWS.providers;
VIEWS.providers = async (el, acts) => {
  await baseProviders(el, acts);
  if (!el.isConnected || !can('providers.manage')) return;
  const old = $('#addp');
  if (old) { old.className = 'btn ghost sm'; old.innerHTML = ico('sliders') + ' Advanced'; old.title = 'Add a provider with every setting'; }
  const b = document.createElement('button'); b.className = 'btn brand sm'; b.innerHTML = ico('plus') + ' Add AI model';
  b.onclick = () => modelWizard();
  acts.appendChild(b);
};
const KIND_IC = { video: 'video', image: 'image', voice: 'voice', music: 'music', text: 'text', ugc: 'ugc', dub: 'dub' };
const KIND_HINT = { video: 'Product shots, b-roll, animated scenes', image: 'Ad images and presenter photos', voice: 'Voiceovers in any language', music: 'Background music for ads', text: 'Scripts, hooks and copy', ugc: 'A talking presenter from a photo and voice', dub: 'Lip-sync a video to a new voice' };
async function modelWizard() {
  const meta = await act(null, () => GET('/api/admin/ai-models/meta'));
  if (!meta) return;
  const W = { step: 0, done: [], kind: null, preset: null, f: {}, name: '', key: '', cost: '', unit: '', test: null, sample: '', sresp: '', use: { mode: 'fallback' } };
  const LABELS = ['What it makes', 'Connect', 'Cost and test', 'Where it is used'];
  const d = openDrawer({ title: 'Add an AI model', sub: 'Any model, no code. The profit guard checks prices when you save.', body: '<div class="wz" id="mw"></div>' });
  const paint = () => {
    $('#mw', d).innerHTML = `${wzSteps(LABELS, W.step, W.done)}<div class="wz-pane" id="mp"></div>`;
    $$('#mw .wz-steps [data-step]', d).forEach((x) => x.onclick = () => { W.step = Number(x.dataset.step); paint(); });
    [m1, m2, m3, m4][W.step]($('#mp', d));
    $('.db', d).scrollTop = 0;
  };
  const next = () => { if (!W.done.includes(W.step)) W.done.push(W.step); W.step++; paint(); };
  const body = () => ({ kind: W.kind, preset: W.preset, name: W.name, fields: W.f, api_key: W.key, cost_usd: Number(W.cost) || 0, cost_unit: W.unit || meta.kinds[W.kind]?.unit });
  function m1(p) {
    p.innerHTML = `<h3>What will this model make?</h3><div class="picks">${Object.entries(meta.kinds).map(([k, v]) => `<button type="button" class="pick ${W.kind === k ? 'on' : ''}" data-k="${k}"><span class="pi">${ico(KIND_IC[k] || 'features')}</span><b>${esc(v.label)}</b><small>${esc(KIND_HINT[k] || '')}</small></button>`).join('')}</div>
      <div class="wz-foot"><span></span><button class="btn brand sm" id="n1" ${W.kind ? '' : 'disabled'}>Next ${ARR()}</button></div>`;
    $$('[data-k]', p).forEach((b) => b.onclick = () => { W.kind = b.dataset.k; if (W.preset && !meta.presets[W.preset].kinds.includes(W.kind)) W.preset = null; W.unit = meta.kinds[W.kind].unit; $$('[data-k]', p).forEach((x) => x.classList.toggle('on', x === b)); $('#n1', p).disabled = false; });
    $('#n1', p).onclick = next;
  }
  function m2(p) {
    const presets = Object.entries(meta.presets).filter(([, v]) => v.kinds.includes(W.kind));
    const pr = W.preset && meta.presets[W.preset];
    p.innerHTML = `<h3>How do you connect it?</h3><div class="picks">${presets.map(([k, v]) => `<button type="button" class="pick ${W.preset === k ? 'on' : ''}" data-p="${k}"><span class="pi" style="background:${{ fal: '#6D5BFF', elevenlabs: '#121110', elevenlabs_music: '#121110', openai: '#10A37F', replicate: '#3A3833', http: '#FF4A1C' }[k] || 'var(--ink)'}">${ico(k === 'http' ? 'code' : k === 'replicate' ? 'refresh' : 'providers')}</span><b>${esc(v.label)}</b><small>${esc(v.help)}</small></button>`).join('')}</div>
      ${pr ? `<div class="fields" style="margin-top:4px"><div class="fld full"><label>Name in the admin</label><input class="inp sm" id="mn" maxlength="60" value="${esc(W.name)}" placeholder="${esc(pr.label + ' · ' + meta.kinds[W.kind].label)}"></div>
        ${pr.fields.filter((f) => !f.kinds || f.kinds.includes(W.kind)).map((f) => `<div class="fld ${f.tpl || f.json || /url/i.test(f.k) || f.k === 'model' ? 'full' : ''}"><label>${esc(f.l)}</label>${f.sel ? `<select class="inp sm" data-mf="${f.k}">${f.sel.map((o) => `<option ${W.f[f.k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.tpl || f.json ? `<textarea class="inp sm" rows="${f.k === 'body' || f.k === 'input' ? 5 : 3}" data-mf="${f.k}" placeholder="${esc(f.ph || '')}" spellcheck="false">${esc(W.f[f.k] || '')}</textarea>${f.tpl ? `<div class="chipins" data-for="${f.k}">${['prompt', 'image_url', 'seconds', 'aspect', 'text', 'audio_url', 'key'].map((t) => `<button type="button" data-tok="${t}">{{${t}}}</button>`).join('')}</div>` : ''}` : `<input class="inp sm" data-mf="${f.k}" value="${esc(W.f[f.k] || '')}" placeholder="${esc(f.ph || '')}">`}${f.h ? `<small>${esc(f.h)}</small>` : ''}</div>`).join('')}
        <div class="fld full"><label>API key${pr.keyOptional ? ' (optional)' : ''}</label><input class="inp sm" id="mk" type="password" autocomplete="new-password" value="${esc(W.key)}" placeholder="Paste the key"><small>Get it at ${esc(pr.key)}. Stored encrypted.${W.preset === 'fal' ? ' Leave empty to use the fal key you already saved.' : ''}</small></div></div>` : ''}
      <div class="wz-foot"><button class="btn ghost sm" id="b2">Back</button><button class="btn brand sm" id="n2" ${pr ? '' : 'disabled'}>Next ${ARR()}</button></div>`;
    $$('[data-p]', p).forEach((b) => b.onclick = () => { collect(p); W.preset = b.dataset.p; m2(p); });
    $$('.chipins [data-tok]', p).forEach((b) => b.onclick = () => { const ta = $(`[data-mf="${b.closest('.chipins').dataset.for}"]`, p); const tok = '{{' + b.dataset.tok + '}}'; const a = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, a) + tok + ta.value.slice(ta.selectionEnd ?? a); ta.focus(); ta.selectionStart = ta.selectionEnd = a + tok.length; });
    $('#b2', p).onclick = () => { collect(p); W.step = 0; paint(); };
    $('#n2', p).onclick = () => { collect(p); next(); };
  }
  const collect = (p) => { $$('[data-mf]', p).forEach((i) => { W.f[i.dataset.mf] = i.value.trim(); }); if ($('#mn', p)) W.name = $('#mn', p).value.trim(); if ($('#mk', p)) W.key = $('#mk', p).value.trim(); };
  function m3(p) {
    p.innerHTML = `<h3>Cost and a test run</h3><p class="sub">What one unit costs you. Every job and tool using this model is priced on it, so nothing runs below your margin.</p>
      <div class="fields"><div class="fld"><label>Your cost (USD)</label><input class="inp sm" id="mc" type="number" step="0.0001" min="0" value="${esc(W.cost)}" placeholder="0.07"></div>
        <div class="fld"><label>Per</label><select class="inp sm" id="mu">${meta.units.map((u) => `<option ${(W.unit || meta.kinds[W.kind].unit) === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
        <div class="fld full"><label>Sample prompt</label><input class="inp sm" id="ms" value="${esc(W.sample)}" placeholder="Leave empty for a ready-made sample"></div>
        <div class="fld full"><details ${W.sresp ? 'open' : ''}><summary class="hint" style="cursor:pointer;font-weight:700">Check the result path with a sample answer (optional)</summary><textarea class="inp sm" id="mr" rows="4" spellcheck="false" placeholder='{"data": {"url": "https://..."}}' style="margin-top:8px">${esc(W.sresp)}</textarea></details></div></div>
      <div id="mtres"></div>
      <div class="wz-foot"><button class="btn ghost sm" id="b3">Back</button><div class="row"><button class="btn ghost sm" id="dry">${ico('eye')} Dry run</button><button class="btn ghost sm" id="live">${ico('bolt')} Run for real</button><button class="btn brand sm" id="n3">Next ${ARR()}</button></div></div>`;
    const grab = () => { W.cost = $('#mc', p).value; W.unit = $('#mu', p).value; W.sample = $('#ms', p).value.trim(); W.sresp = $('#mr', p).value.trim(); };
    const run = async (mode, btn) => {
      grab();
      const x = await act(btn, () => POST('/api/admin/ai-models/test', { ...body(), mode, sample_prompt: W.sample || undefined, sample_response: W.sresp || undefined }));
      if (!x) return;
      W.test = x;
      const r = x.result;
      $('#mtres', p).innerHTML = `${checkList(x.steps)}${x.request ? `<details ${mode === 'dry' ? 'open' : ''}><summary class="hint" style="cursor:pointer;font-weight:700;margin:8px 0">The request this model gets (keys hidden)</summary><div class="codeblock">${esc((x.request.method || 'POST') + ' ' + (x.request.url || '') + '\n' + JSON.stringify({ headers: x.request.headers, body: x.request.body }, null, 2))}</div></details>` : ''}
        ${r ? `<div class="tryout">${r.url ? (/\.(mp4|webm)(\?|$)/i.test(r.url) || W.kind === 'video' || W.kind === 'ugc' || W.kind === 'dub' ? `<video src="${esc(r.url)}" controls playsinline muted></video>` : /\.(mp3|wav)(\?|$)/i.test(r.url) || W.kind === 'voice' || W.kind === 'music' ? `<audio src="${esc(r.url)}" controls style="width:100%"></audio>` : `<img src="${esc(r.url)}" alt="Result">`) : ''}${r.text ? `<div class="codeblock">${esc(String(r.text).slice(0, 1200))}</div>` : ''}</div>` : ''}`;
    };
    $('#dry', p).onclick = (e) => run('dry', e.currentTarget);
    $('#live', p).onclick = (e) => modal({ title: 'Run it for real?', body: '<p>Vooads calls the API once with the sample prompt. It may cost you a little (one image, a few seconds of video or one text call).</p>', ok: 'Run now', onOk: () => { run('live', e.currentTarget); } });
    $('#b3', p).onclick = () => { grab(); W.step = 1; paint(); };
    $('#n3', p).onclick = () => { grab(); if (!(Number(W.cost) >= 0) || W.cost === '') return toast('Enter what one unit costs you.', true); next(); };
    if (W.test) run('dry');
  }
  function m4(p) {
    const lvTypes = meta.level_types.filter((t) => t.kind === W.kind);
    const u = W.use;
    p.innerHTML = `<h3>Where should it be used?</h3><div class="rcards" id="um" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      ${[['default', 'Main model', `Every ${meta.kinds[W.kind].label.toLowerCase()} job uses it first.`], ['fallback', 'Backup', 'Used when the main model fails.'], ...(lvTypes.length ? [['level', 'A quality level', 'e.g. the Ultra cinematic model of a video type.']] : []), ['off', 'Save switched off', 'Set it up now, use it later. AI tools can still pick it.']].map(([k, t, h]) => `<button type="button" class="rcard ${u.mode === k ? 'on' : ''}" data-u="${k}"><b><i></i>${t}</b><span>${h}</span></button>`).join('')}</div>
      <div id="ulv" ${u.mode === 'level' ? '' : 'hidden'}><div class="fields"><div class="fld"><label>Video type</label><select class="inp sm" id="ut">${lvTypes.map((t) => `<option value="${esc(t.id)}" ${u.video_type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div class="fld"><label>Quality level</label><select class="inp sm" id="ul"></select></div>
        <div class="fld full"><label class="chk"><input type="checkbox" id="umain" ${u.make_main !== false ? 'checked' : ''}><span>Make it the main model of this level (customers see its name)</span></label></div></div></div>
      <div class="hl">${ico('guard').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-3px;margin-right:4px"')}When you save, the profit guard re-checks every price that can use this model and raises any that would fall under your minimum margin.</div>
      <div id="ures"></div>
      <div class="wz-foot"><button class="btn ghost sm" id="b4">Back</button><button class="btn brand sm" id="usave">Save model ${ARR()}</button></div>`;
    const fillLv = () => { const t = lvTypes.find((x) => x.id === $('#ut', p)?.value) || lvTypes[0]; if (!t || !$('#ul', p)) return; $('#ul', p).innerHTML = t.levels.map((l) => `<option value="${l.id}" ${u.level === l.id ? 'selected' : ''}>${esc(l.name)}${l.model_label ? ' · now ' + esc(l.model_label) : ''}</option>`).join(''); };
    fillLv(); $('#ut', p) && ($('#ut', p).onchange = fillLv);
    $$('[data-u]', p).forEach((b) => b.onclick = () => { u.mode = b.dataset.u; $$('[data-u]', p).forEach((x) => x.classList.toggle('on', x === b)); $('#ulv', p).hidden = u.mode !== 'level'; });
    $('#b4', p).onclick = () => { W.step = 2; paint(); };
    $('#usave', p).onclick = async (e) => {
      const use = { mode: u.mode, ...(u.mode === 'level' ? { video_type: $('#ut', p).value, level: $('#ul', p).value, make_main: $('#umain', p).checked } : {}) };
      const x = await act(e.currentTarget, () => POST('/api/admin/ai-models', { ...body(), use }), 'Model saved');
      if (!x) return;
      $('#ures', p).innerHTML = `<div class="note brand"><b>Saved.</b> ${x.raised.length ? 'The profit guard raised: ' + x.raised.map((r) => `${esc(r.type_name)} · ${esc(r.level_name)} from ${r.from} to ${r.to} credits/s`).join('; ') + '.' : 'All prices stay above your minimum margin.'}${x.tools_below.length ? ' AI tools below the minimum now (they are raised when saved, and every run is charged at least the minimum): ' + x.tools_below.map((t) => esc(t.name)).join(', ') + '.' : ''}</div>`;
      $('#usave', p).textContent = 'Done'; $('#usave', p).onclick = () => { closeDrawer(); route(); };
      try { S.me = await GET('/api/admin/me'); } catch {}
    };
  }
  paint();
}

// ================================================================ AI tools builder
const STAT_TXT = { draft: 'Draft', testing: 'Testing', live: 'Live', paused: 'Paused' };
const tstat = (s) => `<span class="tstat ${esc(s)}">${esc(STAT_TXT[s] || s)}</span>`;
const STARTERS = [
  { name: 'Caption writer', icon: 'pen', description: 'Five scroll-stopping captions for any product.', kind: 'text', output: 'list', credits: 3, fields: [{ key: 'product', type: 'text', label: 'Product', placeholder: 'Vitamin C serum', required: true }, { key: 'tone', type: 'choice', label: 'Tone', options: ['Fun', 'Calm', 'Bold'], required: true }], prompt_template: 'Write 5 short social media captions for {{product}} in a {{tone}} tone. One per line, no numbering, no hashtags.' },
  { name: 'Product photo', icon: 'camera', description: 'A clean lifestyle photo of your product.', kind: 'image', output: 'image', credits: 8, aspect: '4:5', fields: [{ key: 'product', type: 'text', label: 'Product', required: true }, { key: 'scene', type: 'choice', label: 'Scene', options: ['Bathroom shelf', 'Kitchen table', 'City street', 'Studio white'], required: true }], prompt_template: 'Bright, realistic lifestyle photo of {{product}}, {{scene}}, soft natural light, shot on a phone, no text.' },
  { name: 'Voiceover', icon: 'mic', description: 'Turns a line of text into a natural voiceover.', kind: 'voice', output: 'audio', credits: 20, seconds: 15, fields: [{ key: 'line', type: 'longtext', label: 'What should it say?', max: 300, required: true }], prompt_template: '{{line}}' },
];
VIEWS.features = async (el, acts) => {
  const sub = (location.hash.match(/^#\/features\/(\d+|new)/) || [])[1];
  if (sub) return toolBuilder(el, acts, sub === 'new' ? null : Number(sub));
  const r = await GET('/api/admin/features');
  if (can('features.manage')) { acts.innerHTML = `<button class="btn brand sm" id="nt">${ico('plus')} New AI tool</button>`; $('#nt').onclick = () => go('#/features/new'); }
  const f = r.features;
  el.innerHTML = `<div class="stack">
    <div class="card pad"><div class="flow"><span>How it works:</span><span class="chip">Draft</span><span>→</span><span class="chip">Testing (staff and testers only)</span><span>→</span><span class="chip b">Live</span><span>→</span><span class="chip">Paused</span></div><p class="hint" style="margin-top:8px">Every save makes a new version. Customers keep using the live version until you press Publish.</p></div>
    ${f.length ? `<div class="tcards">${f.map((t, i) => `<button class="card tcard" data-id="${t.id}" style="--i:${i}"><div class="top"><span class="ticon">${TI.svg(t.icon, 21)}</span><div class="grow" style="min-width:0"><h4>${esc(t.name || 'Untitled')}</h4><div class="row" style="gap:6px;margin-top:4px">${tstat(t.status)}${t.draft && t.live ? '<span class="pill warn">Unpublished changes</span>' : ''}</div></div></div><p>${esc(t.description || '')}</p>
      <div class="row between hint"><span>${esc(r.meta.kinds[t.kind] || t.kind)} → ${esc(r.meta.output_labels[t.output] || t.output)}</span><span>${int((t.live || t.draft)?.price?.credits)} credits · ${int(t.runs)} runs</span></div></button>`).join('')}</div>`
      : `<div class="card">${emptyCard('No AI tools yet', 'Start from a template or a blank tool. Customers see live tools in the studio under "More tools".')}${can('features.manage') ? `<div class="card-b"><div class="picks">${STARTERS.map((s, i) => `<button type="button" class="pick" data-start="${i}"><span class="pi">${TI.svg(s.icon, 19)}</span><b>${esc(s.name)}</b><small>${esc(s.description)}</small></button>`).join('')}<button type="button" class="pick" data-start="blank"><span class="pi" style="background:var(--soft);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2)">${ico('plus')}</span><b>Blank tool</b><small>Start from nothing.</small></button></div></div>` : ''}</div>`}
  </div>`;
  $$('[data-id]', el).forEach((b) => b.onclick = () => go('#/features/' + b.dataset.id));
  $$('[data-start]', el).forEach((b) => b.onclick = () => { S.toolStarter = b.dataset.start === 'blank' ? null : STARTERS[Number(b.dataset.start)]; go('#/features/new'); });
};
const blankDef = () => ({ name: '', icon: 'spark', description: '', kind: 'text', output: 'text', credits: 5, seconds: null, aspect: '9:16', min_plan: null, provider_id: null, system: '', fields: [{ key: 'product', type: 'text', label: 'Product', placeholder: '', required: true, max: 120 }], prompt_template: '' });
const keyOf = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 30) || 'field';
async function toolBuilder(el, acts, id) {
  $('.phead', el.parentElement)?.setAttribute('hidden', '');
  acts.innerHTML = '';
  const manage = can('features.manage');
  const r = id ? await GET('/api/admin/features/' + id) : await GET('/api/admin/features');
  const meta = r.meta;
  let F = id ? r.feature : null;
  let def = clone(F ? (F.draft || F.live).def : (S.toolStarter ? { ...blankDef(), ...S.toolStarter } : blankDef()));
  S.toolStarter = null;
  let price = F ? (F.draft || F.live).price : null;
  let dirty = !id, tryRes = null;
  const provs = (k) => meta.providers.filter((p) => p.kind === k);
  const render = () => {
    el.innerHTML = `<a class="backl" href="#/features">${ico('back')} All AI tools</a>
    <div class="row between" style="margin-bottom:14px;gap:12px"><div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0"><span class="ticon" id="hic">${TI.svg(def.icon, 22)}</span><div style="min-width:0"><h1 style="font-size:clamp(24px,3vw,32px);letter-spacing:-.05em;line-height:1.05" id="hnm">${esc(def.name || 'New AI tool')}</h1><div class="row" style="gap:6px;margin-top:6px">${F ? tstat(F.status) : '<span class="tstat">Not saved</span>'}${F?.live ? `<span class="pill plain">Live: v${F.live.version}</span>` : ''}${F?.draft ? `<span class="pill warn">Draft: v${F.draft.version}</span>` : ''}</div></div></div>${F ? `<button class="btn ghost sm" id="hist">${ico('history')} History</button>` : ''}</div>
    <div class="tb"><div class="stack" style="gap:14px">
      <div class="card tb-sec"><h3><span class="n">1</span>Basics</h3>
        <div class="fields"><div class="fld"><label>Name customers see</label><input class="inp sm" data-d="name" maxlength="60" value="${esc(def.name)}" placeholder="e.g. Caption writer"></div><div class="fld"><label>One-line description</label><input class="inp sm" data-d="description" maxlength="300" value="${esc(def.description)}" placeholder="What it does, in one line"></div></div>
        <div class="fld"><label>Icon</label><div class="icgrid">${meta.icons.map((n) => `<button type="button" data-ic="${n}" class="${def.icon === n ? 'on' : ''}" title="${n}" aria-label="${n}">${TI.svg(n, 18)}</button>`).join('')}</div></div></div>
      <div class="card tb-sec"><h3><span class="n">2</span>What customers fill in</h3><div id="flds" style="display:grid;gap:10px"></div><div><button class="btn ghost sm" id="addf" ${def.fields.length >= 10 ? 'disabled' : ''}>${ico('plus')} Add a field</button></div></div>
      <div class="card tb-sec"><h3><span class="n">3</span>The prompt</h3>
        <div class="fld"><label>Prompt sent to the AI</label><div class="chipins" id="pchips">${def.fields.map((f) => `<button type="button" data-tok="${esc(f.key)}">{{${esc(f.key)}}}</button>`).join('')}<button type="button" data-tok="brand">{{brand}}</button></div><textarea class="inp sm" data-d="prompt_template" rows="5" placeholder="Write 5 captions for {{product}} in a {{tone}} tone." style="margin-top:6px">${esc(def.prompt_template)}</textarea><small>Tap a field to put it where the cursor is. What customers type is inserted as plain text, never run as code.</small></div>
        ${def.kind === 'text' ? `<details ${def.system ? 'open' : ''}><summary class="hint" style="cursor:pointer;font-weight:700">Instructions for the AI (optional)</summary><textarea class="inp sm" data-d="system" rows="3" style="margin-top:8px" placeholder="You write short, honest ad copy.">${esc(def.system || '')}</textarea></details>` : ''}</div>
      <div class="card tb-sec"><h3><span class="n">4</span>The AI</h3>
        <div class="fld"><label>It makes</label>${seg('kk', Object.entries(meta.kinds).map(([k, l]) => [k, l]), def.kind, 'sm')}</div>
        <div class="fields"><div class="fld"><label>Customers get</label><select class="inp sm" data-d="output">${(meta.outputs[def.kind] || []).map((o) => `<option value="${o}" ${def.output === o ? 'selected' : ''}>${esc(meta.output_labels[o] || o)}</option>`).join('')}</select></div>
          <div class="fld"><label>Model</label><select class="inp sm" data-d="provider_id"><option value="">Best available (default ${esc(def.kind)} model)</option>${provs(def.kind).map((p) => `<option value="${p.id}" ${Number(def.provider_id) === p.id ? 'selected' : ''}>${esc(p.name)}${p.cost_usd ? ' · $' + p.cost_usd + ' ' + esc(p.cost_unit || '') : ''}${p.enabled ? '' : ' (off)'}</option>`).join('')}</select></div>
          ${['video', 'voice', 'music'].includes(def.kind) ? `<div class="fld"><label>Length (seconds)</label><input class="inp sm" type="number" min="1" max="60" data-d="seconds" value="${esc(def.seconds || (def.kind === 'video' ? 5 : 15))}"></div>` : ''}
          ${['video', 'image'].includes(def.kind) ? `<div class="fld"><label>Shape</label><select class="inp sm" data-d="aspect">${['9:16', '1:1', '4:5', '16:9'].map((a) => `<option ${def.aspect === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>` : ''}</div></div>
      <div class="card tb-sec"><h3><span class="n">5</span>Price</h3>
        <div class="fields"><div class="fld"><label>Credits per run</label><input class="inp sm" type="number" min="1" data-d="credits" value="${esc(def.credits)}"></div><div class="fld"><label>Lowest plan</label><select class="inp sm" data-d="min_plan"><option value="">Everyone (trial too${['video', 'voice', 'music'].includes(def.kind) ? ', with paid credits' : ''})</option>${meta.plans.map((p) => `<option value="${esc(p.id)}" ${def.min_plan === p.id ? 'selected' : ''}>${esc(p.name)} and up</option>`).join('')}</select></div></div>
        <div class="pricebox" id="pbox"></div><p class="hint" id="pnote"></p></div>
    </div>
    <div><div class="phone"><div class="scr" id="pv"></div><div class="ph-cap">LIVE PREVIEW · STUDIO</div></div>
      ${F ? `<div class="card tb-sec" style="margin-top:14px"><h3>${ico('bolt').replace('<svg', '<svg style="width:17px;height:17px"')} Try it</h3><p class="hint" style="margin-top:-8px">Runs the ${F.draft ? 'draft' : 'live'} version right now, no credits. Demo models answer with samples.</p><button class="btn brand sm" id="tryb" ${dirty ? 'disabled title="Save first"' : ''}>Run it ${ARR()}</button><div id="tryo"></div></div>` : ''}</div></div>
    ${manage ? `<div class="tb-bar"><span class="grow hint" id="bnote">${dirty ? 'Unsaved changes' : F?.draft ? 'Draft saved. Publish to put it live.' : 'All saved.'}</span>
      ${F && F.status !== 'testing' && F.status !== 'live' ? `<button class="btn ghost sm" id="btest">${ico('eye')} Send to testing</button>` : ''}${F && F.status === 'testing' ? `<button class="btn ghost sm" id="btesters">${ico('userplus')} Testers (${F.allowlist.length})</button>` : ''}
      ${F && F.status === 'live' ? `<button class="btn ghost sm" id="bpause">Pause</button>` : ''}${F && F.status === 'paused' && F.live ? `<button class="btn ghost sm" id="bresume">Resume</button>` : ''}
      <button class="btn ${F && !dirty && F.draft ? 'ghost' : 'brand'} sm" id="bsave">${F ? 'Save draft' : 'Create draft'}</button>${F ? `<button class="btn ${!dirty && F.draft ? 'accent' : 'ghost'} sm" id="bpub" ${F.draft && !dirty ? '' : 'disabled'}>${ico('send')} Publish</button>` : ''}</div>` : ''}`;
    wire(); drawFields(); preview(); priceUpd();
  };
  const markDirty = () => { dirty = true; const n = $('#bnote'); if (n) n.textContent = 'Unsaved changes'; const p = $('#bpub'); if (p) p.disabled = true; const t = $('#tryb'); if (t) { t.disabled = true; t.title = 'Save first'; } const s = $('#bsave'); if (s) s.className = 'btn brand sm'; };
  const wire = () => {
    $$('[data-d]', el).forEach((i) => i.addEventListener('input', () => { const k = i.dataset.d; def[k] = ['credits', 'seconds'].includes(k) ? Number(i.value) || 0 : k === 'provider_id' ? (i.value ? Number(i.value) : null) : k === 'min_plan' ? i.value || null : i.value; if (k === 'name') $('#hnm').textContent = def.name || 'New AI tool'; markDirty(); preview(); if (['credits', 'seconds', 'provider_id', 'output', 'prompt_template'].includes(k)) priceUpd(); }));
    $$('[data-ic]', el).forEach((b) => b.onclick = () => { def.icon = b.dataset.ic; $$('[data-ic]', el).forEach((x) => x.classList.toggle('on', x === b)); $('#hic').innerHTML = TI.svg(def.icon, 22); markDirty(); preview(); });
    segWire(el, 'kk', (k) => { def.kind = k; def.output = meta.outputs[k][0]; def.provider_id = null; if (['video', 'voice', 'music'].includes(k) && !def.seconds) def.seconds = k === 'video' ? 5 : 15; markDirty(); render(); });
    $('#addf') && ($('#addf').onclick = () => { const n = def.fields.length + 1; def.fields.push({ key: 'field_' + n, type: 'text', label: 'Field ' + n, required: true, max: 120 }); markDirty(); render(); setTimeout(() => $$('[data-fl]', el).pop()?.select(), 40); });
    $$('#pchips [data-tok]', el).forEach((b) => b.onclick = () => { const ta = $('[data-d="prompt_template"]', el); const tok = '{{' + b.dataset.tok + '}}'; const a = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, a) + tok + ta.value.slice(ta.selectionEnd ?? a); ta.dispatchEvent(new Event('input')); ta.focus(); ta.selectionStart = ta.selectionEnd = a + tok.length; });
    $('#hist') && ($('#hist').onclick = history2);
    $('#bsave') && ($('#bsave').onclick = save);
    $('#bpub') && ($('#bpub').onclick = () => modal({ title: 'Publish v' + F.draft.version + '?', body: `<p>Customers get this version in the studio right away. People already running the tool finish on the old version.</p>${F.status === 'testing' ? '<p class="hint">Testers stop seeing the draft; everyone sees the live tool.</p>' : ''}`, ok: 'Publish', okClass: 'accent', onOk: async (w, btn) => { const x = await act(btn, () => POST(`/api/admin/features/${F.id}/publish`), 'Published. It is live in the studio.'); if (!x) return false; F = x.feature; dirty = false; render(); } }));
    $('#btest') && ($('#btest').onclick = () => testers(true));
    $('#btesters') && ($('#btesters').onclick = () => testers(false));
    $('#bpause') && ($('#bpause').onclick = () => setStatus('paused', 'Paused. Customers no longer see it.'));
    $('#bresume') && ($('#bresume').onclick = () => setStatus('live', 'Live again'));
    $('#tryb') && ($('#tryb').onclick = tryIt);
  };
  const setStatus = async (status, msg) => { const x = await act(null, () => POST(`/api/admin/features/${F.id}/status`, { status }), msg); if (x) { F = x.feature; render(); } };
  const testers = (andStatus) => modal({ title: 'Testers', body: `<p>Testing tools are only visible to staff (in <b>Try it</b>) and to these customer emails in the studio.</p><div class="fld"><label>Customer emails</label><textarea class="inp" id="tem" rows="4" placeholder="one@example.com, two@example.com">${esc((F.allowlist || []).join(', '))}</textarea></div>`, ok: andStatus ? 'Start testing' : 'Save testers',
    onOk: async (w, btn) => { const x = await act(btn, async () => { await PUT(`/api/admin/features/${F.id}/testers`, { emails: $('#tem', w).value }); return andStatus ? POST(`/api/admin/features/${F.id}/status`, { status: 'testing' }) : GET('/api/admin/features/' + F.id); }, andStatus ? 'Testing: only testers and staff see it' : 'Testers saved'); if (!x) return false; F = x.feature; render(); } });
  const save = async (e) => {
    const x = await act(e?.currentTarget, () => F ? PUT('/api/admin/features/' + F.id, { def }) : POST('/api/admin/features', { def }));
    if (!x) return;
    if (x.raised) toast(`Price raised from ${x.raised.from} to ${x.raised.to} credits so it never runs at a loss.`); else toast(F ? 'Saved as v' + x.feature.draft.version : 'Draft created');
    const wasNew = !F;
    F = x.feature; def = clone(F.draft.def); price = F.draft.price; dirty = false;
    if (wasNew) { try { history.replaceState(null, '', '#/features/' + F.id); } catch {} }
    render();
  };
  const drawFields = () => {
    const box = $('#flds', el); if (!box) return;
    box.innerHTML = def.fields.map((f, i) => `<div class="fldc" data-i="${i}"><div class="fh"><span class="pill plain">${esc(meta.field_types[f.type] || f.type)}</span><b>${esc(f.label || f.key)}</b><span class="hint">{{${esc(f.key)}}}</span>
        <button class="iconbtn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up" style="transform:rotate(90deg)">${ico('back')}</button><button class="iconbtn" data-rm="${i}" ${def.fields.length > 1 ? '' : 'disabled'} aria-label="Remove field">${ico('trash')}</button></div>
      <div class="fgrid"><div class="fld"><label>Label</label><input class="inp sm" data-fl="${i}" value="${esc(f.label)}"></div><div class="fld"><label>Type</label><select class="inp sm" data-ft="${i}">${Object.entries(meta.field_types).map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="fld"><label>Required</label><label class="swl" style="margin-top:6px">${sw(f.required !== false, `data-fr="${i}"`)}<span>${f.required !== false ? 'Yes' : 'No'}</span></label></div>
        ${f.type === 'choice' ? `<div class="fld" style="grid-column:1/-1"><label>Choices (one per line)</label><textarea class="inp sm" rows="3" data-fo="${i}">${esc((f.options || []).join('\n'))}</textarea></div>` : ''}
        ${f.type === 'number' ? `<div class="fld"><label>Smallest</label><input class="inp sm" type="number" data-fmin="${i}" value="${esc(f.min ?? 0)}"></div><div class="fld"><label>Largest</label><input class="inp sm" type="number" data-fmax="${i}" value="${esc(f.max ?? 100)}"></div>` : ''}
        ${f.type === 'text' || f.type === 'longtext' ? `<div class="fld"><label>Max characters</label><input class="inp sm" type="number" min="1" data-fmx="${i}" value="${esc(f.max || (f.type === 'text' ? 120 : 1200))}"></div>` : ''}
        ${f.type !== 'image' && f.type !== 'choice' ? `<div class="fld" style="grid-column:span 2"><label>Example (placeholder)</label><input class="inp sm" data-fp="${i}" value="${esc(f.placeholder || '')}"></div>` : ''}</div></div>`).join('');
    const upd = () => { markDirty(); preview(); };
    $$('[data-fl]', box).forEach((x) => x.oninput = () => { const f = def.fields[Number(x.dataset.fl)]; const oldKey = f.key; f.label = x.value; const nk = keyOf(x.value); if (!def.fields.some((y, j) => j !== Number(x.dataset.fl) && y.key === nk)) { f.key = nk; if (oldKey !== nk) def.prompt_template = String(def.prompt_template).split('{{' + oldKey + '}}').join('{{' + nk + '}}'); } $('b', x.closest('.fldc')).textContent = f.label || f.key; $('.fh .hint', x.closest('.fldc')).textContent = '{{' + f.key + '}}'; const ta = $('[data-d="prompt_template"]', el); if (ta && ta.value !== def.prompt_template) ta.value = def.prompt_template; $('#pchips', el).innerHTML = def.fields.map((y) => `<button type="button" data-tok="${esc(y.key)}">{{${esc(y.key)}}}</button>`).join('') + '<button type="button" data-tok="brand">{{brand}}</button>'; wireChips(); upd(); });
    $$('[data-ft]', box).forEach((x) => x.onchange = () => { const f = def.fields[Number(x.dataset.ft)]; f.type = x.value; if (f.type === 'choice' && !f.options) f.options = ['Option 1', 'Option 2']; if (f.type === 'number') { f.min = f.min ?? 0; f.max = 100; } if (f.type === 'text') f.max = 120; if (f.type === 'longtext') f.max = 1200; markDirty(); drawFields(); preview(); });
    $$('[data-fr]', box).forEach((x) => x.onclick = () => { const f = def.fields[Number(x.dataset.fr)]; f.required = swToggle(x); x.nextElementSibling.textContent = f.required ? 'Yes' : 'No'; upd(); });
    $$('[data-fo]', box).forEach((x) => x.oninput = () => { def.fields[Number(x.dataset.fo)].options = x.value.split('\n').map((s) => s.trim()).filter(Boolean); upd(); });
    $$('[data-fmin]', box).forEach((x) => x.oninput = () => { def.fields[Number(x.dataset.fmin)].min = Number(x.value); upd(); });
    $$('[data-fmax]', box).forEach((x) => x.oninput = () => { def.fields[Number(x.dataset.fmax)].max = Number(x.value); upd(); });
    $$('[data-fmx]', box).forEach((x) => x.oninput = () => { def.fields[Number(x.dataset.fmx)].max = Number(x.value); upd(); priceUpd(); });
    $$('[data-fp]', box).forEach((x) => x.oninput = () => { def.fields[Number(x.dataset.fp)].placeholder = x.value; upd(); });
    $$('[data-rm]', box).forEach((x) => x.onclick = () => { def.fields.splice(Number(x.dataset.rm), 1); markDirty(); render(); });
    $$('[data-up]', box).forEach((x) => x.onclick = () => { const i = Number(x.dataset.up); [def.fields[i - 1], def.fields[i]] = [def.fields[i], def.fields[i - 1]]; markDirty(); render(); });
  };
  const wireChips = () => $$('#pchips [data-tok]', el).forEach((b) => b.onclick = () => { const ta = $('[data-d="prompt_template"]', el); const tok = '{{' + b.dataset.tok + '}}'; const a = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, a) + tok + ta.value.slice(ta.selectionEnd ?? a); ta.dispatchEvent(new Event('input')); ta.focus(); ta.selectionStart = ta.selectionEnd = a + tok.length; });
  const preview = () => {
    const pv = $('#pv', el); if (!pv) return;
    const shown = price ? Math.max(def.credits, price.min_credits) : def.credits;
    pv.innerHTML = `<div class="ph-h"><span class="ticon" style="width:38px;height:38px;border-radius:12px">${TI.svg(def.icon, 18)}</span><div style="min-width:0"><b>${esc(def.name || 'Your tool')}</b><small>${esc(def.description || 'One-line description')}</small></div></div>
      ${def.fields.map((f) => `<div class="fld"><label>${esc(f.label || f.key)}${f.required !== false ? '' : ' <span class="hint">(optional)</span>'}</label>${f.type === 'longtext' ? `<textarea class="inp sm" rows="3" placeholder="${esc(f.placeholder || '')}" data-tv="${esc(f.key)}"></textarea>` : f.type === 'choice' ? `<select class="inp sm" data-tv="${esc(f.key)}">${(f.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : f.type === 'image' ? `<div class="drop" style="padding:16px">${ico('upload')}<span>Upload a photo</span></div>` : `<input class="inp sm" ${f.type === 'number' ? `type="number" min="${esc(f.min ?? 0)}" max="${esc(f.max ?? 100)}"` : ''} placeholder="${esc(f.placeholder || '')}" data-tv="${esc(f.key)}">`}</div>`).join('')}
      <button class="btn brand block" type="button" tabindex="-1">Run · ${int(shown)} credits ${ARR()}</button>`;
  };
  const priceUpd = debounce(async () => {
    const box = $('#pbox', el); if (!box) return;
    if (!String(def.name || '').trim() || !String(def.prompt_template || '').trim()) { box.innerHTML = ''; $('#pnote', el).textContent = 'Add a name and a prompt to see the cost and the lowest safe price.'; return; }
    try { price = await POST('/api/admin/features/price', { def }); } catch (e) { $('#pnote', el).textContent = e.message; box.innerHTML = ''; return; }
    const low = def.credits < price.min_credits;
    box.innerHTML = `<div><span>Cost per run</span><b>${usd(price.cost_usd, price.cost_usd < 1 ? 3 : 2)}</b></div><div><span>Guard minimum</span><b>${int(price.min_credits)} cr</b></div><div><span>Margin at your price</span><b class="margin ${price.margin_pct >= 60 ? 'good' : 'bad'}">${Math.round(price.margin_pct)}%</b></div>`;
    $('#pnote', el).innerHTML = (low ? `<span style="color:var(--bad);font-weight:700">Below the minimum: it is raised to ${int(price.min_credits)} credits when you save.</span> ` : '') + (price.provider ? `Priced on ${esc(price.provider.name)}${price.provider.cost_usd ? ' ($' + price.provider.cost_usd + ' ' + esc(price.provider.cost_unit || '') + ')' : ''}.` : 'No model with a cost yet: priced on the default figures.');
    preview();
  }, 300);
  const tryIt = async (e) => {
    const inputs = {};
    $$('[data-tv]', el).forEach((i) => { inputs[i.dataset.tv] = i.value; });
    for (const f of def.fields) if (f.type === 'image') inputs[f.key] = '/samples/creator-3.webp';
    for (const f of def.fields) if (!inputs[f.key] && f.type !== 'image') inputs[f.key] = f.type === 'choice' ? (f.options || [])[0] : f.type === 'number' ? (f.min ?? 1) : (f.placeholder || 'Vitamin C serum');
    $('#tryo', el).innerHTML = '<div class="indet" style="margin-top:12px"><i></i></div>';
    const x = await act(e.currentTarget, () => POST(`/api/admin/features/${F.id}/try`, { inputs }));
    if (!x) { $('#tryo', el).innerHTML = ''; return; }
    tryRes = x;
    const o = x.output;
    $('#tryo', el).innerHTML = `<div class="tryout" style="margin-top:12px"><div class="row" style="gap:6px">${x.provider.demo ? '<span class="pill warn">Demo sample</span>' : `<span class="pill good">${esc(x.provider.name)}</span>`}<span class="pill plain">${(x.ms / 1000).toFixed(1)}s</span></div>
      ${o.items ? `<ol>${o.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : o.text ? `<div class="rb-sum" style="white-space:pre-wrap">${esc(o.text)}</div>` : o.url ? (def.output === 'video' ? `<video src="${esc(o.url)}" controls muted playsinline></video>` : def.output === 'audio' ? `<audio src="${esc(o.url)}" controls style="width:100%"></audio>` : `<img src="${esc(o.url)}" alt="Result">`) : ''}
      <details><summary class="hint" style="cursor:pointer;font-weight:700">Prompt that was sent</summary><div class="codeblock" style="margin-top:6px">${esc(x.prompt)}</div></details></div>`;
  };
  const history2 = async () => {
    const x = await act(null, () => GET('/api/admin/features/' + F.id));
    if (!x) return;
    const dd = openDrawer({ title: 'Version history', sub: esc(x.feature.name) + ' · every save is kept', body: `<div class="list vh">${x.feature.versions.map((v) => `<div class="li"><div class="m"><b>v${v.version} ${v.live ? '<span class="pill good">Live</span>' : ''}${v.draft ? '<span class="pill warn">Draft</span>' : ''}${v.published_at && !v.live ? '<span class="pill plain">Was live</span>' : ''}</b><small>${esc(v.note || '')} · ${esc(v.by_name || v.by_email || 'Staff')} · ${fdate(v.created_at)}</small></div>${manage && !v.draft ? `<button class="btn ghost xs" data-rs="${v.id}">Restore as draft</button>` : ''}</div>`).join('')}</div>` });
    $$('[data-rs]', dd).forEach((b) => b.onclick = async () => { const y = await act(b, () => POST(`/api/admin/features/${F.id}/restore`, { version_id: Number(b.dataset.rs) }), 'Restored as a new draft'); if (y) { closeDrawer(); F = y.feature; def = clone(F.draft.def); dirty = false; render(); } });
  };
  render();
  void tryRes;
}
});
})();
