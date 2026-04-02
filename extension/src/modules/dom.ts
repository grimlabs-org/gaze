import type { Finding } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";
export async function runDomScan(_bridge: CdpBridge, _url: string): Promise<Finding[]> { return []; }
