import { DatabaseManager, STORES } from "../src/js/DatabaseManager";
import * as nbt from 'prismarine-nbt';
import pako from 'pako';
import { Buffer } from 'buffer';

// Helper functions imported from SchematicConverter.js
function isGzipped(data) {
  return data[0] === 0x1f && data[1] === 0x8b;
}

function decompressGzip(data) {
  try {
    return pako.inflate(data);
  } catch (error) {
    console.error('Error decompressing with pako:', error);
    throw new Error('Failed to decompress gzipped data. The schematic file may be corrupted.');
  }
}

// Fallback mappings for blocks
const fallbackMapping = {
  unknown: { id: 37, name: "stone" },
  stone: { id: 37, name: "stone" },
  dirt: { id: 8, name: "dirt" },
  grass: { id: 16, name: "grass" },
  planks: { id: 28, name: "oak-planks" },
  log: { id: 23, name: "log" },
  leaves: { id: 22, name: "leaves" },
  glass: { id: 14, name: "glass" },
  wool: { id: 43, name: "water-still" },
  terracotta: { id: 37, name: "stone" },
  concrete: { id: 37, name: "stone" },
  ore: { id: 24, name: "ore" },
  sand: { id: 34, name: "sand" },
  water: { id: 43, name: "water-still" },
  wood: { id: 28, name: "oak-planks" },
  brick: { id: 1, name: "bricks" }
};

// Global map to track dynamic block mappings for the session
const dynamicBlockMappings = new Map();

