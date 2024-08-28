// mindexdb.js

/**
 * MindexDB: A Redis-like wrapper for IndexedDB
 * Provides key-value, hash, and list operations with expiration support
 */
class MindexDB {
    /**
     * Create a new MindexDB instance
     * @param {string} dbName - The name of the IndexedDB database
     * @param {number} version - The version of the database schema
     */
    constructor(dbName, version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.worker = null;
    }

    /**
     * Connect to the IndexedDB database and initialize the Web Worker
     */
    async connect() {
        await this._connectDB();
        this._initializeWorker();
    }

    /**
     * Create or open the IndexedDB database
     * @private
     */
    async _connectDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => reject(`Database error: ${event.target.error}`);

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Create object stores for different data types
                db.createObjectStore('keyValue');
                db.createObjectStore('hash');
                db.createObjectStore('list');
                const expiryStore = db.createObjectStore('expiry', { keyPath: 'key' });
                expiryStore.createIndex('expireAt', 'expireAt');
            };
        });
    }

    /**
     * Initialize the Web Worker for handling key expirations
     * @private
     */
    _initializeWorker() {
        const workerBlob = new Blob([`
            self.onmessage = function(e) {
                const { key, expireAt } = e.data;
                const now = Date.now();
                const timeout = expireAt - now;
                setTimeout(() => {
                    self.postMessage({ key, action: 'delete' });
                }, timeout);
            }
        `], { type: 'application/javascript' });

        this.worker = new Worker(URL.createObjectURL(workerBlob));
        this.worker.onmessage = async (e) => {
            const { key, action } = e.data;
            if (action === 'delete') {
                await this.del(key);
                await this._removeExpiry(key);
            }
        };
    }

    // Key-value operations

    /**
     * Set a key-value pair
     * @param {string} key - The key to set
     * @param {*} value - The value to set
     */
    async set(key, value) {
        return this._performTransaction('keyValue', 'readwrite', (store) => {
            store.put(value, key);
        });
    }

    /**
     * Get the value for a given key
     * @param {string} key - The key to retrieve
     * @returns {*} The value associated with the key
     */
    async get(key) {
        return this._performTransaction('keyValue', 'readonly', (store) => {
            return store.get(key);
        });
    }

    // Hash operations

    /**
     * Set a field in a hash stored at the given key
     * @param {string} hash - The hash key
     * @param {string} key - The field to set
     * @param {*} value - The value to set
     */
    async hset(hash, key, value) {
        return this._performTransaction('hash', 'readwrite', async (store) => {
            const hashObj = await store.get(hash) || {};
            hashObj[key] = value;
            store.put(hashObj, hash);
        });
    }

    /**
     * Get the value of a field in a hash
     * @param {string} hash - The hash key
     * @param {string} key - The field to retrieve
     * @returns {*} The value of the field
     */
    async hget(hash, key) {
        return this._performTransaction('hash', 'readonly', async (store) => {
            const hashObj = await store.get(hash);
            return hashObj ? hashObj[key] : undefined;
        });
    }

    // List operations

    /**
     * Insert one or more elements at the beginning of a list
     * @param {string} key - The list key
     * @param {...*} values - The values to insert
     * @returns {number} The length of the list after the operation
     */
    async lpush(key, ...values) {
        return this._performTransaction('list', 'readwrite', async (store) => {
            const list = await store.get(key) || [];
            list.unshift(...values);
            store.put(list, key);
            return list.length;
        });
    }

    /**
     * Insert one or more elements at the end of a list
     * @param {string} key - The list key
     * @param {...*} values - The values to insert
     * @returns {number} The length of the list after the operation
     */
    async rpush(key, ...values) {
        return this._performTransaction('list', 'readwrite', async (store) => {
            const list = await store.get(key) || [];
            list.push(...values);
            store.put(list, key);
            return list.length;
        });
    }

    /**
     * Remove and return the first element of a list
     * @param {string} key - The list key
     * @returns {*} The first element of the list, or null if the list is empty
     */
    async lpop(key) {
        return this._performTransaction('list', 'readwrite', async (store) => {
            const list = await store.get(key) || [];
            if (list.length === 0) return null;
            const item = list.shift();
            store.put(list, key);
            return item;
        });
    }

    /**
     * Remove and return the last element of a list
     * @param {string} key - The list key
     * @returns {*} The last element of the list, or null if the list is empty
     */
    async rpop(key) {
        return this._performTransaction('list', 'readwrite', async (store) => {
            const list = await store.get(key) || [];
            if (list.length === 0) return null;
            const item = list.pop();
            store.put(list, key);
            return item;
        });
    }

    /**
     * Get a range of elements from a list
     * @param {string} key - The list key
     * @param {number} start - The starting index
     * @param {number} stop - The stopping index
     * @returns {Array} The range of elements
     */
    async lrange(key, start, stop) {
        return this._performTransaction('list', 'readonly', async (store) => {
            const list = await store.get(key) || [];
            return list.slice(start, stop + 1);
        });
    }

    /**
     * Delete a key and its associated value (works for all types)
     * @param {string} key - The key to delete
     */
    async del(key) {
        await this._performTransaction('keyValue', 'readwrite', (store) => store.delete(key));
        await this._performTransaction('hash', 'readwrite', (store) => store.delete(key));
        await this._performTransaction('list', 'readwrite', (store) => store.delete(key));
    }

    /**
     * Set an expiration time for a key
     * @param {string} key - The key to expire
     * @param {number} seconds - The number of seconds until the key expires
     */
    async expire(key, seconds) {
        const expireAt = Date.now() + seconds * 1000;
        await this._setExpiry(key, expireAt);
        this.worker.postMessage({ key, expireAt });
    }

    /**
     * Set the expiration time for a key in the expiry store
     * @private
     */
    async _setExpiry(key, expireAt) {
        return this._performTransaction('expiry', 'readwrite', (store) => {
            store.put({ key, expireAt });
        });
    }

    /**
     * Remove the expiration time for a key from the expiry store
     * @private
     */
    async _removeExpiry(key) {
        return this._performTransaction('expiry', 'readwrite', (store) => {
            store.delete(key);
        });
    }

    /**
     * Perform a transaction on an object store
     * @private
     * @param {string} storeName - The name of the object store
     * @param {string} mode - The transaction mode ('readonly' or 'readwrite')
     * @param {function} operation - The operation to perform
     * @returns {Promise} A promise that resolves with the result of the operation
     */
    async _performTransaction(storeName, mode, operation) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);

            let request;
            try {
                request = operation(store);
            } catch (error) {
                reject(error);
                return;
            }

            transaction.oncomplete = () => resolve(request ? request.result : undefined);
            transaction.onerror = () => reject(transaction.error);
        });
    }
}
