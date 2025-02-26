import { DatabaseManager, STORES } from "./DatabaseManager";
import { getBlockTypes, updateBlockTypes } from "./TerrainBuilder";
import { environmentModels } from "./EnvironmentBuilder";
import * as THREE from "three";
import JSZip from "jszip";
import { version } from "./Constants";

/**
 * Exports the current map (terrain and environment) as a JSON file
 * @returns {Promise<Blob>} A promise that resolves to a Blob containing the exported map
 */
export const exportMap = async () => {
  try {
    // Get terrain data
    const terrainData = await DatabaseManager.getData(STORES.TERRAIN, "current");
    
    // Get environment data
    const environmentData = await DatabaseManager.getData(STORES.ENVIRONMENT, "current");
    
    // Get custom blocks data
    const customBlocksData = await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks");
    
    // Create the export object
    const exportData = {
      version: 1,
      terrain: terrainData || {},
      environment: environmentData || [],
      customBlocks: customBlocksData || []
    };
    
    // Convert to JSON and create a blob
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    
    return blob;
  } catch (error) {
    console.error("Error exporting map:", error);
    throw error;
  }
};

/**
 * Imports a map from a JSON file
 * @param {File} file The JSON file to import
 * @param {Object} terrainBuilderRef Reference to the TerrainBuilder component
 * @param {Object} environmentBuilderRef Reference to the EnvironmentBuilder component
 * @returns {Promise<Object>} A promise that resolves to an object containing the imported data
 */
export const importMap = async (file, terrainBuilderRef, environmentBuilderRef) => {
  try {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const importData = JSON.parse(event.target.result);
          
          // Validate the imported data
          if (!importData.version || !importData.terrain) {
            throw new Error("Invalid map file format");
          }
          
          // Clear existing map if user confirms
          if (window.confirm("Do you want to clear the existing map before importing?")) {
            // Use terrainBuilderRef to clear the map
            if (terrainBuilderRef && terrainBuilderRef.current) {
              await terrainBuilderRef.current.clearMap();
            } else {
              // Fallback if ref is not available
              await DatabaseManager.clearStore(STORES.TERRAIN);
              await DatabaseManager.clearStore(STORES.ENVIRONMENT);
              await Promise.all([
                DatabaseManager.saveData(STORES.UNDO, "states", []),
                DatabaseManager.saveData(STORES.REDO, "states", [])
              ]);
            }
          }
          
          // Save terrain data
          await DatabaseManager.saveData(STORES.TERRAIN, "current", importData.terrain);
          
          // Save environment data if it exists
          if (importData.environment) {
            await DatabaseManager.saveData(STORES.ENVIRONMENT, "current", importData.environment);
          }
          
          // Import custom blocks if they exist
          if (importData.customBlocks && importData.customBlocks.length > 0) {
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, "blocks", importData.customBlocks);
            // Update block types with the imported custom blocks
            updateBlockTypes(importData.customBlocks);
          }
          
          // Refresh terrain and environment builders
          if (terrainBuilderRef && terrainBuilderRef.current) {
            await terrainBuilderRef.current.refreshTerrainFromDB();
          }
          
          if (environmentBuilderRef && environmentBuilderRef.current) {
            await environmentBuilderRef.current.refreshEnvironmentFromDB();
          }
          
          resolve({
            terrain: importData.terrain,
            environment: importData.environment,
            customBlocks: importData.customBlocks
          });
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => {
        reject(new Error("Error reading file"));
      };
      
      reader.readAsText(file);
    });
  } catch (error) {
    console.error("Error importing map:", error);
    throw error;
  }
};

/**
 * Exports custom blocks as an asset pack
 * @returns {Promise<Blob>} A promise that resolves to a Blob containing the exported asset pack
 */
