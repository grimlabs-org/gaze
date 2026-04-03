import type { PrototypeData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

// Spec-defined keys for each prototype
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
  "apply","bind","call","constructor","toString","length","name","arguments","caller",
]);

export async function observePrototype(bridge: CdpBridge, _url: string): Promise<PrototypeData> {
  const [objectProto, arrayProto, functionProto] = await Promise.all([
    bridge.evaluate<PrototypeData["objectProto"]>(`
      Object.getOwnPropertyNames(Object.prototype).map(k => ({
        key: k,
        type: typeof Object.prototype[k],
        enumerable: Object.getOwnPropertyDescriptor(Object.prototype, k)?.enumerable ?? false,
      }))
    `),
    bridge.evaluate<PrototypeData["arrayProto"]>(`
      Object.getOwnPropertyNames(Array.prototype).map(k => ({
        key: k,
        type: typeof Array.prototype[k],
        enumerable: Object.getOwnPropertyDescriptor(Array.prototype, k)?.enumerable ?? false,
      }))
    `),
    bridge.evaluate<PrototypeData["functionProto"]>(`
      Object.getOwnPropertyNames(Function.prototype).map(k => ({
        key: k,
        type: typeof Function.prototype[k],
        enumerable: Object.getOwnPropertyDescriptor(Function.prototype, k)?.enumerable ?? false,
      }))
    `),
  ]);

  const additions = [
    ...objectProto.filter(p => !OBJECT_PROTO_SPEC.has(p.key)).map(p => `Object.prototype.${p.key}`),
    ...arrayProto.filter(p => !ARRAY_PROTO_SPEC.has(p.key)).map(p => `Array.prototype.${p.key}`),
    ...functionProto.filter(p => !FUNCTION_PROTO_SPEC.has(p.key)).map(p => `Function.prototype.${p.key}`),
  ];

  return { objectProto, arrayProto, functionProto, additions };
}
