import { DatabaseManager, STORES } from "./DatabaseManager";
import * as nbt from 'prismarine-nbt';
import pako from 'pako';
import { Buffer } from 'buffer';

// Global map to track dynamic block mappings for the session
const dynamicBlockMappings = new Map();

// Use this to define fallback block mappings based on name components 
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

// Main function to handle schematic file import
export async function importSchematic(file, terrainBuilderRef, environmentBuilderRef, mappingUrl = '/mapping.json', regionSelection = null) {
  try {
    console.log(`Importing schematic file: ${file.name}`);
    
    // Region selection validation
    if (regionSelection) {
      console.log(`Using region selection: min(${regionSelection.minX}, ${regionSelection.minY}, ${regionSelection.minZ}), max(${regionSelection.maxX}, ${regionSelection.maxY}, ${regionSelection.maxZ})`);
    } else {
      console.log('Importing entire schematic (no region selection)');
    }
    
    // Reset the unmapped block tracker
    unmappedBlockTracker.reset();
    
    // Initialize offset variables
    let offsetX = 0, offsetY = 0, offsetZ = 0;
    
    // First try to use the mapping.json file
    let blockMapping = await loadBlockMapping(mappingUrl);
    console.log(`Loaded mapping with ${Object.keys(blockMapping.blocks || {}).length} block definitions`);

    // If we didn't get any block definitions, use a hardcoded mapping for common blocks
    if (!blockMapping.blocks || Object.keys(blockMapping.blocks).length === 0) {
      console.log('Using hardcoded mapping since no blocks were loaded from mapping.json');
      blockMapping = {
        blocks: {
          "minecraft:stone": { id: 37, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
          "minecraft:dirt": { id: 8, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
          "minecraft:grass_block": { id: 16, hytopiaBlock: "grass", textureUri: "blocks/grass.png" },
          "minecraft:oak_planks": { id: 28, hytopiaBlock: "oak-planks", textureUri: "blocks/oak-planks.png" },
          "minecraft:oak_log": { id: 23, hytopiaBlock: "log", textureUri: "blocks/log.png" },
          "minecraft:glass": { id: 14, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
          "minecraft:bricks": { id: 1, hytopiaBlock: "bricks", textureUri: "blocks/bricks.png" },
          "minecraft:black_wool": { id: 37, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
          "minecraft:white_wool": { id: 43, hytopiaBlock: "water-still", textureUri: "blocks/water-still.png" },
          "minecraft:red_wool": { id: 1, hytopiaBlock: "bricks", textureUri: "blocks/bricks.png" },
          "minecraft:brown_wool": { id: 8, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
          "minecraft:brown_concrete": { id: 8, hytopiaBlock: "dirt", textureUri: "blocks/dirt.png" },
          "minecraft:white_concrete": { id: 14, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
          "minecraft:black_concrete": { id: 37, hytopiaBlock: "stone", textureUri: "blocks/stone.png" },
          "minecraft:white_concrete_powder": { id: 14, hytopiaBlock: "glass", textureUri: "blocks/glass.png" },
          "minecraft:coal_block": { id: 37, hytopiaBlock: "stone", textureUri: "blocks/stone.png" }
        }
      };
      console.log(`Using hardcoded mapping with ${Object.keys(blockMapping.blocks).length} block definitions`);
    }

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
    // Check for nested modern WorldEdit format
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
    
    // Debug the actual structure more deeply if it's a modern_worldedit format
    if (formatType === "modern_worldedit") {
      console.log("Palette exists:", !!schematic.Palette);
      console.log("BlockData exists:", !!schematic.BlockData);
      
      // Check if values are accessible
      if (schematic.Palette && schematic.BlockData) {
        console.log("Palette value exists:", !!schematic.Palette.value);
        console.log("BlockData value exists:", !!schematic.BlockData.value);
        
        // Try to access a sample of the first few blocks
        if (schematic.BlockData.value && schematic.BlockData.value.length > 0) {
          console.log("First few block IDs:", schematic.BlockData.value.slice(0, 5));
        }
        
        // Inspect Palette structure
        if (schematic.Palette.value) {
          console.log("Palette keys:", Object.keys(schematic.Palette.value).slice(0, 5));
          console.log("First palette entry:", JSON.stringify(schematic.Palette.value[Object.keys(schematic.Palette.value)[0]]).substring(0, 100));
        }
      }
    }
    
    // Initialize terrain data
    const hytopiaMap = {
      blocks: {}
    };
    
    // Variables for different formats
    let width, height, length, palette, blockData;
    
    // Get the dimensions, palette, and block data based on the format type
    switch (formatType) {
      case "classic":
        // Handle classic format
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        
        console.log(`Dimensions: ${width}x${height}x${length}`);
        
        // Remove duplicate variable declarations
        const classicBlocks = schematic.Blocks?.value || [];
        const classicData = schematic.Data?.value || []; // eslint-disable-line no-unused-vars
        
        // Classic format uses block IDs, we need a mapping from old IDs to names
        const classicIdToNameMap = {
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
              const blockId = classicBlocks[index];
              
              if (blockId !== 0) { // Skip air
                // Get block name from classic ID
                const blockName = classicIdToNameMap[blockId] || `unknown_${blockId}`;
                
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
        
      case "modern_worldedit":
        // Direct access for westerkerk-style format
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        const offsetX = schematic.Offset?.value?.x?.value || 0;
        const offsetY = schematic.Offset?.value?.y?.value || 0;
        const offsetZ = schematic.Offset?.value?.z?.value || 0;
        
        console.log(`Dimensions: ${width}x${height}x${length}, Offset: ${offsetX},${offsetY},${offsetZ}`);
        
        palette = schematic.Palette.value;
        blockData = schematic.BlockData.value;
        
        console.log(`Palette entries: ${Object.keys(palette).length}, Sample: ${Object.keys(palette).slice(0, 3).join(', ')}`);
        console.log(`BlockData length: ${blockData.length}`);
        
        // Debug the actual blockData
        console.log("BlockData type:", typeof blockData);
        console.log("Is BlockData array?", Array.isArray(blockData));
        
        // Examine the structure of the first few elements if it's an array
        if (Array.isArray(blockData) && blockData.length > 0) {
          console.log("First few BlockData elements structure:", 
            blockData.slice(0, 5).map(item => `${typeof item}:${item}`).join(", "));
        }
        
        // In modern WorldEdit format, the palette maps block names to IDs (not IDs to names)
        // We need to reverse this mapping to create paletteIdToName
        const paletteIdToName = {};
        Object.entries(palette).forEach(([blockName, id]) => {
          // Handle case where id might be an object with a value property
          const actualId = typeof id === 'object' && id !== null && 'value' in id ? id.value : id;
          paletteIdToName[actualId] = blockName;
          console.log(`Mapped palette ID ${actualId} to block name ${blockName}`);
        });
        
        console.log(`Converted paletteIdToName map with ${Object.keys(paletteIdToName).length} entries`);
        if (Object.keys(paletteIdToName).length > 0) {
          console.log("Sample paletteIdToName entries:", 
            Object.entries(paletteIdToName).slice(0, 3).map(([id, name]) => `${id}:${name}`).join(", "));
        }
        
        // Debug palettes for first few entries
        const paletteEntries = Object.keys(paletteIdToName).slice(0, 3);
        console.log("Sample palette entries:", paletteEntries);
        // Data might be used in future implementation
        const paletteData = blockData?.slice(0, 10); // eslint-disable-line no-unused-vars
        
        // Process BlockData
        let blockIndex = 0;
        for (let y = 0; y < height; y++) {
          for (let z = 0; z < length; z++) {
            for (let x = 0; x < width; x++) {
              if (blockIndex < blockData.length) {
                const rawPaletteId = blockData[blockIndex];
                // Handle cases where paletteId might be an object with a value property
                const paletteId = typeof rawPaletteId === 'object' && rawPaletteId !== null && 'value' in rawPaletteId 
                  ? rawPaletteId.value 
                  : rawPaletteId;
                
                // Get the block name - try with both string and number keys
                let blockName = paletteIdToName[paletteId];
                if (!blockName && typeof paletteId === 'number') {
                  blockName = paletteIdToName[String(paletteId)];
                }
                if (!blockName && typeof paletteId === 'string') {
                  blockName = paletteIdToName[parseInt(paletteId, 10)];
                }
                
                // Log the first few blocks to understand what's happening
                if (blockIndex < 10) {
                  console.log(`Block at index ${blockIndex}: ID=${paletteId}, Name=${blockName || 'undefined'}`);
                }
                
                if (blockName && blockName !== 'minecraft:air') {
                  // Convert to HYTOPIA block ID
                  let hytopiaBlockId;
                  let isUnmappedBlock = false;
                  
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
                      
                      // Track this as an unmapped block
                      isUnmappedBlock = true;
                    }
                  }
                  
                  // Always use a default fallback if we still don't have a valid ID
                  if (!hytopiaBlockId) {
                    hytopiaBlockId = fallbackMapping.unknown.id;
                    console.log(`Using default stone block for ${blockName} as last resort`);
                    // Track this as an unmapped block
                    isUnmappedBlock = true;
                  }
                  
                  // Add to terrain data with correct coordinates
                  // Adjust coordinates to center the schematic
                  const finalX = x - Math.floor(width / 2) + offsetX;
                  const finalY = y + offsetY;
                  const finalZ = z - Math.floor(length / 2) + offsetZ;
                  
                  // Skip this block if it's outside the selected region
                  if (regionSelection) {
                    if (finalX < regionSelection.minX || finalX > regionSelection.maxX ||
                        finalY < regionSelection.minY || finalY > regionSelection.maxY ||
                        finalZ < regionSelection.minZ || finalZ > regionSelection.maxZ) {
                      continue; // Skip this block
                    }
                  }
                  
                  // Track unmapped block if necessary
                  if (isUnmappedBlock) {
                    unmappedBlockTracker.trackBlock(blockName, `${finalX},${finalY},${finalZ}`, hytopiaBlockId);
                  }
                  
                  hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
                  
                  // Add log for first 5 blocks to debug
                  if (Object.keys(hytopiaMap.blocks).length <= 5) {
                    console.log(`Added block: ${blockName} at (${finalX},${finalY},${finalZ}) with ID ${hytopiaBlockId}`);
                  }
                }
                
                blockIndex++;
              }
            }
          }
        }
        break;
        
      case "modern_worldedit_nested":
        // Handle nested modern WorldEdit format
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
          
          // Debug the palette structure
          console.log("Palette structure:", JSON.stringify(palette).substring(0, 500) + "...");
          
          // In WorldEdit format, the palette is inverted compared to our expectation
          // The keys are the block names and the values are the IDs
          // We need to create a mapping from ID to name
          const paletteIdToName = {};
          
          // First populate from the palette - in WorldEdit the keys are names, values are IDs
          Object.entries(palette).forEach(([name, id]) => {
            // Handle cases where id might be an object with a value property
            const actualId = typeof id === 'object' && id !== null && 'value' in id ? id.value : id;
            paletteIdToName[actualId] = name;
            
            // Log ID 0 mapping for debugging
            if (actualId === 0 || actualId === "0") {
              console.log(`Palette has ID 0 mapped to name: ${name}`);
            }
          });
          
          // Debug the first few entries of paletteIdToName
          console.log("First few paletteIdToName entries:", 
            Object.entries(paletteIdToName).slice(0, 5).map(([id, name]) => `${id}:${name}`).join(", "));
          
          // Create a more specific mapping for colored blocks commonly found in schematics
          const specialBlockMapping = {
            'minecraft:black_wool': { id: 37, name: "stone" },
            'minecraft:black_concrete': { id: 37, name: "stone" },
            'minecraft:brown_wool': { id: 8, name: "dirt" },
            'minecraft:brown_concrete': { id: 8, name: "dirt" },
            'minecraft:white_wool': { id: 14, name: "glass" },
            'minecraft:white_concrete': { id: 14, name: "glass" },
            'minecraft:white_concrete_powder': { id: 14, name: "glass" },
            'minecraft:red_wool': { id: 1, name: "bricks" },
            'minecraft:coal_block': { id: 37, name: "stone" }
          };
          
          // Process BlockData
          let blockIndex = 0;
          let processedBlocks = 0;
          let airBlocks = 0;
          let nonMappedBlocks = 0;
          
          for (let y = 0; y < height; y++) {
            for (let z = 0; z < length; z++) {
              for (let x = 0; x < width; x++) {
                if (blockIndex < blockData.length) {
                  const rawPaletteId = blockData[blockIndex];
                  // Handle cases where paletteId might be an object with a value property
                  const paletteId = typeof rawPaletteId === 'object' && rawPaletteId !== null && 'value' in rawPaletteId 
                    ? rawPaletteId.value 
                    : rawPaletteId;
                  
                  // Get block name from our ID to name mapping
                  let blockName = paletteIdToName[paletteId];
                  
                  // If still not found, try converting string/number formats
                  if (!blockName && typeof paletteId === 'number') {
                    blockName = paletteIdToName[String(paletteId)];
                  }
                  if (!blockName && typeof paletteId === 'string') {
                    blockName = paletteIdToName[parseInt(paletteId, 10)];
                  }
                  
                  // Log the first few blocks
                  if (blockIndex < 10) {
                    console.log(`Block at index ${blockIndex}: ID=${paletteId}, Name=${blockName || 'undefined'}`);
                  }
                  
                  // If it's air, count but skip processing
                  if (blockName && blockName.endsWith(':air')) {
                    airBlocks++;
                    blockIndex++;
                    continue;
                  }
                  
                  // If we found a valid block name, map it to HYTOPIA
                  if (blockName) {
                    // Convert to HYTOPIA block ID
                    let hytopiaBlockId;
                    
                    // First check our specialized block mapping
                    if (specialBlockMapping[blockName]) {
                      hytopiaBlockId = specialBlockMapping[blockName].id;
                      console.log(`Mapped ${blockName} to HYTOPIA block ID ${hytopiaBlockId} (specialized mapping)`);
                    }
                    // If not found, try in the standard mapping
                    else if (blockMapping.blocks && blockMapping.blocks[blockName]) {
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
                    
                    // Always use a default fallback if we still don't have a valid ID
                    if (!hytopiaBlockId) {
                      hytopiaBlockId = fallbackMapping.unknown.id;
                      console.log(`Using default stone block for ${blockName} as last resort`);
                    }
                    
                    // Add to terrain data with correct coordinates
                    // Adjust coordinates to center the schematic
                    const finalX = x - Math.floor(width / 2);
                    const finalY = y;
                    const finalZ = z - Math.floor(length / 2);
                    
                    hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = hytopiaBlockId;
                    processedBlocks++;
                  } else {
                    nonMappedBlocks++;
                    if (nonMappedBlocks < 5) {
                      console.log(`Unable to find block name for palette ID ${paletteId}`);
                    }
                    // For blocks without a name, use a fallback
                    // Add to terrain data with correct coordinates
                    const finalX = x - Math.floor(width / 2);
                    const finalY = y;
                    const finalZ = z - Math.floor(length / 2);
                    
                    // Use stone as a fallback
                    hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = fallbackMapping.unknown.id;
                    processedBlocks++;
                  }
                  
                  blockIndex++;
                }
              }
            }
          }
          
          console.log(`Processed ${processedBlocks} blocks (${airBlocks} air blocks skipped, ${nonMappedBlocks} blocks without names)`);
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
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        
        console.log(`Dimensions: ${width}x${height}x${length}`);
        
        const blocks = schematic.Blocks?.value || [];
        const data = schematic.Data?.value || []; // eslint-disable-line no-unused-vars
        
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
          
          width = Math.abs(region.Size?.value?.x?.value || 0);
          height = Math.abs(region.Size?.value?.y?.value || 0);
          length = Math.abs(region.Size?.value?.z?.value || 0);
          
          console.log(`Litematica dimensions: ${width}x${height}x${length}`);
          
          // Get palette and block data from region
          const litematicaPalette = region.BlockStatePalette?.value?.value || [];
          const litematicaBlockData = region.BlockStates?.value || [];
          
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
                
                // Always use a default fallback if we still don't have a valid ID
                if (!hytopiaBlockId) {
                  hytopiaBlockId = fallbackMapping.unknown.id;
                  console.log(`Using default stone block for ${blockName} as last resort`);
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
    
    console.log("Schematic import complete");
    
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
    console.error('Error importing schematic:', error);
    throw error;
  }
}

// Function to finalize schematic import after user has made block choices
export async function finalizeSchematicImport(temporaryBlockMap, unmappedBlocks, blockDecisions, terrainBuilderRef) {
  try {
    console.log("Finalizing schematic import with user decisions:", blockDecisions);
    
    const finalBlockMap = { ...temporaryBlockMap };
    
    // Apply user decisions for each unmapped block
    Object.keys(blockDecisions).forEach(blockName => {
      const decision = blockDecisions[blockName];
      const blockInfo = unmappedBlocks[blockName];
      
      if (!blockInfo) {
        console.warn(`Block info not found for ${blockName}`);
        return;
      }
      
      // Process based on decision type
      switch (decision.action) {
        case 'useCustomTexture':
          // Change all instances of this block to the custom block ID
          Object.keys(finalBlockMap).forEach(pos => {
            if (blockInfo.positions.includes(pos) || 
                finalBlockMap[pos] === blockInfo.fallbackId) {
              finalBlockMap[pos] = decision.customBlockId;
            }
          });
          break;
          
        case 'useExisting':
          // Change all instances of this block to the selected existing block ID
          Object.keys(finalBlockMap).forEach(pos => {
            if (blockInfo.positions.includes(pos) || 
                finalBlockMap[pos] === blockInfo.fallbackId) {
              finalBlockMap[pos] = decision.selectedBlockId;
            }
          });
          break;
          
        case 'useFallback':
          // Keep fallback ID (no change needed)
          break;
          
        case 'skip':
          // Remove this block from the map
          Object.keys(finalBlockMap).forEach(pos => {
            if (blockInfo.positions.includes(pos) || 
                finalBlockMap[pos] === blockInfo.fallbackId) {
              delete finalBlockMap[pos];
            }
          });
          break;
          
        default:
          // Default to using fallback ID for unknown actions
          console.warn(`Unknown decision action: ${decision.action} for block ${blockName}, using fallback`);
          break;
      }
    });
    
    // Save the final block map to the database
    await DatabaseManager.saveData(STORES.TERRAIN, "current", finalBlockMap);
    
    // Refresh the terrain builder
    if (terrainBuilderRef && terrainBuilderRef.current) {
      await terrainBuilderRef.current.refreshTerrainFromDB();
    }
    
    console.log("Schematic import finalized");
    
    return { success: true, blockCount: Object.keys(finalBlockMap).length };
  } catch (error) {
    console.error("Error finalizing schematic import:", error);
    throw error;
  }
}

// Helper function to extract schematic dimensions without importing blocks
export async function previewSchematic(file) {
  try {
    console.log(`Previewing schematic file: ${file.name}`);
    
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
    } catch (e) {
      console.error('Error parsing NBT data:', e);
      throw new Error('Failed to parse NBT data. The schematic file may be in an unsupported format.');
    }
    
    // Get the schematic structure, handling different NBT layouts
    const schematic = parsedNBT?.parsed?.value?.Schematic?.value || parsedNBT?.parsed?.value || {};
    
    // Improved format detection logic
    let formatType = "unknown";
    // Initialize offset variables
    let offsetX = 0, offsetY = 0, offsetZ = 0;
    
    // Detect format type based on available fields
    if (schematic.BlockData && schematic.Palette) {
      formatType = "modern_worldedit";
    } else if (schematic.Blocks?.value?.Data && schematic.Blocks?.value?.Palette) {
      formatType = "modern_worldedit_nested";
    } else if (schematic.Blocks && schematic.Data) {
      formatType = "classic";
    }
    
    console.log(`Detected schematic format: ${formatType}`);
    
    // Get the dimensions based on the format type
    let width = 0, height = 0, length = 0;
    let actualBlockCount = 0;  // Track the actual non-air block count
    
    switch (formatType) {
      case "classic":
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        
        // Count non-air blocks (classic format)
        if (schematic.Blocks && schematic.Data) {
          const blocks = schematic.Blocks.value;
          for (let i = 0; i < blocks.length; i++) {
            // In classic format, block ID 0 is air
            if (blocks[i] !== 0) {
              actualBlockCount++;
            }
          }
        }
        break;
        
      case "modern_worldedit":
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        
        // Count non-air blocks (modern format)
        if (schematic.BlockData?.value && schematic.Palette?.value) {
          const blockData = schematic.BlockData.value;
          const palette = schematic.Palette.value;
          
          // Convert palette to check for air blocks more precisely
          const paletteAir = {};
          for (const blockName in palette) {
            // More precise air block detection
            if (blockName === "minecraft:air" || 
                blockName === "minecraft:cave_air" || 
                blockName === "minecraft:void_air" ||
                (blockName.endsWith(":air") && !blockName.includes("stairs") && !blockName.includes("slab"))) {
              paletteAir[palette[blockName].value] = true;
            }
          }
          
          // Count non-air blocks
          for (let i = 0; i < blockData.length; i++) {
            const blockId = blockData[i];
            if (!paletteAir[blockId]) {
              actualBlockCount++;
            }
          }
        }
        break;
        
      case "modern_worldedit_nested":
        width = schematic.Width?.value || 0;
        height = schematic.Height?.value || 0;
        length = schematic.Length?.value || 0;
        
        // Count non-air blocks (nested format)
        if (schematic.Blocks?.value?.Data?.value && schematic.Blocks?.value?.Palette?.value) {
          const blockData = schematic.Blocks.value.Data.value;
          const palette = schematic.Blocks.value.Palette.value;
          
          // Convert palette to check for air blocks more precisely
          const paletteAir = {};
          for (const blockName in palette) {
            // More precise air block detection
            if (blockName === "minecraft:air" || 
                blockName === "minecraft:cave_air" || 
                blockName === "minecraft:void_air" ||
                (blockName.endsWith(":air") && !blockName.includes("stairs") && !blockName.includes("slab"))) {
              paletteAir[palette[blockName].value] = true;
            }
          }
          
          // Count non-air blocks
          for (let i = 0; i < blockData.length; i++) {
            const blockId = blockData[i];
            if (!paletteAir[blockId]) {
              actualBlockCount++;
            }
          }
        }
        break;
        
      default:
        // Default case for unsupported formats
        console.warn(`Using default dimensions for unsupported format: ${formatType}`);
        width = 0;
        height = 0;
        length = 0;
        break;
    }
    
    // Handle WE offset if available
    if (schematic.WEOffsetX?.value !== undefined) {
      offsetX = schematic.WEOffsetX.value;
      offsetY = schematic.WEOffsetY?.value || 0;
      offsetZ = schematic.WEOffsetZ?.value || 0;
    }
    
    console.log(`Dimensions: ${width}x${height}x${length}, Offset: (${offsetX},${offsetY},${offsetZ})`);
    console.log(`Actual non-air block count: ${actualBlockCount}`);
    
    return {
      success: true,
      dimensions: {
        width,
        height,
        length
      },
      actualBlockCount,
      centerOffset: {
        x: offsetX,
        y: offsetY,
        z: offsetZ
      }
    };
  } catch (error) {
    console.error('Error previewing schematic:', error);
    throw error;
  }
} 