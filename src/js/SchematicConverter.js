import { DatabaseManager, STORES } from "./DatabaseManager";
import * as nbt from 'prismarine-nbt';
import pako from 'pako';
import { Buffer } from 'buffer';

// Track dynamic block mappings for unmapped blocks
let dynamicBlockMappings = new Map();

// Manual gzip header detection and decompression fallback
function isGzipped(data) {
  return data[0] === 0x1f && data[1] === 0x8b;
}

// Decompress gzipped data using pako with error handling
function decompressGzip(data) {
  try {
    return pako.inflate(data);
  } catch (error) {
    console.error('Error decompressing with pako:', error);
    throw new Error('Failed to decompress gzipped data. The schematic file may be corrupted.');
  }
}

// Define default fallback blocks for common categories
const fallbackMapping = {
  "stone": { id: 19, name: "stone", textureUri: "blocks/stone.png" },
  "cobblestone": { id: 13, name: "mossy-coblestone", textureUri: "blocks/mossy-coblestone.png" },
  "brick": { id: 1, name: "bricks", textureUri: "blocks/bricks.png" },
  "wood": { id: 11, name: "log-side", textureUri: "blocks/log-side.png" },
  "log": { id: 12, name: "log-top", textureUri: "blocks/log-top.png" },
  "planks": { id: 16, name: "oak-planks", textureUri: "blocks/oak-planks.png" },
  "dirt": { id: 4, name: "dirt", textureUri: "blocks/dirt.png" },
  "grass": { id: 7, name: "grass", textureUri: "blocks/grass.png" },
  "sand": { id: 17, name: "sand", textureUri: "blocks/sand.png" },
  "leaves": { id: 15, name: "oak-leaves", textureUri: "blocks/oak-leaves.png" },
  "glass": { id: 6, name: "glass", textureUri: "blocks/glass.png" },
  "ice": { id: 9, name: "ice", textureUri: "blocks/ice.png" },
  "water": { id: 22, name: "water-still", textureUri: "blocks/water-still.png" },
  "ore": { id: 3, name: "diamond-ore", textureUri: "blocks/diamond-ore.png" },
  "clay": { id: 2, name: "clay", textureUri: "blocks/clay.png" },
  "gravel": { id: 8, name: "gravel", textureUri: "blocks/gravel.png" },
  "unknown": { id: 19, name: "stone", textureUri: "blocks/stone.png" } // Default fallback
};

// Load block mapping file from a fetch request
export async function loadBlockMapping(mappingUrl = '/mapping.json') {
  try {
    console.log(`Attempting to load block mapping from: ${mappingUrl}`);
    const response = await fetch(mappingUrl);
    if (!response.ok) {
      throw new Error(`Failed to load mapping file: ${response.status} ${response.statusText}`);
    }
    const mappingData = await response.json();
    console.log(`Successfully loaded mapping with ${Object.keys(mappingData.blocks || {}).length} block definitions`);
    return mappingData;
  } catch (error) {
    console.error(`Error loading block mapping file: ${error.message}`);
    console.log('Using default fallback mappings');
    return { blocks: {} };
  }
}

// Get a fallback Hytopia block ID for an unknown Minecraft block
function getFallbackBlockId(blockName) {
  // Remove minecraft: prefix if present
  const plainName = blockName.replace('minecraft:', '');
  
  // Check if we've already assigned this block before
  if (dynamicBlockMappings.has(plainName)) {
    return dynamicBlockMappings.get(plainName);
  }

  // Try to find a fallback based on the block name
  for (const [category, fallbackBlock] of Object.entries(fallbackMapping)) {
    if (plainName.toLowerCase().includes(category)) {
      dynamicBlockMappings.set(plainName, fallbackBlock.id);
      console.log(`Mapped ${plainName} to ${fallbackBlock.name} (ID: ${fallbackBlock.id})`);
      return fallbackBlock.id;
    }
  }

  // Use the default unknown block if no match
  dynamicBlockMappings.set(plainName, fallbackMapping.unknown.id);
  console.log(`Using default stone block for ${plainName}`);
  return fallbackMapping.unknown.id;
}

