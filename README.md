# MindexDB

MindexDB is a lightweight, Redis-like wrapper for IndexedDB, providing a simple and intuitive API for working with client-side storage in web applications. It supports key-value operations, hash operations, list operations, and key expiration.

## Features

- Simple Redis-like API
- Support for key-value, hash, and list operations
- Key expiration using Web Workers
- Promise-based interface
- TypeScript-friendly with JSDoc comments

## Installation

You can include MindexDB in your project by copying the `mindexdb.js` file into your project directory.

```html
<script src="path/to/mindexdb.js"></script>
```

Or, if you're using a module bundler like webpack or rollup, you can import it as a module:

```javascript
import { MindexDB } from './path/to/mindexdb.js';
```

## Usage

Here's a quick example of how to use MindexDB:

```javascript
// Create a new instance of MindexDB
const db = new MindexDB('myDatabase');

// Connect to the database
await db.connect();

// Set a key-value pair
await db.set('user:1', 'John Doe');

// Get a value
const user = await db.get('user:1');
console.log(user); // Output: John Doe

// Set a hash field
await db.hset('user:2', 'name', 'Jane Doe');

// Get a hash field
const name = await db.hget('user:2', 'name');
console.log(name); // Output: Jane Doe

// Push items to a list
await db.rpush('mylist', 'item1', 'item2', 'item3');

// Get items from a list
const items = await db.lrange('mylist', 0, -1);
console.log(items); // Output: ['item1', 'item2', 'item3']

// Set expiration on a key
await db.expire('user:1', 60); // Expires in 60 seconds

// Check TTL of a key
const remainingTTL = await db.ttl('myKey');
console.log(`Remaining TTL: ${remainingTTL} seconds`);
```

## API Reference

### Constructor

#### `new MindexDB(dbName, version = 1)`

Creates a new instance of MindexDB.

- `dbName`: The name of the IndexedDB database.
- `version`: The version of the database schema (default: 1).

### Methods

#### `async connect()`

Connects to the IndexedDB database and initializes the Web Worker for expiration handling.

#### `async set(key, value)`

Sets a key-value pair.

#### `async get(key)`

Retrieves the value associated with the given key.

#### `async hset(hash, key, value)`

Sets a field in a hash stored at the given key.

#### `async hget(hash, key)`

Retrieves the value of a field in a hash.

#### `async lpush(key, ...values)`

Inserts one or more elements at the beginning of a list.

#### `async rpush(key, ...values)`

Inserts one or more elements at the end of a list.

#### `async lpop(key)`

Removes and returns the first element of a list.

#### `async rpop(key)`

Removes and returns the last element of a list.

#### `async lrange(key, start, stop)`

Retrieves a range of elements from a list.

#### `async del(key)`

Deletes a key and its associated value (works for all types).

#### `async expire(key, seconds)`

Sets an expiration time for a key.

## Browser Compatibility

MindexDB works in all modern browsers that support IndexedDB and Web Workers. This includes:

- Chrome 24+
- Firefox 16+
- Safari 10+
- Edge 12+
- Opera 15+

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
