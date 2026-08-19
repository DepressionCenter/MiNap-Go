// This file is part of MiNap Go
// vault.js
// Author(s): Gabriel Mongefranco
// Created: 2026-08-19
// Last Modified: 2026-08-19
// Summary: The local identity and encrypted-storage layer. Ties crypto.js and storage.js
//   together: which IndexedDB record belongs to which participant, unlocking and locking the
//   in-memory data key and device token, and reading/writing the encrypted history, queue, and
//   cached config collections. Nothing above this file reads or writes storage.js directly.
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

// The unwrapped data key and the device token live only here, only in memory, only for as long
// as the vault is unlocked -- never persisted as plaintext outside encrypted or non-extractable
// storage. The PIN itself is never held here at all, at any point: Code.gs's authenticateWrite_
// checks a device token on every write, not the PIN, so nothing in a session's lifetime ever
// needs to re-send it. Holding it would only recreate the exposure splitting the two was meant
// to remove -- a stolen device handing over a secret the participant may have reused elsewhere.
var session = null; // { studyId, participantId, tz, dataKey, deviceToken } | null

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
// for the same reason -- salt, iteration count, wrapped key -- never the PIN itself, and now
// never the device token in the clear either unless probeCryptoKeyStorage says this browser
// cannot do better (see establishDeviceSession_ below).

function getProfile(studyId, participantId) {
  return readPlain(collectionKey(studyId, participantId, 'profile'));
}

function createLocalProfile(studyId, participantId, tz, pin, deviceToken) {
  var key = collectionKey(studyId, participantId, 'profile');
  var newDataKey;
  return readPlain(key).then(function (existing) {
    if (existing) throw new Error('profile_exists');
    return generateDataKey();
  }).then(function (dataKey) {
    newDataKey = dataKey;
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
      });
    });
  }).then(function () {
    return establishDeviceSession_(studyId, participantId, newDataKey, deviceToken);
  }).then(function () {
    session = { studyId: studyId, participantId: participantId, tz: tz,
      dataKey: newDataKey, deviceToken: String(deviceToken) };
  });
}