export const exportAssetPack = async () => {
  try {
    // Get custom blocks data
    const customBlocksData = await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks");
    
    // Get custom models data
    const customModelsData = await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models");
    
    // Create the export object
    const exportData = {
      version: 1,
      blocks: customBlocksData || [],
      models: customModelsData || []
    };
    
    // Convert to JSON and create a blob
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    
    return blob;
  } catch (error) {
    console.error("Error exporting asset pack:", error);
    throw error;
  }
};

/**
 * Imports an asset pack from a JSON file
 * @param {File} file The JSON file to import
 * @param {Object} environmentBuilderRef Reference to the EnvironmentBuilder component
 * @returns {Promise<Object>} A promise that resolves to an object containing the imported data
 */
export const importAssetPack = async (file, environmentBuilderRef) => {
  try {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const importData = JSON.parse(event.target.result);
          
          // Validate the imported data
          if (!importData.version) {
            throw new Error("Invalid asset pack file format");
          }
          
          let customBlocks = [];
          let customModels = [];
          
          // Import custom blocks if they exist
          if (importData.blocks && importData.blocks.length > 0) {
            // Get existing custom blocks
            const existingBlocks = await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks") || [];
            
            // Merge existing and new blocks, avoiding duplicates by ID
            const existingIds = new Set(existingBlocks.map(block => block.id));
            const newBlocks = importData.blocks.filter(block => !existingIds.has(block.id));
            
            customBlocks = [...existingBlocks, ...newBlocks];
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, "blocks", customBlocks);
            
            // Update block types with the imported custom blocks
            updateBlockTypes(newBlocks);
          }
          
          // Import custom models if they exist
          if (importData.models && importData.models.length > 0) {
            // Get existing custom models
            const existingModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models") || [];
            
            // Merge existing and new models, avoiding duplicates by name
            const existingNames = new Set(existingModels.map(model => model.name));
            const newModels = importData.models.filter(model => !existingNames.has(model.name));
            
            customModels = [...existingModels, ...newModels];
            await DatabaseManager.saveData(STORES.CUSTOM_MODELS, "models", customModels);
            
            // Reload environment models if environmentBuilderRef is provided
            if (environmentBuilderRef && environmentBuilderRef.current) {
              await environmentBuilderRef.current.preloadModels();
            }
          }
          
          resolve({
            blocks: customBlocks,
            models: customModels
          });
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => {
        reject(new Error("Error reading file"));
      };
      
      reader.readAsText(file);
    });
  } catch (error) {
    console.error("Error importing asset pack:", error);
    throw error;
  }
};

/**
 * Exports the current map as a JSON file (just the map data, not the full asset pack)
 * @param {Object} terrainBuilderRef Reference to the TerrainBuilder component
 * @returns {Promise<void>}
 */
export const exportMapFile = async (terrainBuilderRef) => {
  try {
    if (!terrainBuilderRef.current.getCurrentTerrainData() || 
        Object.keys(terrainBuilderRef.current.getCurrentTerrainData()).length === 0) {
      alert("No map found to export!");
      return;
    }

    // Get environment data
    const environmentObjects = await DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [];

    // Simplify terrain data to just include block IDs
    const simplifiedTerrain = Object.entries(terrainBuilderRef.current.getCurrentTerrainData()).reduce((acc, [key, value]) => {
      if (key.split(",").length === 3) {
        acc[key] = value.id;
      }
      return acc;
    }, {});

    const allBlockTypes = getBlockTypes();

    // Create the export object
    const exportData = {
      blockTypes: Array.from(
        new Map(
          allBlockTypes.map((block) => [
            block.id,
            {
              id: block.id,
              name: block.name,
              textureUri: block.isMultiTexture ? `blocks/${block.name}` : `blocks/${block.name}.png`,
              isCustom: block.isCustom || false,
            },
          ])
        ).values()
      ),
      blocks: simplifiedTerrain,
      entities: environmentObjects.reduce((acc, obj) => {
        const entityType = environmentModels.find((model) => model.modelUrl === obj.modelUrl);

        if (entityType) {
          const quaternion = new THREE.Quaternion();
          quaternion.setFromEuler(new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z));

          const modelUri = entityType.isCustom ? `models/environment/${entityType.name}.gltf` : obj.modelUrl.replace("assets/", "");

          // Calculate adjusted Y position
          const boundingBoxHeight = entityType.boundingBoxHeight || 1;
          const verticalOffset = (boundingBoxHeight * obj.scale.y) / 2;
          const adjustedY = obj.position.y + 0.5 + verticalOffset;

          // Use adjusted Y in the key
          const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

          acc[key] = {
            modelUri: modelUri,
            modelLoopedAnimations: entityType.animations || ["idle"],
            modelScale: obj.scale.x,
            name: entityType.name,
            rigidBodyOptions: {
              type: "kinematic_velocity",
              rotation: {
                x: quaternion.x,
                y: quaternion.y,
                z: quaternion.z,
                w: quaternion.w,
              },
            },
          };
        }
        return acc;
      }, {}),
    };

    // Convert to JSON and create a blob
    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json" });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "terrain.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting map file:", error);
    alert("Error exporting map. Please try again.");
    throw error;
  }
};

