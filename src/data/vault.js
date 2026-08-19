// This file is part of MiNap Go
// vault.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: The local identity and encrypted-storage layer. Ties crypto.js and storage.js
//   together: which IndexedDB record belongs to which participant, unlocking and locking the
//   in-memory data key and PIN, and reading/writing the encrypted history, queue, and cached
//   config collections. Nothing above this file reads or writes storage.js directly.
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

// The unwrapped data key and the raw PIN live only here, only in memory, only for as long as
// the vault is unlocked -- never persisted. The raw PIN has to be held for the session's
// duration because the server requires it on every single write call (authenticateWrite_ in
// Code.gs); there is no way around re-sending it. That makes it a broader-impact secret than
// the data key alone (a leak of this, not just of local data, could write to the server as this
// participant), even though both live under the same in-page-JS threat model.
var session = null; // { studyId, participantId, tz, dataKey, pin } | null

var LAST_IDENTITY_KEY = 'last_identity';

// A single Apps Script deployment can serve more than one study sharing one workbook
// (architecture.md section 3.1), and a device could plausibly be used for more than one
// study/participant pair over time. Every record is namespaced by identity so two identities
// used on the same device get fully separate, independently-encrypted data -- never
// overwriting or orphaning one another. The standalone build has no login and only ever one
// local identity, so it falls back to a fixed prefix.
function collectionKey(studyId, participantId, name) {
  var prefix = studyId ? (studyId + '_' + participantId + '_') : 'local_';
  return prefix + name;
}

function readPlain(key) {
  return getRecord(key).then(function (rec) { return rec ? rec.value : null; });
}
function writePlain(key, value) {
  return putRecord({ key: key, value: value });
}

// content_version is separate from storage.js's DB_VERSION: it describes the shape of what is
// *inside* an encrypted record's plaintext, which onupgradeneeded cannot see or migrate (it
// runs before any PIN is entered). A future phase that changes what history/queue/cachedConfig
// hold reads the old content_version after unlock, transforms in JS, and writes it back at the
// current one. Nothing yet needs that transform, so none is implemented.
var CONTENT_VERSION = 1;

function readEncrypted(dataKey, key, fallback) {
  return getRecord(key).then(function (rec) {
    if (!rec) return fallback;
    return decryptJSON(dataKey, rec);
  });
}
function writeEncrypted(dataKey, key, value) {
  return encryptJSON(dataKey, value).then(function (enc) {
    return putRecord(Object.assign({ key: key, content_version: CONTENT_VERSION }, enc));
  });
}

// Per-key write serialization. An async storage layer lets two operations on the same
// collection interleave (a Sleep tap and a queue drain, say) in a way synchronous localStorage
// never could; this keeps a read-modify-write sequence on one key from clobbering another's.
var writeQueues = {};
function serialize(key, fn) {
  var tail = writeQueues[key] || Promise.resolve();
  var result = tail.then(fn, fn);
  writeQueues[key] = result.catch(function () {}); // keep the chain alive past a failed op
  return result;
}

// Atomic read-modify-write on one collection: reads the current value, applies mutatorFn, and
// writes the result, all serialized against any other pending operation on the same key.
function updateCollection(name, mutatorFn, fallback) {
  if (!session) return Promise.reject(new Error('locked'));
  var key = collectionKey(session.studyId, session.participantId, name);
  return serialize(key, function () {
    return readEncrypted(session.dataKey, key, fallback).then(function (current) {
      var updated = mutatorFn(current);
      return writeEncrypted(session.dataKey, key, updated).then(function () { return updated; });
    });
  });
}

// ----- last-used identity, for pre-filling the login screen -----

function getLastIdentity() {
  return readPlain(LAST_IDENTITY_KEY);
}
function setLastIdentity(studyId, participantId) {
  return writePlain(LAST_IDENTITY_KEY, { study_id: studyId, participant_id: participantId });
}
function clearLastIdentity() {
  return deleteRecord(LAST_IDENTITY_KEY);
}

// ----- profile: identity + PIN key material, unencrypted -----
//
// Unencrypted is correct here, not a shortcut: this record has to be readable before the PIN is
// entered, to know whether this device already has a profile for this identity at all. It holds
// the same class of information architecture.md section 6.1's notes vault stores in the clear
// for the same reason -- salt, iteration count, wrapped key -- never the PIN itself.

function getProfile(studyId, participantId) {
  return readPlain(collectionKey(studyId, participantId, 'profile'));
}

function createLocalProfile(studyId, participantId, tz, pin) {
  var key = collectionKey(studyId, participantId, 'profile');
  return readPlain(key).then(function (existing) {
    if (existing) throw new Error('profile_exists');
    return generateDataKey();
  }).then(function (dataKey) {
    var salt = randomSalt();
    return deriveWrappingKey(pin, salt, PBKDF2_ITERATIONS).then(function (wrappingKey) {
      return wrapDataKey(dataKey, wrappingKey);
    }).then(function (wrapped) {
      var now = new Date().toISOString();
      return writePlain(key, {
        study_id: studyId,
        participant_id: participantId,
        tz: tz,
        pin_salt: toBase64(salt),
        pin_iterations: PBKDF2_ITERATIONS,
        wrapped_key_iv: wrapped.iv,
        wrapped_key_ciphertext: wrapped.wrapped,
        created_at: now,
        pin_set_at: now
      }).then(function () {
        session = { studyId: studyId, participantId: participantId, tz: tz, dataKey: dataKey, pin: String(pin) };
      });
    });
  });
}