// Attempts a fully local, PIN-only unwrap of a profile already on this device. Returns
// true/false rather than rejecting on a wrong PIN -- a wrong PIN is an expected outcome here,
// not an exceptional one. deviceToken comes from a verifyPin call the caller has already made:
// unwrapping the data key is local and offline-capable on its own, but only the server can mint
// a token, so a caller reaching this function is expected to have one in hand already.
function unlockWithPin(studyId, participantId, pin, deviceToken) {
  return getProfile(studyId, participantId).then(function (profile) {
    if (!profile) return false;
    var salt = fromBase64(profile.pin_salt);
    return deriveWrappingKey(pin, salt, profile.pin_iterations).then(function (wrappingKey) {
      return unwrapDataKey(
        { iv: profile.wrapped_key_iv, wrapped: profile.wrapped_key_ciphertext }, wrappingKey
      ).then(function (dataKey) {
        session = { studyId: studyId, participantId: participantId, tz: profile.tz,
          dataKey: dataKey, deviceToken: String(deviceToken) };
        var upgrade = profile.pin_iterations < PBKDF2_ITERATIONS
          ? rewrapAtCurrentIterations(studyId, participantId, pin, dataKey)
          : Promise.resolve();
        return upgrade
          .then(function () { return establishDeviceSession_(studyId, participantId, dataKey, deviceToken); })
          .then(function () { return true; });
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

// ----- device key: what lets the app resume with no PIN prompt -----
//
// A second, independent wrapping of the same data key, this time under a non-extractable key
// the browser holds for the page rather than one derived from anything the participant typed.
// It is what tryAutoResume unwraps on a later boot, with no PIN and no network call. See
// crypto.js's generateDeviceKey for what that non-extractability does and does not protect.

// device_key is not encrypted content like history/queue/cachedConfig -- it holds the
// CryptoKey object itself, which storage.js's putRecord clones natively (see that file's
// comment) and which nothing needs a PIN to read, because it can only ever be *used*, never
// exported, by whatever code holds a reference to it.
function readDeviceKey(studyId, participantId) {
  return readPlain(collectionKey(studyId, participantId, 'device_key'));
}
function writeDeviceKey(studyId, participantId, key) {
  return writePlain(collectionKey(studyId, participantId, 'device_key'), key);
}

// Wraps a fresh copy of the data key under a new, non-extractable device key, and stores the
// device token alongside it -- encrypted under that same key when probeCryptoKeyStorage says
// this browser can be trusted with one, or in the clear otherwise (architecture.md section 5.6's
// fallback). Which of the two applies is recorded in the profile, so tryAutoResume never has to
// guess which field to read.
//
// Called once per sign-in event -- createLocalProfile, unlockWithPin, and changePin -- always
// with a token the caller just received from setPin or verifyPin, never minted here. Overwrites
// whatever device key and wrapped copy were on file, which is correct: a fresh sign-in means the
// server has already handed out a new token, and the old device-wrapped copy would only unwrap
// the token that token replaced.
function establishDeviceSession_(studyId, participantId, dataKey, deviceToken) {
  var profileKey = collectionKey(studyId, participantId, 'profile');
  var deviceKey, canStoreKey;
  return probeCryptoKeyStorage().then(function (result) {
    canStoreKey = result;
    return generateDeviceKey();
  }).then(function (key) {
    deviceKey = key;
    return writeDeviceKey(studyId, participantId, deviceKey);
  }).then(function () {
    return wrapDataKey(dataKey, deviceKey);
  }).then(function (wrappedForDevice) {
    var tokenPromise = canStoreKey
      ? encryptJSON(deviceKey, deviceToken).then(function (enc) { return { storage: 'encrypted', enc: enc }; })
      : Promise.resolve({ storage: 'plain', enc: null });
    return tokenPromise.then(function (tokenResult) {
      return readPlain(profileKey).then(function (profile) {
        profile.wrapped_key_device_iv = wrappedForDevice.iv;
        profile.wrapped_key_device_ciphertext = wrappedForDevice.wrapped;
        profile.device_token_storage = tokenResult.storage;
        if (tokenResult.storage === 'encrypted') {
          profile.device_token_enc = tokenResult.enc;
          delete profile.device_token_plain;
        } else {
          profile.device_token_plain = deviceToken;
          delete profile.device_token_enc;
        }
        profile.last_verified_utc = new Date().toISOString();
        return writePlain(profileKey, profile);
      });
    });
  });
}

// Reads the device key and unwraps the data key and the device token, with no PIN and no
// network call. Shows no screen and never throws: any failure along the way (no device key
// stored yet, an unwrap rejected, a corrupted record) simply means there is nothing to resume,
// and the login screen is the correct fallback either way.
//
// @return {Promise<boolean>} True if the session is now unlocked.
function tryAutoResume(studyId, participantId) {
  return getProfile(studyId, participantId).then(function (profile) {
    if (!profile || !profile.wrapped_key_device_iv) return false;
    return readDeviceKey(studyId, participantId).then(function (deviceKey) {
      if (!deviceKey) return false;
      return unwrapDataKey(
        { iv: profile.wrapped_key_device_iv, wrapped: profile.wrapped_key_device_ciphertext }, deviceKey
      ).then(function (dataKey) {
        var tokenPromise = profile.device_token_storage === 'encrypted'
          ? decryptJSON(deviceKey, profile.device_token_enc)
          : Promise.resolve(profile.device_token_plain);
        return tokenPromise.then(function (token) {
          if (!token) return false;
          session = { studyId: studyId, participantId: participantId, tz: profile.tz,
            dataKey: dataKey, deviceToken: String(token) };
          return true;
        });
      });
    });
  }).catch(function () {
    return false;
  });
}

// Records that the server just confirmed this device is still recognised, so a boot long after
// the last successful check can tell a revalidation is overdue (auth.js's
// SESSION_REVALIDATE_DAYS) instead of only ever finding out from a rejected write. Requires an
// active session; a no-op otherwise.
function markSessionVerified() {
  if (!session) return Promise.resolve();
  var key = collectionKey(session.studyId, session.participantId, 'profile');
  return readPlain(key).then(function (profile) {
    if (!profile) return;
    profile.last_verified_utc = new Date().toISOString();
    return writePlain(key, profile);
  });
}

// Changes the PIN. Online-only: setPin is a google.script.run round trip, and queueing a PIN
// change would race against queued markers/surveys sent under the old or new token. Requires an
// active session -- the already-unwrapped session.dataKey is simply re-wrapped under a key
// derived from newPin, with a fresh salt; the server call above is what actually verifies
// oldPin, so nothing here needs to re-derive or re-unwrap with it. The fresh token setPin
// returns is stored the same way a sign-in stores one, so the device stays signed in and the
// new PIN is never retyped.
function changePin(oldPin, newPin) {
  if (!session) return Promise.resolve({ ok: false, reason: 'locked' });
  var studyId = session.studyId, participantId = session.participantId, dataKey = session.dataKey;
  return new Promise(function (resolve) {
    setPin(studyId, participantId, newPin, oldPin,
      function (res) { resolve(res || { ok: false, reason: 'offline' }); },
      function () { resolve({ ok: false, reason: 'offline' }); });
  }).then(function (result) {
    if (!result.ok) return result;
    var key = collectionKey(studyId, participantId, 'profile');
    var newSalt = randomSalt();
    return deriveWrappingKey(newPin, newSalt, PBKDF2_ITERATIONS).then(function (wrappingKey) {
      return wrapDataKey(dataKey, wrappingKey);
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
      return establishDeviceSession_(studyId, participantId, dataKey, result.deviceToken);
    }).then(function () {
      session.deviceToken = String(result.deviceToken);
      return { ok: true };
    });
  });
}

// Ends the session: best-effort tells the server to forget this device's token, then deletes
// the device key, the device-wrapped copy of the data key, and the stored token -- the PIN-
// wrapped copy, history, queue, and cached config are all untouched, so logging back in with the
// correct PIN sees the same history again. See docs/architecture.md's local storage section.
//
// Used both for an explicit "Log out" and for the softer case in auth.js where the server no
// longer recognises this device's token: either way, the point is that the next boot must not
// silently auto-resume with material the server has already stopped honoring.
function logout(studyId, participantId) {
  var token = session ? session.deviceToken : null;
  session = null;
  var signOut = token
    ? new Promise(function (resolve) {
        signOutDevice(studyId, participantId, token, function () { resolve(); }, function () { resolve(); });
      })
    : Promise.resolve();
  return signOut.then(function () {
    return deleteRecord(collectionKey(studyId, participantId, 'device_key'));
  }).then(function () {
    var key = collectionKey(studyId, participantId, 'profile');
    return readPlain(key).then(function (profile) {
      if (!profile) return;
      delete profile.wrapped_key_device_iv;
      delete profile.wrapped_key_device_ciphertext;
      delete profile.device_token_storage;
      delete profile.device_token_enc;
      delete profile.device_token_plain;
      return writePlain(key, profile);
    });
  });
}

// Deletes every namespaced record for one identity, including its device key. Destructive, and
// not wired to any button in Phase 3 -- kept for completeness, not as a "forget this device"
// feature nobody has asked for.
function wipeProfile(studyId, participantId) {
  return Promise.all(['profile', 'history', 'queue', 'cachedConfig', 'device_key'].map(function (name) {
    return deleteRecord(collectionKey(studyId, participantId, name));
  }));
}

function getSessionToken() {
  return session ? session.deviceToken : null;
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
