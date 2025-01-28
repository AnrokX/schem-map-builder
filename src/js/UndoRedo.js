import { DatabaseManager, STORES } from './DatabaseManager';
import { MIN_UNDO_STATES, UNDO_THRESHOLD } from './Constants';

export class UndoRedoManager {
    static async saveUndo(changes) {
        try {
            // Get existing undo states
            const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
            
            // Add new changes to undo stack
            const newUndoStates = [changes, ...undoStates];
            
            // If we've hit the threshold, commit older states
            if (newUndoStates.length > UNDO_THRESHOLD) {
                await this.commitOldStates(newUndoStates);
            } else {
                // Otherwise just save the new state
                await Promise.all([
                    DatabaseManager.saveData(STORES.UNDO, 'states', newUndoStates),
                    DatabaseManager.saveData(STORES.REDO, 'states', [])
                ]);
            }
        } catch (error) {
            console.error('Error saving undo state:', error);
        }
    }

    static async commitOldStates(undoStates) {
        try {
            // Keep the most recent MIN_UNDO_STATES
            const statesToKeep = undoStates.slice(0, MIN_UNDO_STATES);
            const statesToCommit = undoStates.slice(MIN_UNDO_STATES);

            // Apply all states to commit in reverse order (oldest to newest)
            const reversedStatesToCommit = [...statesToCommit].reverse();
            
            // Get current terrain and environment
            const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
            const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];

            // Apply all states that need to be committed
            const { newTerrain, newEnvironment } = await this.applyStates(reversedStatesToCommit, currentTerrain, currentEnv);

            // Save the final state and remaining undo states
            await Promise.all([
                DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain),
                DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironment),
                DatabaseManager.saveData(STORES.UNDO, 'states', statesToKeep),
                DatabaseManager.saveData(STORES.REDO, 'states', [])
            ]);

            return { newTerrain, newEnvironment };
        } catch (error) {
            console.error('Error committing old states:', error);
            throw error;
        }
    }

    static async applyStates(states, initialTerrain, initialEnvironment) {
        let newTerrain = { ...initialTerrain };
        let newEnvironment = [...initialEnvironment];

        for (const state of states) {
            // Apply terrain changes
            if (state.terrain) {
                // Remove blocks
                Object.keys(state.terrain.removed || {}).forEach(key => {
                    delete newTerrain[key];
                });
                
                // Add blocks
                Object.entries(state.terrain.added || {}).forEach(([key, value]) => {
                    newTerrain[key] = value;
                });
            }

            // Apply environment changes
            if (state.environment?.added || state.environment?.removed) {
                newEnvironment = newEnvironment.filter(obj => 
                    !(state.environment.removed || []).some(removed => 
                        removed.modelUrl === obj.modelUrl && 
                        removed.position.x === obj.position.x &&
                        removed.position.y === obj.position.y &&
                        removed.position.z === obj.position.z
                    )
                );

                if (Array.isArray(state.environment.added)) {
                    newEnvironment.push(...state.environment.added);
                }
            }
        }

        return { newTerrain, newEnvironment };
    }

    static async undo(terrain, environment) {
        try {
            const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
            if (undoStates.length === 0) return null;

            // Apply all states first
            const [currentUndo, ...remainingUndo] = undoStates;
            const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];

            // Create inverse changes for redo
            const redoChanges = {
                terrain: {
                    added: currentUndo.terrain?.removed || {},
                    removed: currentUndo.terrain?.added || {}
                },
                environment: {
                    added: currentUndo.environment?.removed || [],
                    removed: currentUndo.environment?.added || []
                }
            };

            // Save all states first
            const newRedoStates = [redoChanges, ...redoStates];

            // Save states, keeping all of them
            await Promise.all([
                DatabaseManager.saveData(STORES.UNDO, 'states', remainingUndo),
                DatabaseManager.saveData(STORES.REDO, 'states', newRedoStates)
            ]);

            return currentUndo;
        } catch (error) {
            console.error('Error during undo:', error);
            return null;
        }
    }

    static async redo(terrain, environment) {
        try {
            const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];
            if (redoStates.length === 0) return null;

            // Apply all states first
            const [currentRedo, ...remainingRedo] = redoStates;
            const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];

            // Create inverse changes for undo
            const undoChanges = {
                terrain: {
                    added: currentRedo.terrain?.removed || {},
                    removed: currentRedo.terrain?.added || {}
                },
                environment: {
                    added: currentRedo.environment?.removed || [],
                    removed: currentRedo.environment?.added || []
                }
            };

            // Save all states first
            const newUndoStates = [undoChanges, ...undoStates];

            // Save states, keeping all of them
            await Promise.all([
                DatabaseManager.saveData(STORES.REDO, 'states', remainingRedo),
                DatabaseManager.saveData(STORES.UNDO, 'states', newUndoStates)
            ]);

            return currentRedo;
        } catch (error) {
            console.error('Error during redo:', error);
            return null;
        }
    }
}
