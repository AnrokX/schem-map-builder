import { version } from './Constants';

export const STORES = {
  TERRAIN: 'terrain',
  ENVIRONMENT: 'environment',
  PREVIEWS: 'environment-icons',
  SETTINGS: 'settings',
  CUSTOM_BLOCKS: 'custom-blocks',
  CUSTOM_MODELS: 'custom-models',
  UNDO: 'undo-states',
  REDO: 'redo-states'
};

export class DatabaseManager {
  static DB_NAME = 'hytopia-world-editor-' + version;
  static DB_VERSION = 1;  // Incremented version number
  static dbConnection = null;  // Add static property to store connection

  static async openDB() {
    // Return existing connection if available
    if (this.dbConnection) {
      return Promise.resolve(this.dbConnection);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.dbConnection = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create all stores if they don't exist
        Object.values(STORES).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        });
      };
    });
  }

  /// provides the existing connection or opens a new one if it doesn't exist
  static async getConnection() {
    if (!this.dbConnection || this.dbConnection.closed) {
      this.dbConnection = await this.openDB();
    }
    return this.dbConnection;
  }

  static async saveData(storeName, key, data) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data, key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  static async getData(storeName, key) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  static async deleteData(storeName, key) {
    const db = await this.getConnection();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  static async clearStore(storeName) {
    try {
      const db = await this.getConnection();
      
      // Check if store exists
      if (!db.objectStoreNames.contains(storeName)) {
        console.log(`Store ${storeName} does not exist, skipping clear`);
        return;
      }

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.warn(`Error clearing store ${storeName}:`, error);
    }
  }

  static async bulkAddToStore(storeName, dataObject) {
    if (!dataObject || Object.keys(dataObject).length === 0) {
      console.warn('No data provided for bulk add to store:', storeName);
      return;
    }
    
    try {
      const db = await this.getConnection();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        // Track completion
        let completed = 0;
        const total = Object.keys(dataObject).length;
        let hasError = false;
        
        // Function to check if all operations are complete
        const checkCompletion = () => {
          if (completed === total) {
            if (hasError) {
              reject(new Error('One or more operations failed'));
            } else {
              resolve();
            }
          }
        };
        
        // Handle transaction completion
        transaction.oncomplete = () => {
          resolve();
        };
        
        transaction.onerror = (event) => {
          console.error('Bulk add transaction error:', event.target.error);
          hasError = true;
          reject(event.target.error);
        };
        
        // Add each item to the store
        Object.entries(dataObject).forEach(([key, value]) => {
          const request = store.put(value, key);
          
          request.onsuccess = () => {
            completed++;
            checkCompletion();
          };
          
          request.onerror = (event) => {
            console.error(`Error adding item ${key} to ${storeName}:`, event.target.error);
            hasError = true;
            completed++;
            checkCompletion();
          };
        });
      });
    } catch (error) {
      console.error(`Error in bulkAddToStore for ${storeName}:`, error);
      throw error;
    }
  }

  static async clearDatabase() {
    // Show confirmation dialog
    const confirmed = window.confirm("Warning: This will clear all data including the terrain, environment, and custom blocks. \n\nAre you sure you want to continue?");
    
    if (!confirmed) {
      return; // User cancelled the operation
    }

    try {      
      // Clear all stores sequentially
      for (const storeName of Object.values(STORES)) {
        await this.clearStore(storeName);
      }
      // Only reload after all stores are cleared
      window.location.reload();
    } catch (error) {
      console.error('Error clearing database:', error);
      throw error;
    }
  }
}
