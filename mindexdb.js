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
            const request = store.get(hash);
            return new Promise((resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const hashObj = request.result || {};
                    hashObj[key] = value;
                    const putRequest = store.put(hashObj, hash);
                    putRequest.onerror = () => reject(putRequest.error);
                    putRequest.onsuccess = () => resolve();
                };
            });
        });
    }

    /**
     * Get the value of a field in a hash
     * @param {string} hash - The hash key
     * @param {string} key - The field to retrieve
     * @returns {*} The value of the field
     */
    async hget(hash, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction('hash', 'readonly');
            const store = transaction.objectStore('hash');
            
            const request = store.get(hash);
            
            request.onerror = (event) => reject(event.target.error);
            
            request.onsuccess = (event) => {
                const hashObj = event.target.result;
                if (hashObj && typeof hashObj === 'object' && key in hashObj) {
                    resolve(hashObj[key]);
                } else {
                    resolve(null);
                }
            };
            
            transaction.onerror = (event) => reject(event.target.error);
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
        const transaction = this.db.transaction('list', 'readwrite');
        const store = transaction.objectStore('list');
        
        return new Promise((resolve, reject) => {
            const getRequest = store.get(key);
            
            getRequest.onerror = () => reject(getRequest.error);
            
            getRequest.onsuccess = () => {
                let list = getRequest.result;
                if (!Array.isArray(list)) {
                    list = [];
                }
                list.unshift(...values);
                
                const putRequest = store.put(list, key);
                
                putRequest.onerror = () => reject(putRequest.error);
                putRequest.onsuccess = () => resolve(list.length);
            };
        });
    }

    /**
     * Insert one or more elements at the end of a list
     * @param {string} key - The list key
     * @param {...*} values - The values to insert
     * @returns {number} The length of the list after the operation
     */
    async rpush(key, ...values) {
        const transaction = this.db.transaction('list', 'readwrite');
        const store = transaction.objectStore('list');
        
        return new Promise((resolve, reject) => {
            const getRequest = store.get(key);
            
            getRequest.onerror = () => reject(getRequest.error);
            
            getRequest.onsuccess = () => {
                let list = getRequest.result;
                if (!Array.isArray(list)) {
                    list = [];
                }
                list.push(...values);
                
                const putRequest = store.put(list, key);
                
                putRequest.onerror = () => reject(putRequest.error);
                putRequest.onsuccess = () => resolve(list.length);
            };
        });
    }
    /**
     * Remove and return the first element of a list
     * @param {string} key - The list key
     * @returns {*} The first element of the list, or null if the list is empty
     */
    async lpop(key) {
        const transaction = this.db.transaction('list', 'readwrite');
        const store = transaction.objectStore('list');
        
        return new Promise((resolve, reject) => {
            const getRequest = store.get(key);
            
            getRequest.onerror = () => reject(getRequest.error);
            
            getRequest.onsuccess = () => {
                let list = getRequest.result;
                if (!Array.isArray(list) || list.length === 0) {
                    resolve(null);
                    return;
                }
                
                const item = list.shift();
                
                const putRequest = store.put(list, key);
                
                putRequest.onerror = () => reject(putRequest.error);
                putRequest.onsuccess = () => resolve(item);
            };
        });
    }
    

    /**
     * Remove and return the last element of a list
     * @param {string} key - The list key
     * @returns {*} The last element of the list, or null if the list is empty
     */
    async rpop(key) {
        const transaction = this.db.transaction('list', 'readwrite');
        const store = transaction.objectStore('list');
        
        return new Promise((resolve, reject) => {
            const getRequest = store.get(key);
            
            getRequest.onerror = () => reject(getRequest.error);
            
            getRequest.onsuccess = () => {
                let list = getRequest.result;
                if (!Array.isArray(list) || list.length === 0) {
                    resolve(null);
                    return;
                }
                
                const item = list.pop();
                
                const putRequest = store.put(list, key);
                
                putRequest.onerror = () => reject(putRequest.error);
                putRequest.onsuccess = () => resolve(item);
            };
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
        const transaction = this.db.transaction('list', 'readonly');
        const store = transaction.objectStore('list');
        
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => {
                const list = request.result;
                if (!Array.isArray(list)) {
                    resolve([]);
                } else {
                    // Adjust stop index if it's negative (counting from the end)
                    const adjustedStop = stop < 0 ? list.length + stop + 1 : stop + 1;
                    resolve(list.slice(start, adjustedStop));
                }
            };
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
     * Get the remaining time to live for a key
     * @param {string} key - The key to check
     * @returns {number} The remaining time to live in seconds, or -1 if the key has no associated expire time, or -2 if the key does not exist
     */
       async ttl(key) {
        return this._performTransaction('expiry', 'readonly', async (store) => {
            const expiryData = await store.get(key);
            if (!expiryData) {
                // Check if the key exists in any of the data stores
                const keyExists = await this._checkKeyExists(key);
                return keyExists ? -1 : -2;
            }
            const remainingTime = Math.ceil((expiryData.expireAt - Date.now()) / 1000);
            return remainingTime > 0 ? remainingTime : -2;
        });
    }

    /**
     * Check if a key exists in any of the data stores
     * @private
     * @param {string} key - The key to check
     * @returns {boolean} True if the key exists, false otherwise
     */
    async _checkKeyExists(key) {
        const stores = ['keyValue', 'hash', 'list'];
        for (const storeName of stores) {
            const exists = await this._performTransaction(storeName, 'readonly', (store) => store.count(key));
            if (exists > 0) return true;
        }
        return false;
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