// Attempts a fully local, offline-capable unlock. Returns true/false rather than rejecting on a
// wrong PIN -- a wrong PIN is an expected outcome here, not an exceptional one.
function unlockWithPin(studyId, participantId, pin) {
  return getProfile(studyId, participantId).then(function (profile) {
    if (!profile) return false;
    var salt = fromBase64(profile.pin_salt);
    return deriveWrappingKey(pin, salt, profile.pin_iterations).then(function (wrappingKey) {
      return unwrapDataKey(
        { iv: profile.wrapped_key_iv, wrapped: profile.wrapped_key_ciphertext }, wrappingKey
      ).then(function (dataKey) {
        session = { studyId: studyId, participantId: participantId, tz: profile.tz, dataKey: dataKey, pin: String(pin) };
        var upgrade = profile.pin_iterations < PBKDF2_ITERATIONS
          ? rewrapAtCurrentIterations(studyId, participantId, pin, dataKey)
          : Promise.resolve();
        return upgrade.then(function () { return true; });
      }, function () {
        return false; // unwrap rejected: wrong PIN (or corrupted data -- see crypto.js comment)
      });
    });
  });
}

// Re-wraps the already-unwrapped data key at the current PBKDF2_ITERATIONS, so a device that
// set its PIN before an iteration-count increase catches up on its next successful unlock,
// without ever needing a forced re-entry of the PIN.
function rewrapAtCurrentIterations(studyId, participantId, pin, dataKey) {
  var key = collectionKey(studyId, participantId, 'profile');
  var newSalt = randomSalt();
  return deriveWrappingKey(pin, newSalt, PBKDF2_ITERATIONS).then(function (wrappingKey) {
    return wrapDataKey(dataKey, wrappingKey);
  }).then(function (wrapped) {
    return readPlain(key).then(function (profile) {
      profile.pin_salt = toBase64(newSalt);
      profile.pin_iterations = PBKDF2_ITERATIONS;
      profile.wrapped_key_iv = wrapped.iv;
      profile.wrapped_key_ciphertext = wrapped.wrapped;
      return writePlain(key, profile);
    });
  });
}

// Changes the PIN. Online-only: setPin is a google.script.run round trip, and queueing a PIN
// change would race against queued markers/surveys sent under the old or new PIN. Requires an
// active session -- the already-unwrapped session.dataKey is simply re-wrapped under a key
// derived from newPin, with a fresh salt; the server call above is what actually verifies
// oldPin, so nothing here needs to re-derive or re-unwrap with it.
function changePin(oldPin, newPin) {
  if (!session) return Promise.resolve({ ok: false, reason: 'locked' });
  return new Promise(function (resolve) {
    setPin(session.studyId, session.participantId, newPin, oldPin,
      function (res) { resolve(res || { ok: false, reason: 'offline' }); },
      function () { resolve({ ok: false, reason: 'offline' }); });
  }).then(function (result) {
    if (!result.ok) return result;
    var key = collectionKey(session.studyId, session.participantId, 'profile');
    var newSalt = randomSalt();
    return deriveWrappingKey(newPin, newSalt, PBKDF2_ITERATIONS).then(function (wrappingKey) {
      return wrapDataKey(session.dataKey, wrappingKey);
    }).then(function (wrapped) {
      return readPlain(key).then(function (profile) {
        profile.pin_salt = toBase64(newSalt);
        profile.pin_iterations = PBKDF2_ITERATIONS;
        profile.wrapped_key_iv = wrapped.iv;
        profile.wrapped_key_ciphertext = wrapped.wrapped;
        profile.pin_set_at = new Date().toISOString();
        return writePlain(key, profile);
      });
    }).then(function () {
      session.pin = String(newPin);
      return { ok: true };
    });
  });
}

// Clears the in-memory session only. Every namespaced record for this identity stays on disk,
// still encrypted, exactly as before -- logging out never deletes local data, so logging back
// in with the correct PIN sees the same history again. See docs/architecture.md's local storage
// section for the reasoning.
function lock() {
  session = null;
}

// Deletes every namespaced record for one identity. Destructive, and not wired to any button in
// Phase 3 -- kept for completeness, not as a "forget this device" feature nobody has asked for.
function wipeProfile(studyId, participantId) {
  return Promise.all(['profile', 'history', 'queue', 'cachedConfig'].map(function (name) {
    return deleteRecord(collectionKey(studyId, participantId, name));
  }));
}

function getSessionPin() {
  return session ? session.pin : null;
}
function getSessionIdentity() {
  return session ? { studyId: session.studyId, participantId: session.participantId, tz: session.tz } : null;
}

// ----- content collections (require an active session) -----

function getHistory() {
  if (!session) return Promise.reject(new Error('locked'));
  return readEncrypted(session.dataKey, collectionKey(session.studyId, session.participantId, 'history'), []);
}
function setHistory(arr) {
  return updateHistory(function () { return arr; });
}
function updateHistory(mutatorFn) {
  return updateCollection('history', mutatorFn, []);
}

function getQueue() {
  if (!session) return Promise.reject(new Error('locked'));
  return readEncrypted(session.dataKey, collectionKey(session.studyId, session.participantId, 'queue'), []);
}
function setQueue(arr) {
  return updateQueue(function () { return arr; });
}
function updateQueue(mutatorFn) {
  return updateCollection('queue', mutatorFn, []);
}

// Cached copy of getConfig()'s last successful result (edit window + question list), read
// before ever falling back to the generic hardcoded defaults, so a participant opening the app
// offline days after their last successful fetch still sees their study's actual questions.
function getCachedConfig() {
  if (!session) return Promise.reject(new Error('locked'));
  return readEncrypted(session.dataKey, collectionKey(session.studyId, session.participantId, 'cachedConfig'), null);
}
function setCachedConfig(cfg) {
  return updateCollection('cachedConfig', function () { return cfg; }, null);
}
