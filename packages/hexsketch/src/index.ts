/**
 * HexSketch for AI agents and scripts. Platform-neutral: this module runs in
 * Node, Workers and browsers (from a CDN too). PNG output needs a rasterizer;
 * in Node, `import { rasterize } from 'hexsketch/png'`.
 */
export * from '@hexsketch/agent';
export { HEXSKETCH_URL } from '@hexsketch/core';
