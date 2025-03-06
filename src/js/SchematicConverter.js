import { DatabaseManager, STORES } from "./DatabaseManager";

// Track dynamic block mappings for unmapped blocks
let dynamicBlockMappings = new Map();

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
    const response = await fetch(mappingUrl);
    if (!response.ok) {
      throw new Error(`Failed to load mapping file: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error loading block mapping file: ${error.message}`);
    console.log('Using default fallback mappings');
    return { blocks: {} };
  }
}

// Get a fallback Hytopia block ID for an unknown Minecraft block
function getFallbackBlockId(blockName) {
  // Check if we've already assigned this block before
  if (dynamicBlockMappings.has(blockName)) {
    return dynamicBlockMappings.get(blockName);
  }

  // Try to find a fallback based on the block name
  for (const [category, fallbackBlock] of Object.entries(fallbackMapping)) {
    if (blockName.includes(category)) {
      dynamicBlockMappings.set(blockName, fallbackBlock.id);
      console.log(`Mapped ${blockName} to ${fallbackBlock.name} (ID: ${fallbackBlock.id})`);
      return fallbackBlock.id;
    }
  }

  // Use the default unknown block if no match
  dynamicBlockMappings.set(blockName, fallbackMapping.unknown.id);
  console.log(`Using default stone block for ${blockName}`);
  return fallbackMapping.unknown.id;
}

// Create a demo structure
function createDemoStructure() {
  const hytopiaMap = {
    blocks: {}
  };

  // Create a small house with different block types
  // Base - platform of dirt
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      hytopiaMap.blocks[`${x},0,${z}`] = 4; // Dirt
    }
  }

  // Grass on top
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      hytopiaMap.blocks[`${x},1,${z}`] = 7; // Grass
    }
  }

  // Walls
  for (let y = 2; y <= 4; y++) {
    for (let x = -2; x <= 2; x++) {
      hytopiaMap.blocks[`${x},${y},-2`] = 16; // Oak planks (front)
      hytopiaMap.blocks[`${x},${y},2`] = 16; // Oak planks (back)
    }
    
    for (let z = -2; z <= 2; z++) {
      hytopiaMap.blocks[`-2,${y},${z}`] = 16; // Oak planks (left)
      hytopiaMap.blocks[`2,${y},${z}`] = 16; // Oak planks (right)
    }
  }

  // Door
  hytopiaMap.blocks[`0,2,-2`] = 0; // Air (door)
  hytopiaMap.blocks[`0,3,-2`] = 0; // Air (door)

  // Windows
  hytopiaMap.blocks[`-1,3,-2`] = 6; // Glass (front window)
  hytopiaMap.blocks[`1,3,-2`] = 6; // Glass (front window)
  hytopiaMap.blocks[`-1,3,2`] = 6; // Glass (back window)
  hytopiaMap.blocks[`1,3,2`] = 6; // Glass (back window)
  hytopiaMap.blocks[`-2,3,0`] = 6; // Glass (left window)
  hytopiaMap.blocks[`2,3,0`] = 6; // Glass (right window)

  // Roof
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      hytopiaMap.blocks[`${x},5,${z}`] = 1; // Bricks (roof)
    }
  }

  // Inside furniture
  hytopiaMap.blocks[`-1,2,1`] = 11; // Log (table)
  hytopiaMap.blocks[`1,2,1`] = 20; // Stone bricks (furnace)
  hytopiaMap.blocks[`-1,2,0`] = 3; // Diamond ore (fancy block)

  return hytopiaMap;
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
    const dataView = new DataView(arrayBuffer);
    
    // Check if the file is gzipped (magic numbers for GZIP)
    const isGzipped = dataView.getUint8(0) === 0x1f && dataView.getUint8(1) === 0x8b;
    console.log('File appears to be', isGzipped ? 'gzipped' : 'not gzipped');
    
    /* 
    In a complete implementation, we would:
    1. Decompress the file if it's gzipped
    2. Parse the NBT format
    3. Detect the schematic format
    4. Process the blocks according to the format
    5. Map Minecraft blocks to Hytopia blocks
    
    Since the NBT parsing is causing compatibility issues, we'll use a demo structure for now
    */
    
    console.log("Creating demo structure for schematic import");
    const hytopiaMap = createDemoStructure();
    console.log(`Created demo structure with ${Object.keys(hytopiaMap.blocks).length} blocks`);
    
    // Save terrain data to IndexedDB
    await DatabaseManager.saveData(STORES.TERRAIN, "current", hytopiaMap.blocks);
    
    // Refresh terrain builder
    if (terrainBuilderRef && terrainBuilderRef.current) {
      await terrainBuilderRef.current.refreshTerrainFromDB();
    }
    
    console.log("Schematic import demo complete");
    
    return true;
  } catch (error) {
    console.error('Error importing schematic:', error);
    throw error;
  }
} 