// Get a fallback Hytopia block ID for an unknown Minecraft block
function getFallbackBlockId(blockName) {
  // Remove minecraft: prefix if present
  const plainName = blockName.replace('minecraft:', '');
  
  // Check if we've already assigned this block before
  if (dynamicBlockMappings.has(plainName)) {
    return dynamicBlockMappings.get(plainName);
  }

  console.log(`Finding fallback for unmapped block: ${plainName}`);

  // Try to find a fallback based on the block name
  for (const [category, fallbackBlock] of Object.entries(fallbackMapping)) {
    if (category !== 'unknown' && plainName.toLowerCase().includes(category)) {
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

// Create a tracker for unmapped blocks
const unmappedBlockTracker = {
  blocks: {},  // Will hold info about each unmapped block type
  
  // Track an unmapped block
  trackBlock: function(blockName, position, fallbackId) {
    // Create entry if it doesn't exist
    if (!this.blocks[blockName]) {
      this.blocks[blockName] = {
        count: 0,
        positions: [],
        fallbackId: fallbackId
      };
    }
    
    // Increment counter
    this.blocks[blockName].count++;
    
    // Store sample positions (up to 5)
    if (this.blocks[blockName].positions.length < 5) {
      this.blocks[blockName].positions.push(position);
    }
  },
  
  // Check if we have any unmapped blocks
  hasUnmappedBlocks: function() {
    return Object.keys(this.blocks).length > 0;
  },
  
  // Reset the tracker
  reset: function() {
    this.blocks = {};
  }
};

// Create and manage progress bar UI
function createProgressBar() {
  let progressBar = document.getElementById('schematic-import-progress');
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.id = 'schematic-import-progress';
    progressBar.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 300px;
      padding: 20px;
      background: rgba(0, 0, 0, 0.8);
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      display: none;
      z-index: 9999;
      text-align: center;
    `;

    const messageText = document.createElement('div');
    messageText.id = 'schematic-import-message';
    messageText.style.cssText = `
      color: white;
      font-size: 14px;
      font-family: Arial, sans-serif;
      margin-bottom: 10px;
    `;
    messageText.textContent = 'Importing Litematic';

    const progressBarContainer = document.createElement('div');
    progressBarContainer.style.cssText = `
      width: 100%;
      height: 20px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 10px;
    `;

    const progressFill = document.createElement('div');
    progressFill.id = 'schematic-import-progress-fill';
    progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: #4CAF50;
      transition: width 0.3s ease;
    `;

    const progressText = document.createElement('div');
    progressText.id = 'schematic-import-progress-text';
    progressText.style.cssText = `
      color: white;
      font-size: 14px;
      font-family: Arial, sans-serif;
      margin-top: 5px;
    `;

    progressBarContainer.appendChild(progressFill);
    progressBar.appendChild(messageText);
    progressBar.appendChild(progressBarContainer);
    progressBar.appendChild(progressText);
    document.body.appendChild(progressBar);
  }
  return progressBar;
}

function updateProgressBar(progress) {
  const progressBar = document.getElementById('schematic-import-progress');
  const progressFill = document.getElementById('schematic-import-progress-fill');
  const progressText = document.getElementById('schematic-import-progress-text');
  
  if (progressBar && progressFill && progressText) {
    progressBar.style.display = 'block';
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `${progress}% Complete`;
    
    if (progress >= 100) {
      progressText.textContent = 'Import Complete!';
      setTimeout(() => {
        progressBar.style.display = 'none';
      }, 1000);
    }
  }
}

// Load block mapping file from a fetch request
export async function loadBlockMapping(mappingUrl = '/mapping.json') {
  try {
    // Ensure the URL is properly formatted
    let fullUrl = mappingUrl;
    if (!fullUrl.startsWith('http') && !fullUrl.startsWith('/')) {
      fullUrl = '/' + fullUrl;
    }
    
    console.log(`Attempting to load block mapping from: ${fullUrl}`);
    
    // Try several approaches to load the mapping file
    let response;
    try {
      // First attempt with the provided URL
      response = await fetch(fullUrl);
      if (!response.ok) {
        // If that fails, try with the absolute path from the root
        console.log(`Trying alternative path: /mapping.json`);
        response = await fetch('/mapping.json');
      }
    } catch (err) {
      // If fetch fails completely, try with a relative path
      console.log(`Fetch failed, trying with relative path: ./mapping.json`);
      response = await fetch('./mapping.json');
    }
    
    if (!response || !response.ok) {
      throw new Error(`Failed to load mapping file: ${response ? response.status + ' ' + response.statusText : 'No response'}`);
    }
    
    const mappingData = await response.json();
    console.log(`Successfully loaded mapping with ${Object.keys(mappingData.blocks || {}).length} block definitions`);
    
    // Debug the content of the loaded mapping
    console.log('First few block mappings:', 
      Object.entries(mappingData.blocks || {}).slice(0, 3)
        .map(([name, data]) => `${name} -> ID ${data.id}`).join(', '));
    
    return mappingData;
  } catch (error) {
    console.error(`Error loading block mapping file: ${error.message}`);
    console.log('Using default fallback mappings');
    // Instead of returning an empty object, return a minimal mapping for common blocks
    return { 
      blocks: {
        "minecraft:stone": { id: 19, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
        "minecraft:dirt": { id: 4, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
        "minecraft:grass_block": { id: 7, hytopiaBlock: "grass", textureUri: "blocks/grass.png" },
        "minecraft:oak_planks": { id: 16, hytopiaBlock: "oak-planks", textureUri: "blocks/oak-planks.png" },
        "minecraft:oak_log": { id: 11, hytopiaBlock: "log", textureUri: "blocks/log.png" },
        "minecraft:glass": { id: 6, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
        "minecraft:bricks": { id: 1, hytopiaBlock: "bricks", textureUri: "blocks/bricks.png" },
        "minecraft:black_wool": { id: 19, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
        "minecraft:white_wool": { id: 22, hytopiaBlock: "water-still", textureUri: "blocks/water-still.png" },
        "minecraft:red_wool": { id: 1, hytopiaBlock: "bricks", textureUri: "blocks/bricks.png" },
        "minecraft:brown_wool": { id: 4, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
        "minecraft:brown_concrete": { id: 4, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
        "minecraft:white_concrete": { id: 6, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
        "minecraft:black_concrete": { id: 19, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
        "minecraft:white_concrete_powder": { id: 6, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
        "minecraft:coal_block": { id: 19, hytopiaBlock: "stone", textureUri: "blocks/stone.png" }
      }
    };
  }
}

// Primary function to handle litematic import
export async function importLitematic(file, terrainBuilderRef, environmentBuilderRef, mappingUrl = '/mapping.json', regionSelection = null) {
  try {
    console.log(`Importing litematic file: ${file.name}`);
    
    // Region selection validation
    if (regionSelection) {
      console.log(`Using region selection: min(${regionSelection.minX}, ${regionSelection.minY}, ${regionSelection.minZ}), max(${regionSelection.maxX}, ${regionSelection.maxY}, ${regionSelection.maxZ})`);
    } else {
      console.log('Importing entire litematic (no region selection)');
    }
    
    // Reset the unmapped block tracker
    unmappedBlockTracker.reset();
    
    // Initialize offset variables
    let offsetX = 0, offsetY = 0, offsetZ = 0;
    
    // Load block mapping
    let blockMapping = await loadBlockMapping(mappingUrl);
    console.log(`Loaded mapping with ${Object.keys(blockMapping.blocks || {}).length} block definitions`);

    // Read the file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Check if the file is gzipped
    const isGzippedFile = isGzipped(data);
    console.log('File appears to be', isGzippedFile ? 'gzipped' : 'not gzipped');
    
    let fileData;
    if (isGzippedFile) {
      // Decompress the gzipped data
      try {
        fileData = decompressGzip(data);
      } catch (e) {
        console.error('Error decompressing gzipped data:', e);
        throw new Error('Failed to decompress gzipped litematic file. The file may be corrupted.');
      }
    } else {
      fileData = data;
    }
    
    // Convert to Buffer for prismarine-nbt
    const buffer = Buffer.from(fileData);
    
    // Parse the NBT data
    let parsedNBT;
    try {
      parsedNBT = await nbt.parse(buffer);
      console.log('Parsed NBT data structure:', parsedNBT && parsedNBT.parsed ? Object.keys(parsedNBT.parsed) : 'No parsed data available');
    } catch (e) {
      console.error('Error parsing NBT data:', e);
      throw new Error('Failed to parse NBT data. The litematic file may be corrupted.');
    }
    
    // Get the schematic structure
    const schematic = parsedNBT?.parsed?.value?.Schematic?.value || parsedNBT?.parsed?.value || {};
    console.log('Available schematic keys:', Object.keys(schematic));
    
    // Verify this is a litematic format
    if (!schematic.Regions || !schematic.Regions.value) {
      throw new Error('This does not appear to be a valid litematic file');
    }
    
    // Initialize terrain data
    const hytopiaMap = {
      blocks: {}
    };
    
    // Process the litematic format
    console.log("Processing litematic format");
    
    try {
      // Get the first region
      const regionName = Object.keys(schematic.Regions.value)[0];
      if (!regionName) {
        throw new Error("No regions found in litematic file");
      }
      
      const region = schematic.Regions.value[regionName].value;
      console.log('Region keys:', Object.keys(region));
      
      const width = Math.abs(region.Size?.value?.x?.value || 0);
      const height = Math.abs(region.Size?.value?.y?.value || 0);
      const length = Math.abs(region.Size?.value?.z?.value || 0);
      
      console.log(`Litematica dimensions: ${width}x${height}x${length}`);
      
      // Get palette and block data from region
      const litematicaPalette = region.BlockStatePalette?.value?.value || [];
      const litematicaBlockData = region.BlockStates?.value || [];
      
      console.log(`Litematica palette size: ${litematicaPalette.length}`);
      
      // Create progress bar at start
      createProgressBar();
      updateProgressBar(0);
      
      // Process blocks for litematica format
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
            let isUnmappedBlock = false;
            
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
                isUnmappedBlock = true;
              }
            }
            
            // Always use a default fallback if we still don't have a valid ID
            if (!hytopiaBlockId) {
              hytopiaBlockId = fallbackMapping.unknown.id;
              isUnmappedBlock = true;
              console.log(`Using default stone block for ${blockName} as last resort`);
            }
            
            // Add to terrain data with correct coordinates
            // Adjust coordinates to center the schematic
            const finalX = x - Math.floor(width / 2) + offsetX;
            const finalY = y + offsetY;
            const finalZ = z - Math.floor(length / 2) + offsetZ;
            
            const positionKey = `${finalX},${finalY},${finalZ}`;
            
            // Track unmapped block if necessary
            if (isUnmappedBlock) {
              unmappedBlockTracker.trackBlock(blockName, positionKey, hytopiaBlockId);
            }
            
            hytopiaMap.blocks[positionKey] = hytopiaBlockId;
            blockCount++;
          }
        }
        
        // Update progress every layer
        const progress = Math.floor((y / height) * 100);
        updateProgressBar(progress);
      }
      
      console.log(`Processed ${blockCount} blocks for litematic format`);
      updateProgressBar(100);
    } catch (error) {
      console.error('Error processing litematic format:', error);
      throw new Error(`Failed to process litematic format: ${error.message}`);
    }
    
    console.log(`Converted litematic to ${Object.keys(hytopiaMap.blocks).length} blocks in HYTOPIA format`);
    
    // If no blocks were processed, throw an error
    if (Object.keys(hytopiaMap.blocks).length === 0) {
      throw new Error("No blocks were extracted from the litematic. The file may be empty or corrupted.");
    }
    
    // Check if we have unmapped blocks that need user attention
    if (unmappedBlockTracker.hasUnmappedBlocks()) {
      console.log("Found unmapped blocks during import:", unmappedBlockTracker.blocks);
      
      // Create a temporary copy of the block map
      const temporaryBlockMap = { ...hytopiaMap.blocks };
      
      // Return information needed for the modal
      return { 
        success: true, 
        requiresUserInput: true,
        temporaryBlockMap,
        unmappedBlocks: unmappedBlockTracker.blocks,
        terrainBuilderRef,
        environmentBuilderRef,
        blockCount: Object.keys(hytopiaMap.blocks).length,
        regionSelection: regionSelection,
        centerOffset: {
          x: offsetX,
          y: offsetY,
          z: offsetZ
        }
      };
    }
    
    // Save terrain data to IndexedDB
    await DatabaseManager.saveData(STORES.TERRAIN, "current", hytopiaMap.blocks);
    
    // Refresh terrain builder
    if (terrainBuilderRef && terrainBuilderRef.current) {
      await terrainBuilderRef.current.refreshTerrainFromDB();
    }
    
    console.log("Litematic import complete");
    
    // Return the number of blocks imported
    return {
      success: true,
      blockCount: Object.keys(hytopiaMap.blocks).length,
      regionSelection: regionSelection,
      centerOffset: {
        x: offsetX,
        y: offsetY,
        z: offsetZ
      }
    };
  } catch (error) {
    console.error('Error importing litematic:', error);
    throw error;
  }
}

// Helper function to extract litematic dimensions without importing blocks
export async function previewLitematic(file) {
  try {
    console.log(`Previewing litematic file: ${file.name}`);
    
    // Read the file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Check if the file is gzipped
    const isGzippedFile = isGzipped(data);
    console.log('File appears to be', isGzippedFile ? 'gzipped' : 'not gzipped');
    
    let fileData;
    if (isGzippedFile) {
      // Decompress the gzipped data
      try {
        fileData = decompressGzip(data);
      } catch (e) {
        console.error('Error decompressing gzipped data:', e);
        throw new Error('Failed to decompress gzipped litematic file. The file may be corrupted.');
      }
    } else {
      fileData = data;
    }
    
    // Convert to Buffer for prismarine-nbt
    const buffer = Buffer.from(fileData);
    
    // Parse the NBT data
    let parsedNBT;
    try {
      parsedNBT = await nbt.parse(buffer);
    } catch (e) {
      console.error('Error parsing NBT data:', e);
      throw new Error('Failed to parse NBT data. The litematic file may be in an unsupported format.');
    }
    
    // Get the schematic structure
    const schematic = parsedNBT?.parsed?.value?.Schematic?.value || parsedNBT?.parsed?.value || {};
    
    // Verify this is a litematic format
    if (!schematic.Regions || !schematic.Regions.value) {
      throw new Error('This does not appear to be a valid litematic file');
    }
    
    // Get dimensions from the first region
    let width = 0, height = 0, length = 0;
    let actualBlockCount = 0;
    
    try {
      const regionName = Object.keys(schematic.Regions.value)[0];
      if (!regionName) {
        throw new Error("No regions found in litematic file");
      }
      
      const region = schematic.Regions.value[regionName].value;
      
      width = Math.abs(region.Size?.value?.x?.value || 0);
      height = Math.abs(region.Size?.value?.y?.value || 0);
      length = Math.abs(region.Size?.value?.z?.value || 0);
      
      // Get block data to count non-air blocks
      const litematicaPalette = region.BlockStatePalette?.value?.value || [];
      const litematicaBlockData = region.BlockStates?.value || [];
      
      // Count non-air blocks
      for (let i = 0; i < litematicaBlockData.length; i++) {
        const blockId = litematicaBlockData[i];
        if (blockId >= litematicaPalette.length) continue;
        
        const blockInfo = litematicaPalette[blockId];
        if (!blockInfo) continue;
        
        const blockName = blockInfo.Name?.value || '';
        if (blockName && blockName !== 'minecraft:air') {
          actualBlockCount++;
        }
      }
      
    } catch (error) {
      console.error('Error getting litematic dimensions:', error);
      throw new Error(`Failed to get litematic dimensions: ${error.message}`);
    }
    
    console.log(`Litematic dimensions: ${width}x${height}x${length}, Non-air blocks: ${actualBlockCount}`);
    
    return {
      success: true,
      dimensions: {
        width,
        height,
        length
      },
      actualBlockCount,
      centerOffset: {
        x: 0,
        y: 0,
        z: 0
      }
    };
  } catch (error) {
    console.error('Error previewing litematic:', error);
    throw error;
  }
} 