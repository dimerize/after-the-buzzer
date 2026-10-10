#!/usr/bin/env node
import { webcrypto } from 'node:crypto';

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const privateKey = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)).d;

console.error('Save VAPID_PRIVATE_KEY as a Cloudflare secret. Set VAPID_PUBLIC_KEY and a mailto: contact or HTTPS app URL as VAPID_SUBJECT. Keep this key pair stable: changing it requires browsers to subscribe again.');
console.log(JSON.stringify({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey }, null, 2));
