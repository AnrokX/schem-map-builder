import { DatabaseManager, STORES } from "./DatabaseManager";
import { getBlockTypes, addCustomBlocks } from "./TerrainBuilder";
import { environmentModels } from "./EnvironmentBuilder";
import * as THREE from "three";
import JSZip from "jszip";
import { version } from "./Constants";


export const importMap = async (file, terrainBuilderRef, environmentBuilderRef) => {
  try {
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          // get the data from the event, and convert it to a json object
          const importData = JSON.parse(event.target.result);

          console.log(importData);
          
          let terrainData = {};
          let environmentData = [];
          
          // Lets make sure there is data at all
          if (importData.blocks) {
              
            /// process any custom blocks
            addCustomBlocks(importData.blockTypes);

            // Now process terrain data
            terrainData = Object.entries(importData.blocks).reduce((acc, [key, blockId]) => {
              acc[key] = blockId;
              return acc;
            }, {});
            
            // Convert entities to environment format
            if (importData.entities) {
              environmentData = Object.entries(importData.entities)
                .map(([key, entity], index) => {
                  const [x, y, z] = key.split(',').map(Number);
                  
                  // Convert rotation from quaternion to euler angles
                  const quaternion = new THREE.Quaternion(
                    entity.rigidBodyOptions.rotation.x,
                    entity.rigidBodyOptions.rotation.y,
                    entity.rigidBodyOptions.rotation.z,
                    entity.rigidBodyOptions.rotation.w
                  );
                  const euler = new THREE.Euler().setFromQuaternion(quaternion);

                  // Get model name from the file path
                  const modelName = entity.modelUri.split('/').pop().replace('.gltf', '');
                  const matchingModel = environmentModels.find(model => model.name === modelName);
                  console.log(matchingModel);

                  // Calculate the vertical offset to subtract
                  const boundingBoxHeight = matchingModel?.boundingBoxHeight || 1;
                  const verticalOffset = (boundingBoxHeight * entity.modelScale) / 2;
                  const adjustedY = y - 0.5 - verticalOffset;

                  return {
                    position: { x, y: adjustedY, z },
                    rotation: { x: euler.x, y: euler.y, z: euler.z },
                    scale: { x: entity.modelScale, y: entity.modelScale, z: entity.modelScale },
                    modelUrl: matchingModel ? matchingModel.modelUrl : `assets/${entity.modelUri}`,
                    name: modelName,
                    modelLoopedAnimations: entity.modelLoopedAnimations || ["idle"],
                    // Add instanceId to each object - this is critical!
                    instanceId: index // Use the array index as a unique ID
                  };
                })
                .filter(obj => obj !== null);
              
              console.log(`Imported ${environmentData.length} environment objects`);
            }
          } else {
            alert("Invalid map file format - no valid map data found");
            return;
          }
          
          // Save terrain data
          await DatabaseManager.saveData(STORES.TERRAIN, "current", terrainData);
          
          // Save environment data
          await DatabaseManager.saveData(STORES.ENVIRONMENT, "current", environmentData);
          
          // Refresh terrain and environment builders
          if (terrainBuilderRef && terrainBuilderRef.current) {
            await terrainBuilderRef.current.refreshTerrainFromDB();
          }
          
          if (environmentBuilderRef && environmentBuilderRef.current) {
            // Wait for environment refresh to complete
            await environmentBuilderRef.current.refreshEnvironmentFromDB();
          }
          
          resolve();
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
    alert("Error importing map. Please try again.");
    throw error;
  }
};

export const importAssetPack = async (file, environmentBuilderRef) => {
  try {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const importData = JSON.parse(event.target.result);
          
          // No version validation needed
          
          let customBlocks = [];
          let customModels = [];
          
          // Import custom blocks if they exist
          if (importData.blocks && importData.blocks.length > 0) {
            // Get existing custom blocks
            const existingBlocks = await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks") || [];
            
            // Process custom blocks to handle missing textures
            const processedBlocks = importData.blocks.map(block => {
              // Check if the block has a valid texture URI (data URL)
              if (!block.textureUri || !block.textureUri.startsWith('data:image')) {
                // Use placeholder texture for blocks without valid texture data
                return {
                  ...block,
                  textureUri: './assets/blocks/error.png',
                  needsTexture: true // Flag to indicate this block needs a texture upload
                };
              }
              return block;
            });
            
            // Merge existing and new blocks, avoiding duplicates by ID
            const existingIds = new Set(existingBlocks.map(block => block.id));
            const newBlocks = processedBlocks.filter(block => !existingIds.has(block.id));
            
            customBlocks = [...existingBlocks, ...newBlocks];
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, "blocks", customBlocks);
            
            // Update block types with the imported custom blocks
            //addCustomBlocks(customBlocks);
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
          
          resolve();
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
        acc[key] = value;
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
              isMultiTexture: block.isMultiTexture || false,
              sideTextures: block.sideTextures || {},
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
        acc[key] = value;
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
              textureUri: block.textureUri,
              isCustom: block.isCustom || false,
              isMultiTexture: block.isMultiTexture || false,
              sideTextures: block.sideTextures || {},
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

const scanDirectory = async () => {
  const context = require.context("../../public/assets", true, /\.(png|jpe?g|glb|gltf|json|wav|mp3|ogg|pem|key|crt)$/);
  return context.keys().map((key) => key.replace("./", ""));
};
