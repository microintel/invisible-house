/* ============================================================
   DATA LAYER · IndexedDB store
   ------------------------------------------------------------
   Thin promise wrapper over IndexedDB. Same database name,
   version and object stores as before, so already-cached fund
   lists / NAV histories on users' devices keep working.
   Exposes the original globals: openIdb, idbGet, idbSet (+ idbDelete).
   ============================================================ */
const IDB_NAME = 'sipTrackerCache';
const IDB_VERSION = 1;

let idbPromise = null;
function openIdb(){
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)){ resolve(null); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fundList')) db.createObjectStore('fundList', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('navCache')) db.createObjectStore('navCache', { keyPath: 'code' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return idbPromise;
}

async function idbGet(storeName, key){
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try{
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch(e){ resolve(null); }
  });
}

async function idbSet(storeName, value){
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try{
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch(e){ resolve(); }
  });
}

async function idbDelete(storeName, key){
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try{
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch(e){ resolve(); }
  });
}
