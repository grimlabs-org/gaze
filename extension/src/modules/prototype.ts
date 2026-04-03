import type { PrototypeData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const OBJECT_PROTO_SPEC = new Set([
  "constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable",
  "toString","toLocaleString","valueOf","__defineGetter__","__defineSetter__",
  "__lookupGetter__","__lookupSetter__","__proto__",
]);

const ARRAY_PROTO_SPEC = new Set([
  "constructor","at","concat","copyWithin","entries","every","fill","filter",
  "find","findIndex","findLast","findLastIndex","flat","flatMap","forEach",
  "includes","indexOf","join","keys","lastIndexOf","map","pop","push",
  "reduce","reduceRight","reverse","shift","slice","some","sort","splice",
  "toLocaleString","toReversed","toSorted","toSpliced","toString","unshift",
  "values","with","length",
]);

const FUNCTION_PROTO_SPEC = new Set([
  "apply","bind","call","constructor","toString","length","name",
]);

export async function observePrototype(bridge: CdpBridge, _url: string): Promise<PrototypeData> {
  const [objectProto, arrayProto, functionProto] = await Promise.all([
    bridge.evaluate<PrototypeData["objectProto"]>(`
      (() => {
        try {
          return Object.getOwnPropertyNames(Object.prototype).map(k => {
            try {
              const desc = Object.getOwnPropertyDescriptor(Object.prototype, k);
              return {
                key: k,
                type: typeof Object.prototype[k],
                enumerable: desc ? desc.enumerable : false,
              };
            } catch { return { key: k, type: 'unknown', enumerable: false }; }
          });
        } catch { return []; }
      })()
    `),
    bridge.evaluate<PrototypeData["arrayProto"]>(`
      (() => {
        try {
          return Object.getOwnPropertyNames(Array.prototype).map(k => {
            try {
              const desc = Object.getOwnPropertyDescriptor(Array.prototype, k);
              return {
                key: k,
                type: typeof Array.prototype[k],
                enumerable: desc ? desc.enumerable : false,
              };
            } catch { return { key: k, type: 'unknown', enumerable: false }; }
          });
        } catch { return []; }
      })()
    `),
    bridge.evaluate<PrototypeData["functionProto"]>(`
      (() => {
        try {
          return Object.getOwnPropertyNames(Function.prototype)
            .filter(k => k !== 'caller' && k !== 'callee' && k !== 'arguments')
            .map(k => {
              try {
                const desc = Object.getOwnPropertyDescriptor(Function.prototype, k);
                return {
                  key: k,
                  type: typeof Function.prototype[k],
                  enumerable: desc ? desc.enumerable : false,
                };
              } catch { return { key: k, type: 'unknown', enumerable: false }; }
            });
        } catch { return []; }
      })()
    `),
  ]);

  const additions = [
    ...objectProto.filter(p => !OBJECT_PROTO_SPEC.has(p.key)).map(p => `Object.prototype.${p.key}`),
    ...arrayProto.filter(p => !ARRAY_PROTO_SPEC.has(p.key)).map(p => `Array.prototype.${p.key}`),
    ...functionProto.filter(p => !FUNCTION_PROTO_SPEC.has(p.key)).map(p => `Function.prototype.${p.key}`),
  ];

  return { objectProto, arrayProto, functionProto, additions };
}
