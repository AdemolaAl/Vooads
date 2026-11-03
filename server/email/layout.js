// Branded HTML email. Table layout and inline styles so it holds up in Gmail, Outlook, Apple Mail and Yahoo.
// The top of every email is a studio-navy panel (logo, label and the animated header from designs.js). It is navy in
// light and dark mode alike, so the GIFs never sit on the wrong background. The body below is white, or deep navy in
// dark mode (Apple Mail, iOS, Outlook for Mac and Outlook.com via [data-ogsc]/[data-ogsb]).
// Outlook for Windows shows the first frame of each GIF; every GIF starts on a clean frame for that reason.
const { esc } = require('../lib/util');
const designs = require('./designs');

const { FONT, C } = designs;

module.exports = function layout({ preheader, heading, body, ctaLabel, ctaUrl, unsub, appUrl, legal, support, kind, vars = {}, assetBase }) {
  const base = assetBase || `${appUrl}/assets/img/email`;
  const asset = (f) => `${base}/${f}`;
  const d = designs.designFor(kind || '');
  const v = { app_url: appUrl, ...vars };
  const ctx = { ctaLabel, ctaUrl };
  const art = designs.renderArt(d, v, asset);
  const extra = designs.renderBlocks(d, v, ctx);
  const cta = !d.ownCta && ctaUrl ? `<div style="margin:6px 0 10px;">${designs.button(ctaLabel || 'Open Vooads', ctaUrl)}</div>` : '';
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(heading)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table, td, div, p, a, span, h1 { font-family: 'Segoe UI', Arial, sans-serif !important; }</style>
<![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
  u + #body a { color: inherit; text-decoration: none; }
  #MessageViewBody a { color: inherit; text-decoration: none; }
  .va-prose p { margin: 0 0 16px 0; }
  .va-prose ul, .va-prose ol { margin: 0 0 16px 0; padding-left: 22px; }
  .va-prose li { margin: 0 0 6px 0; }
  .va-prose a { color: ${C.blueText}; text-decoration: underline; }
  .va-prose blockquote { margin: 0 0 16px 0 !important; padding: 12px 16px !important; background: ${C.soft} !important; border-radius: 12px; }
  @media screen and (max-width: 620px) {
    .va-outer { padding: 10px 8px 28px 8px !important; }
    .va-px { padding-left: 22px !important; padding-right: 22px !important; }
    .va-art { padding: 16px 14px 16px 14px !important; }
    .va-h1 { font-size: 24px !important; line-height: 30px !important; }
    .va-btn-wrap { display: table !important; width: 100% !important; margin-right: 0 !important; }
    .va-btn-wrap td { display: block !important; width: 100% !important; }
    .va-btn-wrap a { display: block !important; text-align: center !important; }
  }
  @media screen and (max-width: 480px) {
    .va-stack { display: block !important; width: 100% !important; max-width: 100% !important; }
    .va-stack img { margin: 0 auto !important; }
    .va-stack-gap { padding: 14px 0 0 0 !important; }
  }
  @media (prefers-color-scheme: dark) {
    .va-bg { background-color: #05070D !important; }
    .va-card { background-color: #0F1424 !important; border-color: #1E2742 !important; }
    .va-t, .va-h1 { color: #F3F5FA !important; }
    .va-b, .va-prose { color: #C9D0E0 !important; }
    .va-m { color: #8A93A8 !important; }
    .va-soft { background-color: #151C33 !important; border-color: #26304F !important; }
    .va-line { border-color: #222B45 !important; }
    .va-prose a { color: ${C.blueSoft} !important; }
    .va-prose blockquote { background: #151C33 !important; }
    .va-btn2 { background-color: #151C33 !important; border-color: #33405F !important; }
    .va-btn2-a { color: #F3F5FA !important; }
    .va-foot, .va-foot a { color: #6F7890 !important; }
  }
  [data-ogsc] .va-t, [data-ogsc] .va-h1 { color: #F3F5FA !important; }
  [data-ogsc] .va-b, [data-ogsc] .va-prose { color: #C9D0E0 !important; }
  [data-ogsc] .va-m { color: #8A93A8 !important; }
  [data-ogsc] .va-btn2-a { color: #F3F5FA !important; }
  [data-ogsb] .va-bg { background-color: #05070D !important; }
  [data-ogsb] .va-card { background-color: #0F1424 !important; }
  [data-ogsb] .va-soft { background-color: #151C33 !important; }
  [data-ogsb] .va-btn2 { background-color: #151C33 !important; }
</style>
</head>
<body id="body" class="va-bg" style="margin:0;padding:0;width:100%;background-color:#EEF1F7;word-spacing:normal;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#EEF1F7;">${esc(preheader)}${'&#8202;&zwnj;&nbsp;'.repeat(24)}</div>
<table role="presentation" class="va-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF1F7" style="width:100%;background-color:#EEF1F7;">
<tr><td class="va-outer" align="center" style="padding:28px 14px 44px 14px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:600px;margin:0 auto;">
<tr><td class="va-card" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid ${C.line};border-radius:24px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="va-art" bgcolor="${C.navy}" style="background-color:${C.navy};border-radius:23px 23px 0 0;padding:20px 20px 20px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(appUrl)}" target="_blank" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="30" style="width:30px;font-size:0;line-height:0;"><img src="${esc(asset('mark.png'))}" width="30" height="30" alt="" style="display:block;width:30px;height:30px;border:0;border-radius:9px;"></td>
<td valign="middle" style="padding-left:9px;font-family:${FONT};font-size:20px;line-height:30px;font-weight:800;letter-spacing:-0.7px;color:#FFFFFF;"><span style="color:#FFFFFF;">Vooads</span></td>
</tr></table></a></td>
<td align="right" valign="middle" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${C.blueSoft};"><span style="color:${C.blueSoft};">${esc(d.label || '')}</span></td>
</tr></table>
${art}
</td></tr>
<tr><td class="va-px" style="padding:32px 36px 22px 36px;">
<h1 class="va-t va-h1" style="margin:0 0 14px 0;font-family:${FONT};font-size:27px;line-height:33px;font-weight:800;letter-spacing:-0.7px;color:${C.ink};">${esc(heading)}</h1>
<div class="va-b va-prose" style="font-family:${FONT};font-size:16px;line-height:26px;color:${C.body};">${body}</div>
${extra}${cta}
</td></tr>
</table>
</td></tr>
<tr><td class="va-foot" align="center" style="padding:22px 24px 0 24px;font-family:${FONT};font-size:12px;line-height:19px;color:#6B7389;">
<p class="va-foot" style="margin:0 0 8px 0;color:#6B7389;">Vooads · AI video ads, made fast. Questions? Reply to this email or write to <a href="mailto:${esc(support)}" class="va-foot" style="color:#6B7389;text-decoration:underline;">${esc(support)}</a>.</p>
<p class="va-foot" style="margin:0 0 8px 0;color:#6B7389;"><a href="${esc(appUrl)}/legal/terms" class="va-foot" style="color:#6B7389;text-decoration:underline;">Terms</a> &nbsp;·&nbsp; <a href="${esc(appUrl)}/legal/privacy" class="va-foot" style="color:#6B7389;text-decoration:underline;">Privacy</a>${unsub ? ` &nbsp;·&nbsp; <a href="${esc(unsub)}" class="va-foot" style="color:#6B7389;text-decoration:underline;">Unsubscribe</a>` : ''}</p>
${legal ? `<p class="va-foot va-legal" style="margin:0;font-size:11px;line-height:17px;color:#8A93A8;">&copy; ${year} ${esc(legal)}</p>` : ''}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
};