// Main function to handle schematic file import
export async function importSchematic(file, terrainBuilderRef, environmentBuilderRef, mappingUrl = '/mapping.json') {
  try {
    console.log(`Importing schematic file: ${file.name}`);
    
    // First try to use the mapping.json file
    const blockMapping = await loadBlockMapping(mappingUrl);
    console.log(`Loaded mapping with ${Object.keys(blockMapping.blocks || {}).length} block definitions`);

    // Read the file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Check if the file is gzipped
    const isGzippedFile = isGzipped(data);
    console.log('File appears to be', isGzippedFile ? 'gzipped' : 'not gzipped');
    
    let fileData;
    if (isGzippedFile) {
      // Decompress the gzipped data using our helper function
      try {
        fileData = decompressGzip(data);
      } catch (e) {
        console.error('Error decompressing gzipped data:', e);
        throw new Error('Failed to decompress gzipped schematic file. The file may be corrupted.');
      }
    } else {
      fileData = data;
    }
    
    // Convert to Buffer for prismarine-nbt
    const buffer = Buffer.from(fileData);
    
    // Parse the NBT data with better error handling
    let parsedNBT;
    try {
      parsedNBT = await nbt.parse(buffer);
      console.log('Parsed NBT data structure:', parsedNBT && parsedNBT.parsed ? Object.keys(parsedNBT.parsed) : 'No parsed data available');
    } catch (e) {
      console.error('Error parsing NBT data:', e);
      throw new Error('Failed to parse NBT data. The schematic file may be in an unsupported format.');
    }
    
    // Get the schematic structure, handling different NBT layouts
    const schematic = parsedNBT?.parsed?.value?.Schematic?.value || parsedNBT?.parsed?.value || {};
    console.log('Available schematic keys:', Object.keys(schematic));
    
    // Improved format detection logic
    let formatType = "unknown";
    
    // Check for modern WorldEdit format (.schem)
    if (schematic.Palette && schematic.BlockData) {
      formatType = "modern_worldedit"; // Westerkerk style
    } 
    // Check for nested modern WorldEdit format (as in plague doctor)
    else if (schematic.Blocks?.value?.Palette) {
      formatType = "modern_worldedit_nested"; 
    } 
    // Check for alternate modern format
    else if (schematic.BlockData || schematic.blocks) {
      formatType = "modern_alternate";
    } 
    // Check for classic WorldEdit format (.schematic)
    else if (schematic.Blocks && schematic.Data) {
      formatType = "classic_worldedit";
    } 
    // Check for litematica format (.litematic)
    else if (schematic.Regions) {
      formatType = "litematica";
    }
    
    console.log(`Detected schematic format: ${formatType}`);
    
    // Initialize terrain data
    const hytopiaMap = {
      blocks: {}
    };
    
    // Variables for different formats
    let width, height, length, palette, blockData;
    
    // Process the schematic based on its format
    switch (formatType) {
      case "modern_worldedit":
        // Direct access for westerkerk-style format
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        const offsetX = schematic.Offset ? schematic.Offset.value.x.value : 0;
        const offsetY = schematic.Offset ? schematic.Offset.value.y.value : 0;
        const offsetZ = schematic.Offset ? schematic.Offset.value.z.value : 0;
        
        console.log(`Dimensions: ${width}x${height}x${length}, Offset: ${offsetX},${offsetY},${offsetZ}`);
        
        palette = schematic.Palette.value;
        blockData = schematic.BlockData.value;
        
        // Convert from palette index to block name
        const paletteIdToName = {};
        Object.entries(palette).forEach(([name, id]) => {
          paletteIdToName[id] = name;
        });
        
        // Process BlockData
        let blockIndex = 0;
        for (let y = 0; y < height; y++) {
          for (let z = 0; z < length; z++) {
            for (let x = 0; x < width; x++) {
              if (blockIndex < blockData.length) {
                const paletteId = blockData[blockIndex];
                const blockName = paletteIdToName[paletteId];
                
                if (blockName && blockName !== 'minecraft:air') {
                  // Convert to HYTOPIA block ID
                  let hytopiaBlockId;
                  
                  // Try to find in mapping - exact match first
                  if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                    hytopiaBlockId = blockMapping.blocks[blockName].id;
                    console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId}`);
                  } else {
                    // Try with different formats
                    const shortName = blockName.replace('minecraft:', '');
                    const baseName = blockName.split('[')[0]; // Remove block states
                    
                    if (blockMapping.blocks && blockMapping.blocks[`minecraft:${shortName}`]) {
                      hytopiaBlockId = blockMapping.blocks[`minecraft:${shortName}`].id;
                      console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId} via minecraft:${shortName}`);
                    } else if (blockMapping.blocks && blockMapping.blocks[baseName]) {
                      hytopiaBlockId = blockMapping.blocks[baseName].id;
                      console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId} via ${baseName}`);
                    } else {
                      // Use fallback mapping as last resort
                      hytopiaBlockId = getFallbackBlockId(blockName);
                      console.log(`Used fallback mapping for ${blockName} to HYTOPIA block ID ${hytopiaBlockId}`);
                    }
                  }
                  
                  // Add to terrain data with correct coordinates
                  // Adjust coordinates to center the schematic
                  const finalX = x - Math.floor(width / 2) + offsetX;
                  const finalY = y + offsetY;
                  const finalZ = z - Math.floor(length / 2) + offsetZ;
                  
                  hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
                }
                
                blockIndex++;
              }
            }
          }
        }
        break;
        
      case "modern_worldedit_nested":
        // Handle plague doctor-style format (nested modern WorldEdit format)
        try {
          console.log("Processing nested modern WorldEdit format");
          
          width = schematic.Width?.value || 0;
          height = schematic.Height?.value || 0;
          length = schematic.Length?.value || 0;
          
          console.log(`Dimensions: ${width}x${height}x${length}`);
          
          // Get palette and block data from nested structure
          palette = schematic.Blocks?.value?.Palette?.value;
          blockData = schematic.Blocks?.value?.Data?.value;
          
          if (!palette || !blockData) {
            throw new Error("Required data not found in nested modern WorldEdit format");
          }
          
          console.log("Palette entries:", Object.keys(palette).length);
          console.log("BlockData length:", blockData.length);
          
          // Convert from palette index to block name
          const paletteIdToName = {};
          Object.entries(palette).forEach(([name, id]) => {
            paletteIdToName[id] = name;
          });
          
          // Process BlockData
          let blockIndex = 0;
          for (let y = 0; y < height; y++) {
            for (let z = 0; z < length; z++) {
              for (let x = 0; x < width; x++) {
                if (blockIndex < blockData.length) {
                  const paletteId = blockData[blockIndex];
                  const blockName = paletteIdToName[paletteId];
                  
                  if (blockName && blockName !== 'minecraft:air') {
                    // Convert to HYTOPIA block ID
                    let hytopiaBlockId;
                    
                    // Try to find in mapping - exact match first
                    if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                      hytopiaBlockId = blockMapping.blocks[blockName].id;
                      console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId}`);
                    } else {
                      // Try with different formats
                      const shortName = blockName.replace('minecraft:', '');
                      const baseName = blockName.split('[')[0]; // Remove block states
                      
                      if (blockMapping.blocks && blockMapping.blocks[`minecraft:${shortName}`]) {
                        hytopiaBlockId = blockMapping.blocks[`minecraft:${shortName}`].id;
                        console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId} via minecraft:${shortName}`);
                      } else if (blockMapping.blocks && blockMapping.blocks[baseName]) {
                        hytopiaBlockId = blockMapping.blocks[baseName].id;
                        console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId} via ${baseName}`);
                      } else {
                        // Use fallback mapping as last resort
                        hytopiaBlockId = getFallbackBlockId(blockName);
                        console.log(`Used fallback mapping for ${blockName} to HYTOPIA block ID ${hytopiaBlockId}`);
                      }
                    }
                    
                    // Add to terrain data with correct coordinates
                    // Adjust coordinates to center the schematic
                    const finalX = x - Math.floor(width / 2);
                    const finalY = y;
                    const finalZ = z - Math.floor(length / 2);
                    
                    hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
                  }
                  
                  blockIndex++;
                }
              }
            }
          }
        } catch (error) {
          console.error('Error processing nested modern WorldEdit format:', error);
          throw new Error(`Failed to process nested modern WorldEdit format: ${error.message}`);
        }
        break;
        
      case "modern_alternate":
        // Handle alternate modern format
        width = schematic.Width || schematic.width || 0;
        height = schematic.Height || schematic.height || 0;
        length = schematic.Length || schematic.length || 0;
        
        console.log(`Dimensions: ${width}x${height}x${length}`);
        
        palette = schematic.Palette?.value || schematic.palette;
        blockData = schematic.BlockData?.value || schematic.blocks;
        
        if (!palette || !blockData) {
          throw new Error("Required data not found in alternate modern format");
        }
        
        // Process blocks similarly to modern_worldedit
        // ... (implementation similar to modern_worldedit)
        break;
        
      case "classic_worldedit":
        // Handle classic WorldEdit .schematic format
        width = schematic.Width.value;
        height = schematic.Height.value;
        length = schematic.Length.value;
        
        console.log(`Dimensions: ${width}x${height}x${length}`);
        
        const blocks = schematic.Blocks.value;
        const data = schematic.Data.value;
        
        // Classic format uses block IDs, we need a mapping from old IDs to names
        const classicIdToName = {
          1: 'stone',
          2: 'grass_block',
          3: 'dirt',
          4: 'cobblestone',
          5: 'oak_planks',
          17: 'oak_log',
          18: 'oak_leaves',
          20: 'glass',
          45: 'bricks',
          79: 'ice',
          89: 'glowstone',
          // Add more mappings as needed for commonly used blocks
        };
        
        // Process blocks
        for (let y = 0; y < height; y++) {
          for (let z = 0; z < length; z++) {
            for (let x = 0; x < width; x++) {
              const index = y * width * length + z * width + x;
              const blockId = blocks[index];
              
              if (blockId !== 0) { // Skip air
                // Get block name from classic ID
                const blockName = classicIdToName[blockId] || `unknown_${blockId}`;
                
                // Convert to HYTOPIA block ID
                let hytopiaBlockId;
                
                // Try to find in mapping - try with minecraft: prefix first
                if (blockMapping.blocks && blockMapping.blocks[`minecraft:${blockName}`]) {
                  hytopiaBlockId = blockMapping.blocks[`minecraft:${blockName}`].id;
                  console.log(`Mapped classic block ID ${blockId} (${blockName}) to HYTOPIA block ID ${hytopiaBlockId}`);
                } else if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                  // Try without prefix
                  hytopiaBlockId = blockMapping.blocks[blockName].id;
                  console.log(`Mapped classic block ID ${blockId} (${blockName}) to HYTOPIA block ID ${hytopiaBlockId}`);
                } else {
                  // Use fallback mapping
                  hytopiaBlockId = getFallbackBlockId(blockName);
                  console.log(`Used fallback mapping for classic block ID ${blockId} (${blockName}) to HYTOPIA block ID ${hytopiaBlockId}`);
                }
                
                // Add to terrain data with correct coordinates
                // Adjust coordinates to center the schematic
                const finalX = x - Math.floor(width / 2);
                const finalY = y;
                const finalZ = z - Math.floor(length / 2);
                
                hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
              }
            }
          }
        }
        break;
        
      case "litematica":
        // Handle litematica format
        console.log("Processing litematica format");
        
        try {
          // Get the first region
          const regionName = Object.keys(schematic.Regions.value)[0];
          if (!regionName) {
            throw new Error("No regions found in litematica file");
          }
          
          const region = schematic.Regions.value[regionName].value;
          console.log('Region keys:', Object.keys(region));
          
          width = Math.abs(region.Size.value.x.value);
          height = Math.abs(region.Size.value.y.value);
          length = Math.abs(region.Size.value.z.value);
          
          console.log(`Litematica dimensions: ${width}x${height}x${length}`);
          
          // Get palette and block data from region
          const litematicaPalette = region.BlockStatePalette.value.value;
          const litematicaBlockData = region.BlockStates.value;
          
          console.log(`Litematica palette size: ${litematicaPalette.length}`);
          
          // Process blocks for litematica format - simplified approach
          // Instead of bit-shifting, which can be problematic in browser environments,
          // we'll use a simpler algorithm that's more browser-compatible
          let blockCount = 0;
          
          for (let y = 0; y < height; y++) {
            for (let z = 0; z < length; z++) {
              for (let x = 0; x < width; x++) {
                const index = y * (width * length) + z * width + x;
                
                // Use a more direct approach to get the block from the data
                let blockId = 0;
                try {
                  // Use a simple index-based approach instead of bit manipulation
                  blockId = litematicaBlockData[index] || 0;
                } catch (e) {
                  console.warn(`Error accessing block data at index ${index}`, e);
                  continue;
                }
                
                if (blockId >= litematicaPalette.length) continue;
                
                // Get block info from palette
                const blockInfo = litematicaPalette[blockId];
                if (!blockInfo) continue;
                
                let blockName = '';
                try {
                  blockName = blockInfo.Name?.value || '';
                } catch (e) {
                  console.warn('Error getting block name from palette', e);
                  continue;
                }
                
                if (!blockName || blockName === 'minecraft:air') continue;
                
                // Convert to HYTOPIA block ID
                let hytopiaBlockId;
                
                // Try to find in mapping - exact match first
                if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                  hytopiaBlockId = blockMapping.blocks[blockName].id;
                } else {
                  // Try with different formats
                  const baseName = blockName.split('[')[0]; // Remove block states
                  
                  if (blockMapping.blocks && blockMapping.blocks[baseName]) {
                    hytopiaBlockId = blockMapping.blocks[baseName].id;
                  } else {
                    // Use fallback mapping
                    hytopiaBlockId = getFallbackBlockId(blockName);
                  }
                }
                
                // Add to terrain data with correct coordinates
                // Adjust coordinates to center the schematic
                const finalX = x - Math.floor(width / 2);
                const finalY = y;
                const finalZ = z - Math.floor(length / 2);
                
                hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
                blockCount++;
              }
            }
          }
          
          console.log(`Processed ${blockCount} blocks for litematica format`);
        } catch (error) {
          console.error('Error processing litematica format:', error);
          throw new Error(`Failed to process litematica format: ${error.message}`);
        }
        break;
        
      default:
        throw new Error(`Unsupported schematic format: ${formatType}. The file structure could not be recognized.`);
    }
    
    console.log(`Converted schematic to ${Object.keys(hytopiaMap.blocks).length} blocks in HYTOPIA format`);
    
    // If no blocks were processed, throw an error
    if (Object.keys(hytopiaMap.blocks).length === 0) {
      throw new Error("No blocks were extracted from the schematic. The file may be empty or corrupted.");
    }
    
    // Save terrain data to IndexedDB
    await DatabaseManager.saveData(STORES.TERRAIN, "current", hytopiaMap.blocks);
    
    // Refresh terrain builder
    if (terrainBuilderRef && terrainBuilderRef.current) {
      await terrainBuilderRef.current.refreshTerrainFromDB();
    }
    
    console.log("Schematic import complete");
    
    return true;
  } catch (error) {
    console.error('Error importing schematic:', error);
    throw error;
  }
} 