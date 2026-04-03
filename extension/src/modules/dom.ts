import type { DomData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

export async function observeDom(bridge: CdpBridge, _url: string): Promise<DomData> {
  const [forms, iframes, handlers, scripts, comments, metas, links] = await Promise.all([
    bridge.evaluate<DomData["forms"]>(`
      Array.from(document.querySelectorAll('form')).map(f => ({
        action: f.action || '',
        method: f.method || 'get',
        enctype: f.enctype || '',
        fields: Array.from(f.elements).map(el => {
          const e = el;
          return {
            name: e.name || '',
            type: e.type || '',
            autocomplete: e.autocomplete || '',
            value: e.type === 'password' ? '[redacted]' : (e.value || undefined),
          };
        }),
      }))
    `),
    bridge.evaluate<DomData["iframes"]>(`
      Array.from(document.querySelectorAll('iframe')).map(f => ({
        src: f.src || '',
        sandbox: f.getAttribute('sandbox'),
        allow: f.getAttribute('allow'),
      }))
    `),
    bridge.evaluate<DomData["inlineHandlers"]>(`
      (() => {
        const events = ['onclick','onload','onerror','onsubmit','onmouseover','onfocus','onblur','onchange','oninput'];
        const results = [];
        document.querySelectorAll('*').forEach(el => {
          events.forEach(ev => {
            const val = el.getAttribute(ev);
            if (val) results.push({ element: el.tagName.toLowerCase(), event: ev, code: val.slice(0, 200) });
          });
        });
        return results;
      })()
    `),
    bridge.evaluate<DomData["scripts"]>(`
      Array.from(document.querySelectorAll('script')).map(s => ({
        src: s.src || null,
        inline: !s.src,
        integrity: s.getAttribute('integrity'),
        crossorigin: s.getAttribute('crossorigin'),
      }))
    `),
    bridge.evaluate<string[]>(`
      (() => {
        const comments = [];
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
        let node;
        while ((node = walker.nextNode())) comments.push(node.nodeValue?.trim() || '');
        return comments.filter(c => c.length > 0).slice(0, 50);
      })()
    `),
    bridge.evaluate<DomData["metaTags"]>(`
      Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
        content: m.getAttribute('content') || '',
      })).filter(m => m.name)
    `),
    bridge.evaluate<DomData["links"]>(`
      Array.from(document.querySelectorAll('link')).map(l => ({
        rel: l.rel || '',
        href: l.href || '',
      }))
    `),
  ]);

  return { forms, iframes, inlineHandlers: handlers, scripts, comments, metaTags: metas, links };
}