/**
 * Scans the assets directory to get a list of all asset files
 * @returns {Promise<string[]>} A promise that resolves to an array of file paths
 */
const scanDirectory = async () => {
  const context = require.context("../../public/assets", true, /\.(png|jpe?g|glb|gltf|json|wav|mp3|ogg|pem|key|crt)$/);
  return context.keys().map((key) => key.replace("./", ""));
};

/**
 * Exports the current map and all assets as a complete ZIP package
 * @param {Object} terrainBuilderRef Reference to the TerrainBuilder component
 * @returns {Promise<void>}
 */
export const exportFullAssetPack = async (terrainBuilderRef) => {
  try {
    if (!terrainBuilderRef.current.getCurrentTerrainData() || 
        Object.keys(terrainBuilderRef.current.getCurrentTerrainData()).length === 0) {
      alert("No map found to export!");
      return;
    }

    const zip = new JSZip();
    const assetsFolder = zip.folder("assets");
    const blocksFolder = assetsFolder.folder("blocks");
    const mapsFolder = assetsFolder.folder("maps");
    const modelsFolder = assetsFolder.folder("models/environment");
    const certsFolder = assetsFolder.folder("certs");
    const soundsFolder = assetsFolder.folder("sounds");
    const skyboxesFolder = assetsFolder.folder("skyboxes");

    // Add custom GLTF models from IndexedDB
    const customModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models") || [];
    console.log("Custom models to export:", customModels);

    for (const model of customModels) {
      if (!model.data) {
        console.warn(`No data found for model ${model.name}`);
        continue;
      }

      const blob = new Blob([model.data], { type: "model/gltf+json" });
      console.log(`Adding model to zip: ${model.name}.gltf`);
      modelsFolder.file(`${model.name}.gltf`, blob);
    }

    // Get environment data
    const environmentObjects = await DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [];

    // Simplify terrain data
    const simplifiedTerrain = Object.entries(terrainBuilderRef.current.getCurrentTerrainData()).reduce((acc, [key, value]) => {
      if (key.split(",").length === 3) {
        acc[key] = value.id;
      }
      return acc;
    }, {});

    const allBlockTypes = getBlockTypes();

    // Create the export object
    const exportData = {
      blockTypes: Array.from(
        new Map(
          allBlockTypes.map((block) => [
            block.id,
            {
              id: block.id,
              name: block.name,
              textureUri: block.isMultiTexture ? `blocks/${block.name}` : `blocks/${block.name}.png`,
              isCustom: block.isCustom || false,
            },
          ])
        ).values()
      ),
      blocks: simplifiedTerrain,
      entities: environmentObjects.reduce((acc, obj) => {
        const entityType = environmentModels.find((model) => model.modelUrl === obj.modelUrl);

        if (entityType) {
          const quaternion = new THREE.Quaternion();
          quaternion.setFromEuler(new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z));

          const modelUri = entityType.isCustom ? `models/environment/${entityType.name}.gltf` : obj.modelUrl.replace("assets/", "");

          // Calculate adjusted Y position
          const boundingBoxHeight = entityType.boundingBoxHeight || 1;
          const verticalOffset = (boundingBoxHeight * obj.scale.y) / 2;
          const adjustedY = obj.position.y + 0.5 + verticalOffset;

          // Use adjusted Y in the key
          const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

          acc[key] = {
            modelUri: modelUri,
            modelLoopedAnimations: entityType.animations || ["idle"],
            modelScale: obj.scale.x,
            name: entityType.name,
            rigidBodyOptions: {
              type: "kinematic_velocity",
              rotation: {
                x: quaternion.x,
                y: quaternion.y,
                z: quaternion.z,
                w: quaternion.w,
              },
            },
          };
        }
        return acc;
      }, {}),
    };

    // Add terrain.json to the maps folder
    mapsFolder.file("terrain.json", JSON.stringify(exportData, null, 2));

    // Add custom block textures
    const customBlocks = await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks") || [];
    for (const block of customBlocks) {
      const base64Data = block.textureUri.split(",")[1];
      const binaryData = atob(base64Data);
      const array = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        array[i] = binaryData.charCodeAt(i);
      }
      const blob = new Blob([array], { type: "image/png" });
      blocksFolder.file(`${block.name}.png`, blob);
    }

    // Add default assets
    const files = await scanDirectory();
    const promises = [];
    
    for (const filePath of files) {
      const task = new Promise(async (resolve) => {
        try {
          const response = await fetch(`/assets/${filePath}`);
          if (!response.ok) {
            console.warn(`Failed to fetch file ${filePath}`);
            return;
          }

          const blob = await response.blob();

          // Special handling for different asset types
          if (filePath.includes("certs/")) {
            // Just store the cert file directly in the certs folder
            const certFileName = filePath.split("/").pop();
            certsFolder.file(certFileName, blob);
          } else if (filePath.startsWith("sounds/")) {
            soundsFolder.file(filePath.replace("sounds/", ""), blob);
          } else if (filePath.startsWith("skyboxes/")) {
            skyboxesFolder.file(filePath.replace("skyboxes/", ""), blob);
          } else {
            assetsFolder.file(filePath, blob);
          }
        } catch (error) {
          console.warn(`Failed to add file ${filePath}:`, error);
        } finally {
          resolve();
        }
      });
      promises.push(task);
    }

    await Promise.all(promises);
    
    console.log("Folders in zip:", Object.keys(zip.files));
    const content = await zip.generateAsync({ type: "blob" });
    
    // Create download link
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hytopia_build_" + version + "_assets.zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting asset pack:", error);
    alert("Error exporting map. Please try again.");
    throw error;
  }
};

/**
 * Imports a map from a ZIP file containing a complete asset pack
 * @param {File} file The ZIP file to import
 * @param {Object} terrainBuilderRef Reference to the TerrainBuilder component
 * @param {Object} environmentBuilderRef Reference to the EnvironmentBuilder component
 * @returns {Promise<Object>} A promise that resolves to an object containing the imported data
 */
export const importAssetPackZip = async (file, terrainBuilderRef, environmentBuilderRef) => {
  try {
    // Implementation for importing a ZIP file would go here
    // This would involve extracting the ZIP, processing the terrain.json file,
    // and handling any custom assets included in the ZIP
    
    // For now, just show an alert that this feature is not yet implemented
    alert("Importing asset packs from ZIP files is not yet implemented.");
    return {};
  } catch (error) {
    console.error("Error importing asset pack ZIP:", error);
    throw error;
  }
};
