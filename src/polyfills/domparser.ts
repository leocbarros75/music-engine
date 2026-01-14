/**
 * Node.js polyfill for DOMParser (used by some XML helpers).
 * Browser has DOMParser by default; Node does not.
 */
import { DOMParser } from "@xmldom/xmldom";

// Expose DOMParser globally so legacy code that calls `new DOMParser()` works.
(globalThis as any).DOMParser = DOMParser;
