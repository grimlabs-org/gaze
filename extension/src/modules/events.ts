import type { EventsData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

export async function observeEvents(
  bridge: CdpBridge,
  _url: string
): Promise<EventsData> {
  const [domEvents, customEvents, postMessageOrigins, formSubmitHandlers] =
    await Promise.all([
      bridge.evaluate<EventsData["domEvents"]>(`
        (() => {
          const results = [];
          const elements = document.querySelectorAll('*');
          const eventTypes = [
            'click','submit','change','input','keydown','keyup',
            'mousedown','mouseup','focus','blur','load','error',
            'touchstart','touchend',
          ];
          elements.forEach(el => {
            eventTypes.forEach(type => {
              const attr = el.getAttribute('on' + type);
              if (attr) {
                results.push({
                  type,
                  target: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
                  listenerSource: attr.slice(0, 200),
                });
              }
            });
          });
          return results.slice(0, 50);
        })()
      `),
      bridge.evaluate<string[]>(`
        (() => {
          // Capture custom event names dispatched via dispatchEvent
          const original = EventTarget.prototype.dispatchEvent;
          const seen = new Set();
          // Just check what's already been dispatched — we can't retroactively capture
          // Instead look for CustomEvent constructors in scripts
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          const customEventRe = /new CustomEvent\\(['"\`]([^'"\`]+)['"\`]/g;
          scripts.forEach(s => {
            let m;
            customEventRe.lastIndex = 0;
            while ((m = customEventRe.exec(s.textContent || '')) !== null) {
              seen.add(m[1]);
            }
          });
          return [...seen].slice(0, 30);
        })()
      `),
      bridge.evaluate<string[]>(`
        (() => {
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          const re = /addEventListener\\(['"\`]message['"\`][^)]+event\\.origin[^)]*===?\\s*['"\`]([^'"\`]+)['"\`]/g;
          const origins = new Set();
          scripts.forEach(s => {
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(s.textContent || '')) !== null) {
              origins.add(m[1]);
            }
          });
          return [...origins].slice(0, 20);
        })()
      `),
      bridge.evaluate<EventsData["formSubmitHandlers"]>(`
        (() => {
          return Array.from(document.querySelectorAll('form')).map(form => ({
            formId: form.id || form.name || '',
            action: form.action || '',
            handler: form.getAttribute('onsubmit') || '',
          })).slice(0, 20);
        })()
      `),
    ]);

  return { domEvents, customEvents, postMessageOrigins, formSubmitHandlers };
}
