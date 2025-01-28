export const STORES = {
  TERRAIN: 'terrain',
  ENVIRONMENT: 'environment',
  PREVIEWS: 'environment-previews',
  SETTINGS: 'settings',
  CUSTOM_BLOCKS: 'custom-blocks',
  CUSTOM_MODELS: 'custom-models',
  UNDO: 'undo-states',
  REDO: 'redo-states'
};

export class DatabaseManager {
  static DB_NAME = 'terrain-builder';
  static DB_VERSION = 10;  // Incremented version number
  static dbConnection = null;  // Add static property to store connection

  static async openDB() {
    // Return existing connection if available
    if (this.dbConnection) {
      return Promise.resolve(this.dbConnection);
    }

    return new Promise((resolve, reject) => {
      // First, check if we need to delete the old database
      const checkRequest = indexedDB.open(this.DB_NAME);
      
      checkRequest.onsuccess = () => {
        const oldVersion = checkRequest.result.version;
        checkRequest.result.close();
        
        if (oldVersion < this.DB_VERSION) {
          // Delete the old database if it's an older version
          const deleteRequest = indexedDB.deleteDatabase(this.DB_NAME);
          
          deleteRequest.onsuccess = () => {
            // Now open with the new version
            this.openNewDB().then(db => {
              this.dbConnection = db;  // Store the connection
              resolve(db);
            }).catch(reject);
          };
          
          deleteRequest.onerror = () => {
            console.error('Error deleting old database');
            reject(deleteRequest.error);
          };
        } else {
          // If version is current, just open normally
          this.openNewDB().then(db => {
            this.dbConnection = db;  // Store the connection
            resolve(db);
          }).catch(reject);
        }
      };
      
      checkRequest.onerror = () => {
        console.error('Error checking database version');
        reject(checkRequest.error);
      };
    });
  }

  static async openNewDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.TERRAIN)) {
          db.createObjectStore(STORES.TERRAIN);
        }
        if (!db.objectStoreNames.contains(STORES.ENVIRONMENT)) {
          db.createObjectStore(STORES.ENVIRONMENT);
        }
        if (!db.objectStoreNames.contains(STORES.PREVIEWS)) {
          db.createObjectStore(STORES.PREVIEWS);
        }
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS);
        }
        if (!db.objectStoreNames.contains(STORES.CUSTOM_BLOCKS)) {
          db.createObjectStore(STORES.CUSTOM_BLOCKS);
        }
        if (!db.objectStoreNames.contains(STORES.CUSTOM_MODELS)) {
          db.createObjectStore(STORES.CUSTOM_MODELS);
        }
        if (!db.objectStoreNames.contains(STORES.UNDO)) {
          db.createObjectStore(STORES.UNDO);
        }
        if (!db.objectStoreNames.contains(STORES.REDO)) {
          db.createObjectStore(STORES.REDO);
        }
      };
    });
  }

  static async saveData(storeName, key, data) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data, key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  static async getData(storeName, key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  static async deleteData(storeName, key) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
