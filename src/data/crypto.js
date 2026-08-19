// This file is part of MiNap Go
// crypto.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: PIN-based key wrapping and content encryption for local storage, built entirely on
//   the browser's SubtleCrypto. No cryptographic algorithm is implemented here: PBKDF2
//   stretches a PIN into a wrapping key, and AES-GCM wraps a random data key under it and
//   encrypts stored content with it. Identical in both builds.
// Notes: See README file for documentation and full license information.
//
// Copyright © 2026 The Regents of the University of Michigan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License along
// with this program. If not, see <https://www.gnu.org/licenses/>.

// PBKDF2 iteration count for turning a login PIN into a key-wrapping key. Reused from the
// 310,000 the private-notes vault spec (architecture.md section 6.1) commits to, for internal
// consistency -- it is the one client-side PBKDF2 number this project's own documentation has
// settled on. Stored per profile as pin_iterations, so a device that wrapped its key at a lower
// count can be raised to the current one on a later unlock without breaking anything.
var PBKDF2_ITERATIONS = 310000;
var PBKDF2_HASH = 'SHA-256';
var WRAP_ALGORITHM = 'AES-GCM';
var WRAP_KEY_LENGTH = 256;
var SALT_BYTES = 16;
var IV_BYTES = 12;

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// A fresh random salt for deriving a PIN-wrapping key. Unrelated to the server's own pin_salt
// column: the server salts and stretches the PIN separately (10-round chained SHA-256, to check
// a submitted PIN) from this client-side PBKDF2 salt (to derive a key that wraps the local data
// key). Same field name in two unconnected places; the two values are never compared.
function randomSalt() {
  return randomBytes(SALT_BYTES);
}

function toBase64(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromBase64(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Derives a non-extractable AES-GCM key from a PIN, a salt, and an iteration count. The PIN
// itself is never stored; only the salt and iteration count needed to re-derive this key are.
function deriveWrappingKey(pin, saltBytes, iterations) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']
  ).then(function (baseKey) {
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: PBKDF2_HASH },
      baseKey,
      { name: WRAP_ALGORITHM, length: WRAP_KEY_LENGTH },
      false, // non-extractable: only ever used to wrap/unwrap, never exported
      ['wrapKey', 'unwrapKey']
    );
  });
}

// A random AES-GCM data key. Extractable is required so SubtleCrypto can wrap it for storage;
// this is not a separate exposure, because the wrapped bytes are themselves only readable
// through the PIN-derived wrapping key.
function generateDataKey() {
  return crypto.subtle.generateKey({ name: WRAP_ALGORITHM, length: WRAP_KEY_LENGTH }, true, ['encrypt', 'decrypt']);
}

// A device key SubtleCrypto generates and holds itself: non-extractable, so no code running on
// this page -- including this file -- can ever read its raw bytes back out, only ask the browser
// to wrap/unwrap or encrypt/decrypt with it. It wraps a second copy of the data key and encrypts
// the stored device token, which is what lets a return visit resume with no PIN prompt.
//
// What that actually buys: protection against page script exporting the key, whether by an
// injection or by a bug in this app's own code. It does not protect against someone with the
// device itself on a rooted or jailbroken phone, where the browser's own on-disk form of the key
// can be recovered outside the page sandbox entirely. The device token being revocable from the
// Sheet and useless anywhere else is what actually limits a stolen phone's exposure; this key is
// a second layer on top of that, not the layer doing the real work. See docs/architecture.md
// section 5.6, and storage.js's probeCryptoKeyStorage, which checks this holds before relying on
// it rather than assuming so.
function generateDeviceKey() {
  return crypto.subtle.generateKey(
    { name: WRAP_ALGORITHM, length: WRAP_KEY_LENGTH }, false, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );
}

// Wraps dataKey under wrappingKey. The returned iv and wrapped bytes are safe to store in the
// clear -- the wrapping key, not secrecy of these bytes, is what protects the data key.
function wrapDataKey(dataKey, wrappingKey) {
  var iv = randomBytes(IV_BYTES);
  return crypto.subtle.wrapKey('raw', dataKey, wrappingKey, { name: WRAP_ALGORITHM, iv: iv })
    .then(function (wrapped) {
      return { iv: toBase64(iv), wrapped: toBase64(new Uint8Array(wrapped)) };
    });
}

// Unwraps a data key. A wrong wrappingKey (wrong PIN) makes this promise reject, because
// AES-GCM's own authentication tag check fails -- that rejection is the sole "wrong PIN"
// signal; no separate verifier value is stored. (IndexedDB corruption of the stored bytes would
// also make this reject, indistinguishable from a wrong PIN -- both are simply "cannot unwrap.")
function unwrapDataKey(wrappedRecord, wrappingKey) {
  return crypto.subtle.unwrapKey(
    'raw', fromBase64(wrappedRecord.wrapped), wrappingKey,
    { name: WRAP_ALGORITHM, iv: fromBase64(wrappedRecord.iv) },
    { name: WRAP_ALGORITHM, length: WRAP_KEY_LENGTH },
    true, ['encrypt', 'decrypt']
  );
}

// Encrypts one JSON-serializable value under dataKey. A fresh random iv is drawn on every call
// and never reused -- AES-GCM fails catastrophically if the same key/iv pair is ever repeated.
function encryptJSON(dataKey, value) {
  var iv = randomBytes(IV_BYTES);
  var plaintext = new TextEncoder().encode(JSON.stringify(value));
  return crypto.subtle.encrypt({ name: WRAP_ALGORITHM, iv: iv }, dataKey, plaintext).then(function (ciphertext) {
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  });
}

function decryptJSON(dataKey, record) {
  return crypto.subtle.decrypt(
    { name: WRAP_ALGORITHM, iv: fromBase64(record.iv) }, dataKey, fromBase64(record.ciphertext)
  ).then(function (plaintext) {
    return JSON.parse(new TextDecoder().decode(plaintext));
  });
}
