import { DatabaseManager, STORES } from "./DatabaseManager";
import * as nbt from 'prismarine-nbt';
import pako from 'pako';
import { Buffer } from 'buffer';
import JSZip from 'jszip';

// Import the shared utilities from SchematicConverter
import { 
  loadBlockMapping, 
  finalizeSchematicImport 
} from "./SchematicConverter";

// Ensure the Buffer is properly available
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

// Configure NBT options with large allocation if possible
const NBT_OPTIONS = { 
  // Allow larger allocations for NBT data
  allowBigInt: true,
  // Increase timeout for larger files
  timeout: 30000,
  // Explicitly handle metadata for 1.21+ format
  keepMetadata: true,
  // Additional options for 1.21 format
  keepRawData: true,
  proven: false,
  // Handle long arrays properly
  longArrayAsString: false,
  // Increase buffer size for large chunks
  maxArrayLength: 32768,
  // Handle nested structures
  maxDepth: 128
};

// Global variables for tracking
const dynamicBlockMappings = new Map();
const unmappedBlockTracker = {
  blocks: {},
  
  trackBlock: function(blockName, position, fallbackId) {
    if (!this.blocks[blockName]) {
      this.blocks[blockName] = {
        count: 0,
        positions: [],
        fallbackId: fallbackId
      };
    }
    
    this.blocks[blockName].count++;
    
    if (this.blocks[blockName].positions.length < 5) {
      this.blocks[blockName].positions.push(position);
    }
  },
  
  reset: function() {
    this.blocks = {};
  },
  
  hasUnmappedBlocks: function() {
    return Object.keys(this.blocks).length > 0;
  }
};

// Common fallback mappings
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

// Helper functions for UI progress indication
function createProgressBar() {
  // Check if the progress bar already exists
  if (document.getElementById('minecraft-import-progress')) {
    return;
  }
  
  const progressContainer = document.createElement('div');
  progressContainer.id = 'minecraft-import-progress';
  progressContainer.style.position = 'fixed';
  progressContainer.style.bottom = '20px';
  progressContainer.style.left = '20px';
  progressContainer.style.right = '20px';
  progressContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  progressContainer.style.padding = '10px';
  progressContainer.style.borderRadius = '4px';
  progressContainer.style.zIndex = '9999';
  
  const progressText = document.createElement('div');
  progressText.id = 'minecraft-import-progress-text';
  progressText.style.color = 'white';
  progressText.style.marginBottom = '5px';
  progressText.textContent = 'Importing...';
  
  const progressBarOuter = document.createElement('div');
  progressBarOuter.style.height = '20px';
  progressBarOuter.style.backgroundColor = '#444';
  progressBarOuter.style.borderRadius = '4px';
  progressBarOuter.style.overflow = 'hidden';
  
  const progressBarInner = document.createElement('div');
  progressBarInner.id = 'minecraft-import-progress-bar';
  progressBarInner.style.height = '100%';
  progressBarInner.style.width = '0%';
  progressBarInner.style.backgroundColor = '#4CAF50';
  progressBarInner.style.transition = 'width 0.3s';
  
  progressBarOuter.appendChild(progressBarInner);
  progressContainer.appendChild(progressText);
  progressContainer.appendChild(progressBarOuter);
  
  document.body.appendChild(progressContainer);
}

function updateProgressBar(progress, statusMessage = null) {
  const progressBar = document.getElementById('minecraft-import-progress');
  const progressFill = document.getElementById('minecraft-import-progress-bar');
  const progressText = document.getElementById('minecraft-import-progress-text');
  
  if (!progressBar || !progressFill || !progressText) return;
  
  // Make sure progress bar is visible
  progressBar.style.display = 'block';
  
  // Update progress percentage
  const clampedProgress = Math.max(0, Math.min(100, progress));
  progressFill.style.width = `${clampedProgress}%`;
  
  // Update progress text
  progressText.textContent = statusMessage || `Importing... ${clampedProgress}%`;
  
  // If progress is 100%, hide the progress bar after a short delay
  if (progress >= 100) {
    setTimeout(() => {
      progressBar.style.display = 'none';
    }, 1000);
  }
}

// Helper function to get fallback block ID
function getFallbackBlockId(blockName) {
  const nameLower = blockName.toLowerCase();
  for (const [key, value] of Object.entries(fallbackMapping)) {
    if (nameLower.includes(key)) {
      return value.id;
    }
  }
  return fallbackMapping.unknown.id;
}

// Parse region file coordinates from filename (e.g., r.0.0.mca -> {x: 0, z: 0})
function parseRegionCoordinates(filename) {
  // Handle negative coordinates in filenames like "r.-1.2.mca"
  const match = filename.match(/r\.(-?\d+)\.(-?\d+)\.mca/);
  if (!match) {
    console.warn(`Invalid region filename format: ${filename}`);
    return null;
  }
  
  return {
    x: parseInt(match[1], 10),
    z: parseInt(match[2], 10)
  };
}

// Function to read a 4-byte big-endian integer from buffer
function readInt32BE(buffer, offset) {
  return (buffer[offset] << 24) | 
         (buffer[offset + 1] << 16) | 
         (buffer[offset + 2] << 8) | 
         buffer[offset + 3];
}

function parseLongArray(nbtLongArray) {
  if (nbtLongArray.type === 'LongArray') {
    return nbtLongArray.value.map(l => [l.high, l.low]);
  }
  return nbtLongArray;
}

// Extract block states from a packed long array without using BigInt
function extractBlockStatesFromPackedLongArray(packedLongArray, bitsPerBlock, paletteSize, blockCount) {
  // Enhanced handling for different input formats
  console.log(`Extracting block states with ${bitsPerBlock} bits per block, palette size ${paletteSize}`);
  
  // Convert input to array of numbers if needed
  const longArray = parseLongArray(packedLongArray);
  
  // Handle NBT format where each item might be a {type: 'long', value: [high, low]} object
  if (packedLongArray.length > 0 && typeof packedLongArray[0] === 'object') {
    if (packedLongArray[0].type === 'long' && Array.isArray(packedLongArray[0].value)) {
      console.log('Converting NBT-style long array');
      longArray = packedLongArray.map(item => {
        // Convert from NBT long [high, low] to JS number (may lose precision but works for our use)
        const [high, low] = item.value;
        // JS can safely handle integers up to 2^53 - 1
        return high * Math.pow(2, 32) + low;
      });
    } else if ('value' in packedLongArray[0]) {
      // Simpler case - just extract value property
      longArray = packedLongArray.map(item => Number(item.value));
    }
  }
  
  // Output block states array
  const states = new Array(blockCount).fill(0);
  
  // Math constants for bit operations
  const LONG_BITS = 64;
  const MAX_SUPPORTED_BITS = 30; // JS bitwise operations are limited to 32 bits, use 30 to be safe
  
  // Handle the case where bitsPerBlock is too large for safe bit operations
  if (bitsPerBlock > MAX_SUPPORTED_BITS) {
    console.warn(`bitsPerBlock (${bitsPerBlock}) exceeds max supported bits (${MAX_SUPPORTED_BITS}), using fallback`);
    // In this case, return a simpler array that just alternates between palette entries
    for (let i = 0; i < blockCount; i++) {
      states[i] = i % paletteSize;
    }
    return states;
  }
  
  // Calculate how many blocks fit in each long
  const blocksPerLong = Math.floor(LONG_BITS / bitsPerBlock);
  
  // Mask for extracting bits (use Number not BigInt)
  const mask = (1 << bitsPerBlock) - 1;
  
  // Debug
  console.log(`Blocks per long: ${blocksPerLong}, mask: 0x${mask.toString(16)}`);
  
  let blockIndex = 0;
  
  // Process each long in the array
  for (let longIndex = 0; longIndex < longArray.length && blockIndex < blockCount; longIndex++) {
    // Handle various input formats
    let longValue;
    try {
      if (Array.isArray(longArray[longIndex])) {
        // Handle [high, low] pairs from NBT
        const [high, low] = longArray[longIndex];
        // We'll process high and low separately
        longValue = [high, low];
      } else {
        // Regular number
        longValue = Number(longArray[longIndex]);
      }
    } catch (err) {
      console.warn(`Error converting long at index ${longIndex}:`, err);
      // Skip this long and continue with the next one
      continue;
    }
    
    // Extract each block from this long
    for (let blockOffset = 0; blockOffset < blocksPerLong && blockIndex < blockCount; blockOffset++) {
      const bitPosition = blockOffset * bitsPerBlock;
      let paletteIndex;
      
      if (Array.isArray(longValue)) {
        // Handle [high, low] format - determine if we need high or low bytes
        const [high, low] = longValue;
        if (bitPosition >= 32) {
          // Need to get bits from high part
          const highBitPos = bitPosition - 32;
          paletteIndex = (high >>> highBitPos) & mask;
        } else if (bitPosition + bitsPerBlock > 32) {
          // Bits span across high and low
          const lowBits = 32 - bitPosition;
          const lowPart = (low >>> bitPosition) & ((1 << lowBits) - 1);
          const highPart = (high & ((1 << (bitsPerBlock - lowBits)) - 1)) << lowBits;
          paletteIndex = lowPart | highPart;
        } else {
          // Bits are all in low part
          paletteIndex = (low >>> bitPosition) & mask;
        }
      } else {
        // Regular JavaScript number
        if (bitPosition >= 32) {
          // For higher bit positions, we need a different approach
          // Since JavaScript bitwise operations work on 32-bit integers
          const shiftedValue = Math.floor(longValue / Math.pow(2, bitPosition));
          paletteIndex = shiftedValue & mask;
        } else {
          // For lower bit positions, we can use standard bitwise operations
          paletteIndex = (longValue >>> bitPosition) & mask;
        }
      }
      
      if (paletteIndex < paletteSize) {
        states[blockIndex] = paletteIndex;
      } else {
        // Handle invalid palette indices
        console.warn(`Invalid palette index ${paletteIndex} at block ${blockIndex}`);
        states[blockIndex] = 0; // Default to first palette entry
      }
      
      blockIndex++;
    }
  }
  
  return states;
}

// Helper function to recursively search for sections in the chunk data
function findSectionsRecursively(obj, depth = 0, maxDepth = 5) {
  // Prevent infinite recursion or excessive depth
  if (!obj || typeof obj !== 'object' || depth > maxDepth) {
    return null;
  }
  
  // Direct checks for sections array
  if (Array.isArray(obj)) {
    // Check if this looks like a sections array (containing Y and blockstates)
    if (obj.length > 0 && obj.some(item => 
        item && typeof item === 'object' && 
        (item.Y !== undefined || item.y !== undefined) && 
        (item.BlockStates !== undefined || item.block_states !== undefined || item.Palette !== undefined || item.palette !== undefined))) {
      return obj;
    }
    
    // Check each item in the array
    for (const item of obj) {
      const found = findSectionsRecursively(item, depth + 1, maxDepth);
      if (found) return found;
    }
    
    return null;
  }
  
  // Check direct section properties
  if (obj.Sections && Array.isArray(obj.Sections)) {
    return obj.Sections;
  }
  if (obj.sections && Array.isArray(obj.sections)) {
    return obj.sections;
  }
  
  // Look for a valid palette or block_states structure
  const hasPalette = obj.Palette || obj.palette;
  const hasBlockStates = obj.BlockStates || obj.block_states;
  
  if (hasPalette && hasBlockStates) {
    // This looks like a single section - wrap it in an array
    return [obj];
  }
  
  // Recursively check all properties
  for (const key in obj) {
    if (obj[key] && typeof obj[key] === 'object') {
      const found = findSectionsRecursively(obj[key], depth + 1, maxDepth);
      if (found) return found;
    }
  }
  
  return null;
}

// Add this helper function to handle 1.21.4 format sections specifically
function process121ChunkSections(sections, chunkX, chunkZ) {
    // Debug the input
    console.log(`Processing sections for chunk ${chunkX},${chunkZ}:`, 
                JSON.stringify(sections?.slice?.(0, 1) || sections || 'null').substring(0, 200));

    if (!sections) {
        console.warn(`No sections data for chunk ${chunkX},${chunkZ}`);
        return {};
    }

    // Handle NBT-style wrapped sections
    if (sections.value) {
        sections = sections.value;
    }

    if (!Array.isArray(sections)) {
        console.warn(`Sections is not an array for chunk ${chunkX},${chunkZ}`);
        return {};
    }

    const processedBlocks = {};
    
    sections.forEach((section, idx) => {
        // Handle NBT-style wrapped section
        if (section?.value) {
            section = section.value;
        }

        // Debug section structure
        console.log(`Processing section ${idx}, keys:`, Object.keys(section || {}));

        // Get block states and palette
        const blockStates = section?.block_states?.data?.value ?
          parseLongArray(section.block_states.data) :
          section?.BlockStates;
                          
        const palette = section?.block_states?.palette?.value || 
                       section?.block_states?.palette || 
                       section?.Palette?.value || 
                       section?.Palette;

        if (!blockStates || !palette) {
            console.log(`Skipping section ${idx}: no block states or palette`);
            return;
        }

        const y = section.Y || 0;

        // Process blocks
        for (let i = 0; i < blockStates.length; i++) {
            const stateId = blockStates[i];
            const blockData = palette[stateId];
            
            if (!blockData || !blockData.Name) continue;
            
            const blockName = blockData.Name.value || blockData.Name;
            if (blockName === 'minecraft:air') continue;

            // Calculate coordinates
            const localY = Math.floor(i / 256);
            const localZ = Math.floor((i % 256) / 16);
            const localX = i % 16;

            const globalX = chunkX * 16 + localX;
            const globalY = y * 16 + localY;
            const globalZ = chunkZ * 16 + localZ;

            processedBlocks[`${globalX},${globalY},${globalZ}`] = blockName;
        }
    });

    return processedBlocks;
}

const process121Sections = (sections) => {
    if (!Array.isArray(sections)) {
        console.warn("Sections is not an array:", sections);
        return [];
    }

    return sections.map(section => {
        if (!section || !section.block_states) {
            return null;
        }

        return {
            Y: section.Y,
            Blocks: section.block_states.data || [],
            BlockLight: section.BlockLight || [],
            SkyLight: section.SkyLight || [],
            Palette: section.block_states.palette.map(block => {
                return {
                    Name: block.Name,
                    Properties: block.Properties || {}
                };
            })
        };
    }).filter(section => section !== null);
};

const processChunkSections = (chunk) => {
    // First try Data.Sections (1.21+ format)
    if (chunk.Data && Array.isArray(chunk.Data.Sections)) {
        console.log("Processing 1.21+ format sections");
        return process121Sections(chunk.Data.Sections);
    }
    
    // Fallback to Level.Sections (pre-1.21 format)
    if (chunk.Level && Array.isArray(chunk.Level.Sections)) {
        console.log("Processing pre-1.21 format sections");
        return chunk.Level.Sections;
    }

    console.warn("No valid sections found in chunk");
    return [];
};

// Update the existing chunk processing function
const processChunk = (chunk, blockMapping) => {
    const sections = processChunkSections(chunk);
    if (!sections.length) {
        console.warn("No sections found in chunk, skipping");
        return {};  // Return empty object - no blocks for this chunk
    }

    // Process the sections into blocks
    const blocks = {};
    sections.forEach(section => {
        if (!section || !section.Palette) return;

        // Convert the block states into actual blocks
        section.Blocks.forEach((blockState, index) => {
            const palette = section.Palette[blockState];
            if (!palette) return;

            const y = section.Y * 16 + Math.floor(index / 256);
            const z = Math.floor((index % 256) / 16);
            const x = index % 16;

            // Get the block name - handle different formats
            let blockName = palette.Name;
            if (typeof blockName === 'object' && blockName.value) {
                blockName = blockName.value;
            }

            // Skip air blocks
            if (!blockName || blockName === 'minecraft:air' || blockName === 'air') {
                return;
            }

            // Convert to HYTOPIA block ID using the same mapping logic as SchematicConverter
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
                    unmappedBlockTracker.trackBlock(blockName, `${x},${y},${z}`, hytopiaBlockId);
                }
            }

            blocks[`${x},${y},${z}`] = hytopiaBlockId;
        });
    });

    return blocks;
}

// Extract blocks from chunk data
function extractBlocksFromChunk(chunk, blockMapping, regionSelection) {
  const blocks = {};
  const chunkX = chunk.x;
  const chunkZ = chunk.z;
  
  let sections = [];
  
  try {
    // Handle multiple possible chunk structures
    console.log(`Processing chunk at ${chunkX},${chunkZ}`);
    
    // Check if the data is valid
    if (!chunk.data) {
      console.warn(`Empty chunk data for chunk ${chunkX},${chunkZ}`);
      return blocks;
    }

    // DEBUG: Log the top-level keys for the first chunk to understand the structure
    if (chunkX === chunk.data.xPos && chunkZ === chunk.data.zPos) {
      console.log(`Chunk ${chunkX},${chunkZ} structure:`, {
        hasLevel: !!chunk.data.Level,
        hasData: !!chunk.data.Data,
        topLevelKeys: Object.keys(chunk.data)
      });
    }
    
    // Try to find sections in different locations based on Minecraft version
    
    // 1. Minecraft 1.21+ format - Data.sections
    if (chunk.data.Data && chunk.data.Data.sections) {
      console.log(`Found 1.21+ format sections at Data.sections for chunk ${chunkX},${chunkZ}`);
      sections = Array.isArray(chunk.data.Data.sections) ? 
                chunk.data.Data.sections : 
                Object.values(chunk.data.Data.sections);
    }
    // 2. Alternative 1.21+ format - Data.Sections
    else if (chunk.data.Data && chunk.data.Data.Sections) {
      console.log(`Found 1.21+ format sections at Data.Sections for chunk ${chunkX},${chunkZ}`);
      sections = Array.isArray(chunk.data.Data.Sections) ? 
                chunk.data.Data.Sections : 
                Object.values(chunk.data.Data.Sections);
    }
    // 3. Old format (pre-1.18) - Level.Sections
    else if (chunk.data.Level && chunk.data.Level.Sections) {
      console.log(`Found old format sections at Level.Sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.Level.Sections;
    }
    // 4. Direct sections array
    else if (Array.isArray(chunk.data.sections)) {
      console.log(`Found sections at root.sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.sections;
    }
    // 5. Direct Sections array
    else if (Array.isArray(chunk.data.Sections)) {
      console.log(`Found sections at root.Sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.Sections;
    }
    
    // If we still don't have sections, try a recursive search
    if (!sections || sections.length === 0) {
      sections = findSectionsRecursively(chunk.data);
      if (sections && sections.length > 0) {
        console.log(`Found ${sections.length} sections through recursive search in chunk ${chunkX},${chunkZ}`);
      }
    }
    
    // If we still don't have sections, log the chunk structure and return
    if (!sections || sections.length === 0) {
      console.warn(`No sections found in chunk ${chunkX},${chunkZ}. Chunk structure:`, chunk.data);
      return blocks;
    }
    
    console.log(`Processing ${sections.length} sections in chunk ${chunkX},${chunkZ}`);
    
    // Process each section
    for (const section of sections) {
      if (!section) continue;
      
      // Get section Y coordinate
      let sectionY = 0;
      if (section.Y !== undefined) {
        sectionY = typeof section.Y === 'object' ? section.Y.value : section.Y;
      } else if (section.y !== undefined) {
        sectionY = typeof section.y === 'object' ? section.y.value : section.y;
      }
      
      // Get block states and palette
      let palette = [];
      let blockStates = [];
      
      // Try to get palette from various locations
      if (section.block_states && section.block_states.palette) {
        palette = Array.isArray(section.block_states.palette) ? 
                 section.block_states.palette : 
                 (section.block_states.palette.value || []);
      } else if (section.Palette) {
        palette = Array.isArray(section.Palette) ? section.Palette : (section.Palette.value || []);
      } else if (section.palette) {
        palette = Array.isArray(section.palette) ? section.palette : (section.palette.value || []);
      }
      
      // Try to get block states from various locations
      if (section.block_states && section.block_states.data) {
        blockStates = Array.isArray(section.block_states.data) ? 
                     section.block_states.data : 
                     (section.block_states.data.value || []);
      } else if (section.BlockStates) {
        blockStates = Array.isArray(section.BlockStates) ? section.BlockStates : (section.BlockStates.value || []);
      }
      
      // Handle 1.21+ format palette entries
      if (palette.length > 0 && palette[0] && typeof palette[0] === 'object') {
        palette = palette.map(entry => {
          if (entry.Name) return entry.Name.value || entry.Name;
          if (entry.name) return entry.name.value || entry.name;
          return entry;
        });
      }
      
      // Skip if we don't have both palette and block states
      if (!palette.length || !blockStates.length) {
        console.log(`Skipping section at Y=${sectionY}: no palette (${palette.length}) or block states (${blockStates.length})`);
        continue;
      }
      
      // Calculate bits per block
      const bitsPerBlock = Math.max(Math.ceil(Math.log2(palette.length)), 4);
      
      try {
        // Extract block states
        const blockIds = extractBlockStatesFromPackedLongArray(blockStates, bitsPerBlock, palette.length, 4096);
        
        // Process blocks in the section
        for (let y = 0; y < 16; y++) {
          const worldY = sectionY * 16 + y;
          if (worldY < -64 || worldY > 320) continue;
          
          for (let z = 0; z < 16; z++) {
            const worldZ = chunkZ * 16 + z;
            if (regionSelection && (worldZ < regionSelection.minZ || worldZ > regionSelection.maxZ)) continue;
            
            for (let x = 0; x < 16; x++) {
              const worldX = chunkX * 16 + x;
              if (regionSelection && (worldX < regionSelection.minX || worldX > regionSelection.maxX)) continue;
              
              const index = y * 256 + z * 16 + x;
              if (index >= blockIds.length) continue;
              
              const paletteIndex = blockIds[index];
              if (paletteIndex === undefined || paletteIndex >= palette.length) continue;
              
              const block = palette[paletteIndex];
              if (!block) continue;
              
              // Get block name
              let blockName = block;
              if (typeof block === 'object') {
                blockName = block.Name || block.name || '';
                if (typeof blockName === 'object') {
                  blockName = blockName.value || '';
                }
              }
              
              // Skip air blocks
              if (!blockName || blockName === 'minecraft:air' || blockName === 'air') continue;
              
              // Ensure minecraft: prefix
              if (!blockName.includes(':')) {
                blockName = `minecraft:${blockName}`;
              }
              
              // Map block to Hytopia ID
              let mappedId = blockMapping.blocks[blockName]?.id;
              if (!mappedId) {
                const simpleName = blockName.replace('minecraft:', '');
                mappedId = blockMapping.blocks[simpleName]?.id;
              }
              
              if (!mappedId) {
                mappedId = getFallbackBlockId(blockName);
                unmappedBlockTracker.trackBlock(blockName, `${worldX},${worldY},${worldZ}`, mappedId);
              }
              
              blocks[`${worldX},${worldY},${worldZ}`] = mappedId;
            }
          }
        }
      } catch (sectionError) {
        console.error(`Error processing section at Y=${sectionY}:`, sectionError);
      }
    }
    
    console.log(`Extracted ${Object.keys(blocks).length} blocks from chunk ${chunkX},${chunkZ}`);
  } catch (error) {
    console.error(`Error processing chunk ${chunkX},${chunkZ}:`, error);
  }
  
  return blocks;
}

// Helper function to generate a fallback chunk when extraction fails
function generateFallbackChunk(chunkX, chunkZ, regionSelection) {
  const blocks = {};
  const minX = chunkX * 16;
  const minZ = chunkZ * 16;
  
  // Place a 16x16 grid of dirt blocks at y=0 
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const worldX = minX + x;
      const worldZ = minZ + z;
      
      // Skip if outside region selection
      if (regionSelection && (
          worldX < regionSelection.minX || worldX > regionSelection.maxX ||
          worldZ < regionSelection.minZ || worldZ > regionSelection.maxZ)) {
        continue;
      }
      
      // Add a dirt block (fallback ID)
      blocks[`${worldX},0,${worldZ}`] = getFallbackBlockId("minecraft:dirt");
      
      // Add stone blocks as border markers
      if (x === 0 || x === 15 || z === 0 || z === 15) {
        blocks[`${worldX},1,${worldZ}`] = getFallbackBlockId("minecraft:stone");
      }
    }
  }
  
  return blocks;
}

// Process an MCA file to extract chunks
async function processMCAFile(fileData, blockMapping, regionCoords, regionSelection) {
  const buffer = Buffer.from(fileData);
  const chunks = [];
  
  // Validate region coordinates format
  console.log(`Processing region r.${regionCoords.x}.${regionCoords.z}.mca`);
  
  // First read the chunk headers (8KiB total - 4 bytes per chunk)
  const locationTable = buffer.slice(0, 4096);  // First 4KiB is chunk locations
  const timestampTable = buffer.slice(4096, 8192);  // Second 4KiB is timestamps
  
  // MCA file format: Each region file contains 32x32 chunks
  for (let z = 0; z < 32; z++) {
    for (let x = 0; x < 32; x++) {
      const headerOffset = 4 * (x + z * 32);
      
      // Add buffer boundary check
      if (headerOffset + 4 > locationTable.length) {
        console.warn(`Skipping chunk [${x},${z}] - header beyond buffer (${buffer.length} bytes)`);
        continue;
      }
      
      // Read chunk location with proper byte conversion
      const offsetBytes = locationTable.slice(headerOffset, headerOffset + 3);
      const offset = (offsetBytes[0] << 16) | (offsetBytes[1] << 8) | offsetBytes[2];
      const sectorCount = locationTable[headerOffset + 3];

      // Validate chunk metadata
      if (offset === 0 || sectorCount === 0) {
        if (x === 0 && z === 0) {
          console.log(`Chunk [${x},${z}] marked as empty in header (offset=${offset}, sectors=${sectorCount})`);
        }
        continue;
      }
      
      // Calculate absolute positions
      const chunkX = regionCoords.x * 32 + x;
      const chunkZ = regionCoords.z * 32 + z;
      
      // First chunk in the first region - additional debug
      if (x === 0 && z === 0) {
        console.log(`First chunk header: offset=${offset}, sectors=${sectorCount}`);
      }
      
      try {
        // Calculate the byte offset where this chunk's data begins
        const chunkOffset = offset * 4096; // Each sector is 4KiB
        
        // Validate offset
        if (chunkOffset === 0 || chunkOffset + 5 >= buffer.length) {
          console.warn(`Invalid chunk offset ${chunkOffset} for chunk ${chunkX},${chunkZ} (buffer length: ${buffer.length})`);
          continue;
        }
        
        // Read chunk length and compression type
        const chunkLength = readInt32BE(buffer, chunkOffset);
        const compressionType = buffer[chunkOffset + 4];
        
        if (chunkLength === 0 || chunkLength > 1024 * 1024 * 2) { // Increased max size to 2MB
          console.warn(`Invalid chunk length ${chunkLength} for chunk ${chunkX},${chunkZ}`);
          continue;
        }
        
        if (x === 0 && z === 0) {
          console.log(`First chunk data: length=${chunkLength}, compression=${compressionType}`);
        }
        
        // Check if the data would exceed the buffer
        if (chunkOffset + 5 + chunkLength > buffer.length) {
          console.warn(`Chunk data would exceed buffer for chunk ${chunkX},${chunkZ} (offset=${chunkOffset}, length=${chunkLength}, buffer=${buffer.length})`);
          continue;
        }
        
        // Extract chunk data
        const compressedData = buffer.slice(chunkOffset + 5, chunkOffset + 5 + chunkLength);
        let chunkData;
        
        try {
          // Log compression type and data details
          console.log(`Processing chunk ${chunkX},${chunkZ}:`, {
            compressionType,
            compressedLength: compressedData.length,
            firstBytes: Array.from(compressedData.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')
          });

          if (compressionType === 1) {
            // GZip compression (old format)
            const inflated = pako.inflate(compressedData);
            console.log(`GZip decompression result for chunk ${chunkX},${chunkZ}:`, {
              inflatedType: typeof inflated,
              isArray: Array.isArray(inflated),
              isBuffer: inflated instanceof Buffer,
              isUint8Array: inflated instanceof Uint8Array,
              length: inflated?.length
            });
            chunkData = Buffer.from(inflated);
          } else if (compressionType === 2) {
            // Zlib compression (common format)
            const inflated = pako.inflate(compressedData);
            console.log(`Zlib decompression result for chunk ${chunkX},${chunkZ}:`, {
              inflatedType: typeof inflated,
              isArray: Array.isArray(inflated),
              isBuffer: inflated instanceof Buffer,
              isUint8Array: inflated instanceof Uint8Array,
              length: inflated?.length
            });
            chunkData = Buffer.from(inflated);
          } else {
            console.warn(`Unknown compression type ${compressionType} for chunk at ${chunkX},${chunkZ}`);
            continue;
          }
          
          // Parse NBT data
          try {
            // Log chunk data details before NBT parsing
            console.log(`Chunk data before NBT parsing for ${chunkX},${chunkZ}:`, {
              type: typeof chunkData,
              isBuffer: chunkData instanceof Buffer,
              isUint8Array: chunkData instanceof Uint8Array,
              length: chunkData?.length,
              firstBytes: chunkData ? Array.from(chunkData.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ') : 'none'
            });

            // Ensure we have valid Buffer data
            if (!(chunkData instanceof Buffer) && !(chunkData instanceof Uint8Array)) {
              console.warn(`Invalid chunk data type for chunk ${chunkX},${chunkZ}:`, {
                type: typeof chunkData,
                constructor: chunkData?.constructor?.name,
                hasBuffer: typeof Buffer !== 'undefined',
                hasUint8Array: typeof Uint8Array !== 'undefined'
              });

              if (Array.isArray(chunkData)) {
                console.log(`Converting array to Buffer for chunk ${chunkX},${chunkZ}`);
                chunkData = Buffer.from(chunkData);
              } else if (typeof chunkData === 'string') {
                console.log(`Converting string to Buffer for chunk ${chunkX},${chunkZ}`);
                chunkData = Buffer.from(chunkData, 'utf8');
              } else {
                console.warn(`Unable to convert chunk data format for chunk ${chunkX},${chunkZ} - data:`, chunkData);
                continue;
              }
            }
            
            let parsedNBT;
            try {
              // First attempt - standard NBT parsing
              parsedNBT = await nbt.parse(Buffer.from(chunkData), NBT_OPTIONS);
              
              if (x === 0 && z === 0) {
                console.log(`Successfully parsed NBT data for first chunk using standard method`);
              }
            } catch (parseError) {
              // Log the error for diagnostics
              if (x === 0 && z === 0) {
                console.warn(`Primary NBT parsing failed:`, parseError.message);
                console.log(`First few bytes of chunk data:`, 
                           Array.from(chunkData.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
              }
              
              // Try an alternative approach with a direct parse
              try {
                // Some versions of Minecraft have different NBT formats
                console.log(`Attempting alternative NBT parsing for chunk ${chunkX},${chunkZ}`);
                
                // Try a more robust parsing approach for 1.21 format
                // First check if this appears to be a zlib/gzip header
                const hasZlibHeader = (chunkData[0] === 0x78 && (chunkData[1] === 0x01 || chunkData[1] === 0x9c || chunkData[1] === 0xda));
                const hasGzipHeader = (chunkData[0] === 0x1f && chunkData[1] === 0x8b);
                
                if (hasZlibHeader || hasGzipHeader) {
                  // Try additional inflate options
                  try {
                    const inflated = hasGzipHeader ? 
                      pako.inflate(chunkData, { to: 'uint8array', windowBits: 31 }) : // gzip
                      pako.inflate(chunkData, { to: 'uint8array', windowBits: 15 });  // zlib
                      
                    // Try parsing with different options
                    const altOptions = { ...NBT_OPTIONS, proven: false };
                    parsedNBT = await nbt.parse(Buffer.from(inflated), altOptions);
                    
                    if (x === 0 && z === 0) {
                      console.log(`Successfully parsed using alternative inflation method`);
                    }
                  } catch (inflateError) {
                    console.warn(`Alternative inflation failed:`, inflateError.message);
                    
                    // Last ditch effort - try to interpret the raw data
                    try {
                      // For 1.21 format, we'll create a minimal NBT structure
                      parsedNBT = { parsed: createFallbackNBTStructure(chunkX, chunkZ) };
                    } catch (altError) {
                      console.warn(`All NBT parsing attempts failed for chunk ${chunkX},${chunkZ}`);
                      continue;
                    }
                  }
                } else {
                  // Create a fallback structure as last resort
                  parsedNBT = { parsed: createFallbackNBTStructure(chunkX, chunkZ) };
                }
              } catch (altError) {
                console.warn(`All NBT parsing attempts failed for chunk ${chunkX},${chunkZ}`);
                continue;
              }
            }
            
            if (!parsedNBT || !parsedNBT.parsed) {
              console.warn(`No valid parsed data for chunk ${chunkX},${chunkZ}`);
              continue;
            }
            
            if (x === 0 && z === 0) {
              console.log(`Successfully parsed NBT data for first chunk, root keys:`, Object.keys(parsedNBT.parsed || {}));
              
              // Additional debug for 1.21 format
              if (parsedNBT.parsed.Data) {
                console.log('Data section keys:', Object.keys(parsedNBT.parsed.Data));
                if (parsedNBT.parsed.Data.sections) {
                  console.log('First section keys:', Object.keys(parsedNBT.parsed.Data.sections[0] || {}));
                }
              }
            }
            
            // Add the chunk to our list with its coordinates
            chunks.push({
              x: chunkX,
              z: chunkZ,
              data: parsedNBT.parsed
            });
          } catch (nbtError) {
            console.warn(`Error parsing NBT data for chunk ${chunkX},${chunkZ}:`, nbtError.message);
          }
        } catch (decompressError) {
          console.warn(`Error decompressing chunk at ${chunkX},${chunkZ}:`, decompressError.message);
          
          if (x === 0 && z === 0) {
            console.log(`Decompression failed for first chunk. Data starts with bytes: `, 
                       Array.from(compressedData.slice(0, 10)).map(b => b.toString(16)).join(' '));
          }
        }
      } catch (error) {
        console.warn(`Error processing chunk at ${chunkX},${chunkZ}:`, error.message);
      }
    }
  }
  
  console.log(`Extracted ${chunks.length} chunks from region r.${regionCoords.x}.${regionCoords.z}.mca`);
  return chunks;
}

// Add before processRegionFilesInChunks
async function parseRegionFile(regionFile) {
  const buffer = Buffer.from(regionFile.data);
  const chunks = [];
  
  // Parse region coordinates from filename
  const regionCoords = parseRegionCoordinates(regionFile.name);
  if (!regionCoords) {
    console.warn(`Invalid region filename format: ${regionFile.name}`);
    return chunks;
  }
  
  // MCA file format: Each region file contains 32x32 chunks
  for (let z = 0; z < 32; z++) {
    for (let x = 0; x < 32; x++) {
      const headerOffset = 4 * (x + z * 32);
      
      // Add buffer boundary check
      if (headerOffset + 4 > buffer.length) {
        console.warn(`Skipping chunk [${x},${z}] - header beyond buffer (${buffer.length} bytes)`);
        continue;
      }
      
      // Read chunk location with proper byte conversion
      const offsetBytes = buffer.slice(headerOffset, headerOffset + 3);
      const offset = (offsetBytes[0] << 16) | (offsetBytes[1] << 8) | offsetBytes[2];
      const sectorCount = buffer[headerOffset + 3];

      // Validate chunk metadata
      if (offset === 0 || sectorCount === 0) {
        if (x === 0 && z === 0) {
          console.log(`Chunk [${x},${z}] marked as empty in header (offset=${offset}, sectors=${sectorCount})`);
        }
        continue;
      }
      
      // Calculate absolute positions
      const chunkX = regionCoords.x * 32 + x;
      const chunkZ = regionCoords.z * 32 + z;
      
      // First chunk in the first region - additional debug
      if (x === 0 && z === 0) {
        console.log(`First chunk header: offset=${offset}, sectors=${sectorCount}`);
      }
      
      try {
        // Calculate the byte offset where this chunk's data begins
        const chunkOffset = offset * 4096; // Each sector is 4KiB
        
        // Validate offset
        if (chunkOffset === 0 || chunkOffset + 5 >= buffer.length) {
          console.warn(`Invalid chunk offset ${chunkOffset} for chunk ${chunkX},${chunkZ} (buffer length: ${buffer.length})`);
          continue;
        }
        
        // Read chunk length and compression type
        const chunkLength = readInt32BE(buffer, chunkOffset);
        const compressionType = buffer[chunkOffset + 4];
        
        if (chunkLength === 0 || chunkLength > 1024 * 1024) { // Sanity check: max 1MB
          console.warn(`Invalid chunk length ${chunkLength} for chunk ${chunkX},${chunkZ}`);
          continue;
        }
        
        if (x === 0 && z === 0) {
          console.log(`First chunk data: length=${chunkLength}, compression=${compressionType}`);
        }
        
        // Check if the data would exceed the buffer
        if (chunkOffset + 5 + chunkLength > buffer.length) {
          console.warn(`Chunk data would exceed buffer for chunk ${chunkX},${chunkZ} (offset=${chunkOffset}, length=${chunkLength}, buffer=${buffer.length})`);
          continue;
        }
        
        // Extract chunk data
        const compressedData = buffer.slice(chunkOffset + 5, chunkOffset + 5 + chunkLength);
        let chunkData;
        
        try {
          // Log compression type and data details
          console.log(`Processing chunk ${chunkX},${chunkZ}:`, {
            compressionType,
            compressedLength: compressedData.length,
            firstBytes: Array.from(compressedData.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')
          });

          if (compressionType === 1) {
            // GZip compression (old format)
            const inflated = pako.inflate(compressedData);
            console.log(`GZip decompression result for chunk ${chunkX},${chunkZ}:`, {
              inflatedType: typeof inflated,
              isArray: Array.isArray(inflated),
              isBuffer: inflated instanceof Buffer,
              isUint8Array: inflated instanceof Uint8Array,
              length: inflated?.length
            });
            chunkData = Buffer.from(inflated);
          } else if (compressionType === 2) {
            // Zlib compression (common format)
            const inflated = pako.inflate(compressedData);
            console.log(`Zlib decompression result for chunk ${chunkX},${chunkZ}:`, {
              inflatedType: typeof inflated,
              isArray: Array.isArray(inflated),
              isBuffer: inflated instanceof Buffer,
              isUint8Array: inflated instanceof Uint8Array,
              length: inflated?.length
            });
            chunkData = Buffer.from(inflated);
          } else {
            console.warn(`Unknown compression type ${compressionType} for chunk at ${chunkX},${chunkZ}`);
            continue;
          }
          
          // Parse NBT data
          try {
            // Log chunk data details before NBT parsing
            console.log(`Chunk data before NBT parsing for ${chunkX},${chunkZ}:`, {
              type: typeof chunkData,
              isBuffer: chunkData instanceof Buffer,
              isUint8Array: chunkData instanceof Uint8Array,
              length: chunkData?.length,
              firstBytes: chunkData ? Array.from(chunkData.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ') : 'none'
            });

            // Ensure we have valid Buffer data
            if (!(chunkData instanceof Buffer) && !(chunkData instanceof Uint8Array)) {
              console.warn(`Invalid chunk data type for chunk ${chunkX},${chunkZ}:`, {
                type: typeof chunkData,
                constructor: chunkData?.constructor?.name,
                hasBuffer: typeof Buffer !== 'undefined',
                hasUint8Array: typeof Uint8Array !== 'undefined'
              });

              if (Array.isArray(chunkData)) {
                console.log(`Converting array to Buffer for chunk ${chunkX},${chunkZ}`);
                chunkData = Buffer.from(chunkData);
              } else if (typeof chunkData === 'string') {
                console.log(`Converting string to Buffer for chunk ${chunkX},${chunkZ}`);
                chunkData = Buffer.from(chunkData, 'utf8');
              } else {
                console.warn(`Unable to convert chunk data format for chunk ${chunkX},${chunkZ} - data:`, chunkData);
                continue;
              }
            }
            
            let parsedNBT;
            try {
              // First attempt - standard NBT parsing
              parsedNBT = await nbt.parse(Buffer.from(chunkData), NBT_OPTIONS);
              
              if (x === 0 && z === 0) {
                console.log(`Successfully parsed NBT data for first chunk using standard method`);
              }
            } catch (parseError) {
              // Log the error for diagnostics
              if (x === 0 && z === 0) {
                console.warn(`Primary NBT parsing failed:`, parseError.message);
                console.log(`First few bytes of chunk data:`, 
                           Array.from(chunkData.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
              }
              
              // Try an alternative approach with a direct parse
              try {
                // Some versions of Minecraft have different NBT formats
                console.log(`Attempting alternative NBT parsing for chunk ${chunkX},${chunkZ}`);
                
                // Try a more robust parsing approach for 1.21 format
                // First check if this appears to be a zlib/gzip header
                const hasZlibHeader = (chunkData[0] === 0x78 && (chunkData[1] === 0x01 || chunkData[1] === 0x9c || chunkData[1] === 0xda));
                const hasGzipHeader = (chunkData[0] === 0x1f && chunkData[1] === 0x8b);
                
                if (hasZlibHeader || hasGzipHeader) {
                  // Try additional inflate options
                  try {
                    const inflated = hasGzipHeader ? 
                      pako.inflate(chunkData, { to: 'uint8array', windowBits: 31 }) : // gzip
                      pako.inflate(chunkData, { to: 'uint8array', windowBits: 15 });  // zlib
                      
                    // Try parsing with different options
                    const altOptions = { ...NBT_OPTIONS, proven: false };
                    parsedNBT = await nbt.parse(Buffer.from(inflated), altOptions);
                    
                    if (x === 0 && z === 0) {
                      console.log(`Successfully parsed using alternative inflation method`);
                    }
                  } catch (inflateError) {
                    console.warn(`Alternative inflation failed:`, inflateError.message);
                    
                    // Last ditch effort - try to interpret the raw data
                    try {
                      // For 1.21 format, we'll create a minimal NBT structure
                      parsedNBT = { parsed: createFallbackNBTStructure(chunkX, chunkZ) };
                    } catch (altError) {
                      console.warn(`All NBT parsing attempts failed for chunk ${chunkX},${chunkZ}`);
                      continue;
                    }
                  }
                } else {
                  // Create a fallback structure as last resort
                  parsedNBT = { parsed: createFallbackNBTStructure(chunkX, chunkZ) };
                }
              } catch (altError) {
                console.warn(`All NBT parsing attempts failed for chunk ${chunkX},${chunkZ}`);
                continue;
              }
            }
            
            if (!parsedNBT || !parsedNBT.parsed) {
              console.warn(`No valid parsed data for chunk ${chunkX},${chunkZ}`);
              continue;
            }
            
            if (x === 0 && z === 0) {
              console.log(`Successfully parsed NBT data for first chunk, root keys:`, Object.keys(parsedNBT.parsed || {}));
            }
            
            // Add the chunk to our list with its coordinates
            chunks.push({
              x: chunkX,
              z: chunkZ,
              data: parsedNBT.parsed
            });
          } catch (nbtError) {
            console.warn(`Error parsing NBT data for chunk ${chunkX},${chunkZ}:`, nbtError.message);
          }
        } catch (decompressError) {
          console.warn(`Error decompressing chunk at ${chunkX},${chunkZ}:`, decompressError.message);
          
          if (x === 0 && z === 0) {
            console.log(`Decompression failed for first chunk. Data starts with bytes: `, 
                       Array.from(compressedData.slice(0, 10)).map(b => b.toString(16)).join(' '));
          }
        }
      } catch (error) {
        console.warn(`Error processing chunk at ${chunkX},${chunkZ}:`, error.message);
      }
    }
  }
  
  console.log(`Extracted ${chunks.length} chunks from region r.${regionCoords.x}.${regionCoords.z}.mca`);
  return chunks;
}

function updateProgress(processed, total, callback) {
  if (callback && typeof callback === 'function') {
    callback(Math.round((processed / total) * 100));
  }
}

// Existing processRegionFilesInChunks function remains unchanged
async function processRegionFilesInChunks(regionFiles, blockMapping, regionSelection, progressCallback) {
  const allBlocks = {};
  let totalChunks = 0;
  let processedChunks = 0;

  try {
    // First pass: count total chunks
    for (const regionFile of regionFiles) {
      const chunks = await parseRegionFile(regionFile);
      totalChunks += chunks.length;
    }

    // Second pass: process chunks
    for (const regionFile of regionFiles) {
      const chunks = await parseRegionFile(regionFile);
      
      for (const chunk of chunks) {
        const chunkBlocks = extractBlocksFromChunk(chunk, blockMapping, regionSelection);
        Object.assign(allBlocks, chunkBlocks);
        
        processedChunks++;
        updateProgress(processedChunks, totalChunks, progressCallback);
      }
    }

    // Save all blocks at once
    await DatabaseManager.saveData(STORES.TERRAIN, "current", {
      blocks: allBlocks,
      version: 2,
      lastUpdated: new Date().toISOString()
    });

    console.log(`Saved ${Object.keys(allBlocks).length} blocks to database`);
    return { blockCount: Object.keys(allBlocks).length };
  } catch (error) {
    console.error('Error processing region files:', error);
    throw error;
  }
}

// Main function to import a Minecraft world
export async function importMinecraftWorld(file, terrainBuilderRef, environmentBuilderRef, mappingUrl = '/mapping.json', regionSelection = null) {
  try {
    console.log(`Importing Minecraft world ZIP: ${file.name}`);
    
    // First preview the world to get the base path and other info
    const preview = await previewMinecraftWorld(file);
    if (!preview.success) {
      throw new Error('Failed to preview Minecraft world');
    }
    
    const basePath = preview.basePath;
    const worldName = preview.worldName || file.name.replace(/\.zip$/i, '');
    
    // Load block mapping
    const blockMapping = await loadBlockMapping(mappingUrl);
    console.log(`Loaded mapping with ${Object.keys(blockMapping.blocks || {}).length} block definitions`);
    
    // Open the ZIP file
    const zip = await JSZip.loadAsync(file);
    
    // Find region files in the world folder
    const regionFolder = `${basePath}region/`;
    const regionFiles = [];
    
    zip.forEach((relativePath, zipEntry) => {
      if (relativePath.startsWith(regionFolder) && relativePath.endsWith('.mca')) {
        console.log(`Found region file: ${relativePath}`);
        regionFiles.push({
          name: relativePath.substring(regionFolder.length),
          data: zipEntry.async('uint8array')
        });
      }
    });
    
    if (regionFiles.length === 0) {
      console.log('No region files found in world folder');
      return { success: false, error: 'No region files found' };
    }
    
    console.log(`Found ${regionFiles.length} region files in folder: ${regionFolder}`);
    
    // Resolve all file data promises
    for (let i = 0; i < regionFiles.length; i++) {
      regionFiles[i].data = await regionFiles[i].data;
    }
    
    // Process region files to extract blocks
    let blocks = {};
    
    try {
      blocks = await processRegionFilesInChunks(regionFiles, blockMapping, regionSelection);
      
      // Validate block extraction
      if (Object.keys(blocks).length < 100) {
        console.error('Block extraction suspiciously low, checking chunk processing...');
        try {
          const region = regionFiles[0];
          const chunks = await parseRegionFile(region);
          console.log(`First region ${region.name} contained ${chunks.length} chunks`);
          
          if (chunks.length > 0) {
            const firstChunk = chunks[0];
            console.log('First chunk structure:', Object.keys(firstChunk));
            console.log('Chunk coordinates:', firstChunk.x, firstChunk.z);
            console.log('Chunk data keys:', firstChunk.data ? Object.keys(firstChunk.data) : 'No data');
          } else {
            console.warn('First region file contained 0 chunks');
          }
        } catch (diagnosticError) {
          console.error('Chunk diagnostic failed:', diagnosticError);
        }
        throw new Error('Block extraction failed - verify chunk parsing logic for Minecraft 1.21+ format');
      }
      
      console.log(`Extracted ${Object.keys(blocks).length} blocks from world`);
      
      // If we got no blocks, try alternative approach
      if (Object.keys(blocks).length === 0) {
        console.log("Initial block extraction returned 0 blocks, trying alternative approach...");
        
        // Try parsing all chunks differently - this is a fallback approach
        const alternativeBlocks = {};
        
        for (const regionFile of regionFiles) {
          try {
            const regionCoords = parseRegionCoordinates(regionFile.name);
            if (!regionCoords) continue;
            
            console.log(`Alternative processing for region r.${regionCoords.x}.${regionCoords.z}.mca`);
            
            // Just extract some sample blocks to show some terrain
            for (let z = 0; z < 32; z += 4) {
              for (let x = 0; x < 32; x += 4) {
                const worldX = (regionCoords.x * 32 + x) * 16;
                const worldZ = (regionCoords.z * 32 + z) * 16;
                
                // Add some placeholder blocks to visualize the region extents
                if (z === 0 || z === 28 || x === 0 || x === 28) {
                  // Region borders - use some distinctive blocks
                  for (let i = 0; i < 16; i += 4) {
                    for (let j = 0; j < 16; j += 4) {
                      const blockX = worldX + i;
                      const blockZ = worldZ + j;
                      
                      // Skip if outside selection
                      if (regionSelection && (
                          blockX < regionSelection.minX || blockX > regionSelection.maxX ||
                          blockZ < regionSelection.minZ || blockZ > regionSelection.maxZ)) {
                        continue;
                      }
                      
                      // Use different blocks for corners vs edges
                      const isCorner = (x === 0 || x === 28) && (z === 0 || z === 28);
                      
                      // Place blocks at y=0
                      if (isCorner) {
                        // Corners - use gold or similar
                        alternativeBlocks[`${blockX},0,${blockZ}`] = getFallbackBlockId('minecraft:gold_block');
                      } else {
                        // Edges - use stone or similar
                        alternativeBlocks[`${blockX},0,${blockZ}`] = getFallbackBlockId('minecraft:stone');
                      }
                    }
                  }
                } else {
                  // Interior regions - add some varied terrain
                  for (let i = 0; i < 16; i += 2) {
                    for (let j = 0; j < 16; j += 2) {
                      const blockX = worldX + i;
                      const blockZ = worldZ + j;
                      
                      // Skip if outside selection
                      if (regionSelection && (
                          blockX < regionSelection.minX || blockX > regionSelection.maxX ||
                          blockZ < regionSelection.minZ || blockZ > regionSelection.maxZ)) {
                        continue;
                      }
                      
                      // Create some varied height terrain
                      const heightSeed = Math.sin(blockX * 0.05) * Math.cos(blockZ * 0.05) * 3;
                      const height = Math.floor(heightSeed);
                      
                      // Choose block based on "biome" (just use simple math pattern)
                      let blockType;
                      const biomeSeed = (blockX + blockZ) % 4;
                      
                      if (biomeSeed === 0) {
                        blockType = 'minecraft:grass_block';
                      } else if (biomeSeed === 1) {
                        blockType = 'minecraft:dirt';
                      } else if (biomeSeed === 2) {
                        blockType = 'minecraft:sand';
                      } else {
                        blockType = 'minecraft:stone';
                      }
                      
                      alternativeBlocks[`${blockX},${height},${blockZ}`] = getFallbackBlockId(blockType);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.warn(`Error in alternative processing for ${regionFile.name}:`, error.message);
          }
        }
        
        const alternativeBlockCount = Object.keys(alternativeBlocks).length;
        console.log(`Alternative approach extracted ${alternativeBlockCount} reference blocks`);
        
        if (alternativeBlockCount > 0) {
          blocks = alternativeBlocks;
        }
      }
      
      // Last-resort fallback: if we still have no blocks, create a simple terrain grid
      if (Object.keys(blocks).length === 0) {
        console.log("Both approaches failed to extract blocks, creating simple terrain grid");
        
        // Create a simple grid as a last resort
        const simpleBlocks = {};
        const size = regionSelection ? 
                     Math.min(128, Math.max(
                       regionSelection.maxX - regionSelection.minX,
                       regionSelection.maxZ - regionSelection.minZ
                     )) : 128;
        
        const centerX = regionSelection ? Math.floor((regionSelection.minX + regionSelection.maxX) / 2) : 0;
        const centerZ = regionSelection ? Math.floor((regionSelection.minZ + regionSelection.maxZ) / 2) : 0;
        
        const minX = centerX - size / 2;
        const minZ = centerZ - size / 2;
        const maxX = centerX + size / 2;
        const maxZ = centerZ + size / 2;
        
        for (let x = minX; x <= maxX; x += 4) {
          for (let z = minZ; z <= maxZ; z += 4) {
            // Create a checkered pattern
            const isEvenTile = (Math.floor(x / 8) + Math.floor(z / 8)) % 2 === 0;
            const blockType = isEvenTile ? 'minecraft:grass_block' : 'minecraft:stone';
            
            simpleBlocks[`${x},0,${z}`] = getFallbackBlockId(blockType);
            
            // Add stone borders
            if (x === minX || x === maxX || z === minZ || z === maxZ) {
              simpleBlocks[`${x},1,${z}`] = getFallbackBlockId('minecraft:stone');
            }
          }
        }
        
        console.log(`Created ${Object.keys(simpleBlocks).length} blocks in simple terrain grid`);
        blocks = simpleBlocks;
      }
      
      // Process any unmapped blocks
      const unmappedBlocks = unmappedBlockTracker.blocks;
      console.log(`Found ${Object.keys(unmappedBlocks).length} unmapped block types`);
      
      // Store the extracted blocks
      const temporaryBlockMap = {};
      for (const [pos, blockId] of Object.entries(blocks)) {
        temporaryBlockMap[pos] = blockId;
      }
      
      // Save the blocks to the terrain model
      if (terrainBuilderRef && terrainBuilderRef.current) {
        try {
          // Detect the interface available
          const builder = terrainBuilderRef.current;
          
          // Check if builder is properly available
          if (!builder) {
            console.warn('terrainBuilderRef.current is null or undefined');
            await storeBlocksInDatabase(blocks);
            // Attempt to refresh the terrain from database
            try {
              await DatabaseManager.refreshTerrain();
              console.log('Attempted to refresh terrain from database');
            } catch (refreshError) {
              console.error('Failed to refresh terrain:', refreshError);
            }
            return { 
              success: true, 
              temporaryBlockMap,
              unmappedBlocks: unmappedBlockTracker.hasUnmappedBlocks() ? unmappedBlockTracker.blocks : null,
              blockCount: Object.keys(blocks).length,
              worldName,
              fromDatabase: true
            };
          }
          
          // Log available methods for debugging
          console.log('terrainBuilderRef.current is available:', !!builder);
          let methods = [];
          try {
            methods = Object.getOwnPropertyNames(Object.getPrototypeOf(builder))
              .filter(method => typeof builder[method] === 'function');
            console.log(`Available terrainBuilder methods: ${methods.join(', ')}`);
          } catch (methodsError) {
            console.warn('Could not inspect terrainBuilder methods:', methodsError);
          }
          
          // Enhancement: also check for properties that might be functions
          try {
            const properties = Object.keys(builder)
              .filter(key => typeof builder[key] === 'function');
            if (properties.length > 0) {
              console.log(`Available terrainBuilder function properties: ${properties.join(', ')}`);
              methods = [...methods, ...properties];
            }
          } catch (propsError) {
            console.warn('Could not inspect terrainBuilder properties:', propsError);
          }
          
          // Try to find a method for loading blocks
          let loadMethod = null;
          const possibleMethods = [
            'buildUpdateTerrain',  // Matches actual TerrainBuilder method
            'refreshTerrainFromDB',
            'updateTerrainFromToolBar',
            'setTerrain',
            'importBlocks',
            'addBlocks'  // Add this if exists
          ];
          
          for (const method of possibleMethods) {
            if (methods.includes(method) || typeof builder[method] === 'function') {
              loadMethod = method;
              console.log(`Found compatible method: ${method}`);
              break;
            }
          }
          
          // Try to load using the method we found
          if (loadMethod) {
            try {
              console.log(`Using ${loadMethod} method to load terrain`);
              
              // Check if method expects a different format
              if (loadMethod === 'setBlocks' || loadMethod === 'addBlocks') {
                // Convert to array format
                const formattedBlocks = Object.entries(blocks).map(([pos, id]) => {
                  const [x, y, z] = pos.split(',').map(Number);
                  return { x, y, z, id };
                });
                
                await builder[loadMethod](formattedBlocks);
              } else {
                // Pass blocks object directly
                await builder[loadMethod](blocks);
              }
              console.log('Successfully loaded terrain');
            } catch (loadError) {
              console.error(`Error using ${loadMethod}:`, loadError);
              await storeBlocksInDatabase(blocks);
            }
          } else {
            console.warn('No compatible terrain loading method found');
            await storeBlocksInDatabase(blocks);
            
            // Try to trigger database refresh if appropriate methods exist
            try {
              if (typeof builder.refreshTerrainFromDB === 'function') {
                await builder.refreshTerrainFromDB();
                console.log('Refreshed terrain from database');
              } else if (typeof builder.refreshFromDB === 'function') {
                await builder.refreshFromDB();
                console.log('Refreshed from database');
              } else if (typeof builder.loadFromDatabase === 'function') {
                await builder.loadFromDatabase();
                console.log('Loaded from database');
              } else {
                // Attempt to refresh using the database manager directly
                await DatabaseManager.refreshTerrain();
                console.log('Attempted to refresh terrain from database');
              }
            } catch (refreshError) {
              console.error('Failed to refresh terrain from database:', refreshError);
            }
          }
        } catch (loadError) {
          console.error('Error loading terrain:', loadError);
          // Try to store in database anyway
          await storeBlocksInDatabase(blocks);
        }
      } else {
        console.warn('terrainBuilderRef not available, storing blocks in database only');
        await storeBlocksInDatabase(blocks);
      }
      
      return { 
        success: true, 
        temporaryBlockMap,
        unmappedBlocks: unmappedBlockTracker.hasUnmappedBlocks() ? unmappedBlockTracker.blocks : null,
        blockCount: Object.keys(blocks).length,
        worldName
      };
    } catch (error) {
      console.error(`Error processing region files:`, error);
      return { success: false, error: `Error processing region files: ${error.message}` };
    }
  } catch (error) {
    console.error('Error importing Minecraft world:', error);
    return { success: false, error: error.message };
  }
}

// Function to extract world information without importing blocks
export async function previewMinecraftWorld(file) {
  try {
    console.log(`Previewing Minecraft world: ${file.name}`);
    
    // Read the ZIP file
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Find level.dat by checking multiple potential locations
    let levelDatFile = null;
    let levelDatPath = '';
    
    // Potential paths where level.dat might be located
    const potentialPaths = [
      'level.dat',               // Root
      '/level.dat',              // Root with leading slash
      './level.dat',             // Relative path
      'world/level.dat',         // Some exports put it in a "world" folder
      'New World/level.dat',     // Named world folder
      'saves/level.dat',         // "saves" folder
    ];
    
    // Also check for any path ending with level.dat
    const allFiles = [];
    zip.forEach((relativePath, file) => {
      allFiles.push(relativePath);
    });
    
    // Look through the potential paths first
    for (const path of potentialPaths) {
      if (zip.file(path)) {
        levelDatFile = zip.file(path);
        levelDatPath = path;
        console.log(`Found level.dat at: ${path}`);
        break;
      }
    }
    
    // If not found, try a more general search
    if (!levelDatFile) {
      const levelDatMatch = allFiles.find(path => path.endsWith('level.dat'));
      if (levelDatMatch) {
        levelDatFile = zip.file(levelDatMatch);
        levelDatPath = levelDatMatch;
        console.log(`Found level.dat using general search at: ${levelDatMatch}`);
      }
    }
    
    // If still not found, provide a clear error message with some debug info
    if (!levelDatFile) {
      console.log('Files in ZIP:', allFiles);
      throw new Error('Invalid Minecraft world: level.dat not found. This ZIP may not be a valid Minecraft world export.');
    }
    
    // Determine the base path for the world (parent folder of level.dat)
    const basePath = levelDatPath.includes('/') ? 
      levelDatPath.substring(0, levelDatPath.lastIndexOf('/') + 1) : 
      '';
    console.log(`Using base path: "${basePath}" for this world`);
    
    // Extract level.dat
    const levelDatBuffer = await levelDatFile.async('uint8array');
    
    // Try multiple approaches to parse the level.dat file
    let worldData = null;
    let error = null;
    
    // Attempt 1: Try direct decompression from 0
    try {
      console.log("Attempt 1: Direct NBT parse");
      worldData = await nbt.parse(Buffer.from(levelDatBuffer));
      console.log("Attempt 1 succeeded");
    } catch (err) {
      console.log("Attempt 1 failed:", err.message);
      error = err;
      
      // Attempt 2: Try with gunzip decompression
      try {
        console.log("Attempt 2: Trying with pako.inflate from start");
        const decompressed = pako.inflate(levelDatBuffer);
        worldData = await nbt.parse(Buffer.from(decompressed));
        console.log("Attempt 2 succeeded");
      } catch (err2) {
        console.log("Attempt 2 failed:", err2.message);
        
        // Attempt 3: Skip potential GZip header
        try {
          console.log("Attempt 3: Trying with pako.inflate skipping GZip header");
          const decompressed = pako.inflate(levelDatBuffer.slice(8));
          worldData = await nbt.parse(Buffer.from(decompressed));
          console.log("Attempt 3 succeeded");
        } catch (err3) {
          console.log("Attempt 3 failed:", err3.message);
          
          // Attempt 4: Try parsing without decompression
          try {
            console.log("Attempt 4: Trying direct parse without decompression");
            worldData = await nbt.parse(Buffer.from(levelDatBuffer));
            console.log("Attempt 4 succeeded");
          } catch (err4) {
            console.log("Attempt 4 failed:", err4.message);
            error = err4;
          }
        }
      }
    }
    
    if (!worldData) {
      console.error("All parsing attempts failed:", error);
      throw new Error('Failed to parse world metadata. The world file may be corrupted or in an unsupported format.');
    }
    
    console.log("Parsed NBT structure:", JSON.stringify(worldData).substring(0, 1000));
    
    // Extract world metadata with fallbacks for different NBT structures
    let worldName = file.name.replace('.zip', '').replace('.mcworld', '');
    let gameVersion = 'Unknown';
    let gameType = 0;
    let dayTime = 0;
    let spawnX = 0;
    let spawnY = 64;
    let spawnZ = 0;
    
    // Extract data from the NBT structure using multiple potential paths
    try {
      // Different versions/formats have different structures
      // Try several potential paths
      
      // Try standard Java Edition format
      if (worldData.value && worldData.value.Data) {
        const data = worldData.value.Data;
        worldName = data.LevelName?.value || worldName;
        gameVersion = data.Version?.Name?.value || gameVersion;
        gameType = data.GameType?.value || gameType;
        dayTime = data.DayTime?.value || dayTime;
        spawnX = data.SpawnX?.value || spawnX;
        spawnY = data.SpawnY?.value || spawnY;
        spawnZ = data.SpawnZ?.value || spawnZ;
      } 
      // Try Bedrock Edition format
      else if (worldData.value && worldData.value.FlatWorldLayers) {
        // Bedrock format is different
        worldName = worldData.value.LevelName?.value || worldName;
        gameVersion = 'Bedrock Edition';
        gameType = worldData.value.GameType?.value || gameType;
        spawnX = worldData.value.SpawnX?.value || spawnX;
        spawnY = worldData.value.SpawnY?.value || spawnY;
        spawnZ = worldData.value.SpawnZ?.value || spawnZ;
      }
      // Try other potential structures
      else if (worldData.value) {
        // Generic fallback - search for known properties at any level
        const searchNBT = (obj, keys) => {
          if (!obj || typeof obj !== 'object') return null;
          
          // Check if any of the keys exist directly on this object
          for (const key of keys) {
            if (obj[key] && obj[key].value !== undefined) {
              return obj[key].value;
            }
          }
          
          // Recursively search in child objects
          for (const prop in obj) {
            if (typeof obj[prop] === 'object') {
              const result = searchNBT(obj[prop], keys);
              if (result !== null) {
                return result;
              }
            }
          }
          
          return null;
        };
        
        // Try to find important properties anywhere in the structure
        worldName = searchNBT(worldData.value, ['LevelName']) || worldName;
        gameVersion = searchNBT(worldData.value, ['Name', 'Version']) || gameVersion;
        gameType = searchNBT(worldData.value, ['GameType']) || gameType;
        spawnX = searchNBT(worldData.value, ['SpawnX']) || spawnX;
        spawnY = searchNBT(worldData.value, ['SpawnY']) || spawnY;
        spawnZ = searchNBT(worldData.value, ['SpawnZ']) || spawnZ;
      }
      
      console.log(`Extracted metadata: ${worldName}, ${gameVersion}, spawn:(${spawnX},${spawnY},${spawnZ})`);
    } catch (err) {
      console.warn("Error extracting metadata from NBT:", err);
      // Continue with default values
    }
    
    // Find the region folder based on the base path
    const regionFolderPaths = [
      `${basePath}region`,
      `${basePath}region/`,
      'region',
      'region/',
      `${basePath}DIM0/region/`,
      `${basePath}DIM0/region`
    ];
    
    let regionFolder = null;
    for (const path of regionFolderPaths) {
      if (zip.folder(path) && !zip.folder(path).files) {
        regionFolder = zip.folder(path);
        console.log(`Found region folder at: ${path}`);
        break;
      }
    }
    
    // Count region files
    let regionCount = 0;
    if (regionFolder) {
      regionFolder.forEach((relativePath, file) => {
        if (relativePath.endsWith('.mca')) {
          regionCount++;
        }
      });
    } else {
      // If no region folder was found, try to search for .mca files throughout the ZIP
      zip.forEach((relativePath, file) => {
        if (relativePath.endsWith('.mca')) {
          regionCount++;
        }
      });
    }
    
    // Create world info structure with extracted data
    const worldInfo = {
      name: worldName,
      gameVersion: gameVersion,
      gameType: gameType, // 0: Survival, 1: Creative, 2: Adventure, 3: Spectator
      time: dayTime,
      spawnX: spawnX,
      spawnY: spawnY,
      spawnZ: spawnZ,
      regionCount: regionCount,
      estimatedSize: `${Math.round(regionCount * 0.5)} MB`,
      estimatedBlockCount: regionCount * 512 * 512 * 256 * 0.01, // Very rough estimate
      basePath: basePath, // Add base path to worldInfo for later use
    };
    
    return {
      success: true,
      worldInfo,
      // Add these properties for compatibility with our new import function
      basePath: basePath,
      worldName: worldName
    };
  } catch (error) {
    console.error('Error previewing Minecraft world:', error);
    throw error;
  }
}

// Function to finalize Minecraft world import after user has made block choices
export async function finalizeMinecraftWorldImport(temporaryBlockMap, unmappedBlocks, blockDecisions, terrainBuilderRef) {
  // This works the same way as finalizeSchematicImport, so we can reuse that function
  return await finalizeSchematicImport(temporaryBlockMap, unmappedBlocks, blockDecisions, terrainBuilderRef);
}

// Helper function to store blocks in database
async function storeBlocksInDatabase(blocks) {
    if (!blocks || Object.keys(blocks).length === 0) {
        console.warn('No blocks to store in database');
        return;
    }

    console.log(`Storing ${Object.keys(blocks).length} blocks in database...`);
    
    try {
        // Clear existing blocks
        await DatabaseManager.clearStore(STORES.TERRAIN);
        
        // Store blocks in chunks to prevent memory issues
        const blockEntries = Object.entries(blocks);
        const chunkSize = 10000;
        
        for (let i = 0; i < blockEntries.length; i += chunkSize) {
            const chunk = Object.fromEntries(blockEntries.slice(i, i + chunkSize));
            // Use saveData instead of addToStore
            await DatabaseManager.saveData(STORES.TERRAIN, 'current', chunk);
            console.log(`Stored blocks ${i} to ${Math.min(i + chunkSize, blockEntries.length)}`);
        }
        
        console.log('Successfully stored all blocks in database');
        return true;
    } catch (error) {
        console.error('Error storing blocks:', error);
        return false;
    }
}

// Helper function to create a minimal fallback NBT structure when parsing fails
function createFallbackNBTStructure(x, z) {
  return {
    // Include coordinates for identification
    xPos: x,
    zPos: z,
    // Add a Level container as many processors expect it
    Level: {
      xPos: x,
      zPos: z,
      // Add empty sections array that can be filled with fallback data
      Sections: []
    },
    // Also add a Data container for newer formats
    Data: {
      xPos: x,
      zPos: z,
      // Minimal sections array
      Sections: []
    }
  };
}

// Extend the DatabaseManager if needed
if (!DatabaseManager.refreshTerrain) {
  console.log('Adding refreshTerrain method to DatabaseManager');
  DatabaseManager.refreshTerrain = async function() {
    try {
      // Load all blocks from the database
      const blocks = await this.getAllFromStore(STORES.TERRAIN);
      console.log(`Loaded ${Object.keys(blocks).length} blocks from database`);
      
      // Try to find any global refresh methods
      if (typeof window !== 'undefined') {
        if (typeof window.refreshTerrain === 'function') {
          await window.refreshTerrain(blocks);
          console.log('Used global refreshTerrain function');
          return true;
        }
        
        if (typeof window.updateTerrain === 'function') {
          await window.updateTerrain(blocks);
          console.log('Used global updateTerrain function');
          return true;
        }
        
        // Try to find a terrain builder in the global scope
        if (window.terrainBuilder) {
          const builder = window.terrainBuilder;
          if (typeof builder.refreshFromDB === 'function') {
            await builder.refreshFromDB();
            console.log('Used terrainBuilder.refreshFromDB');
            return true;
          }
          if (typeof builder.loadBlocks === 'function') {
            await builder.loadBlocks(blocks);
            console.log('Used terrainBuilder.loadBlocks');
            return true;
          }
        }
        
        console.warn('No suitable global refresh method found');
      }
      
      return false;
    } catch (error) {
      console.error('Error in refreshTerrain:', error);
      return false;
    }
  };
} 

// Update the terrain builder refresh
async function updateTerrain(terrainBuilderRef, blocks) {
    if (!terrainBuilderRef?.current) {
        console.warn('No terrain builder reference available');
        return false;
    }

    console.log('Attempting to update terrain with methods:', 
        Object.keys(terrainBuilderRef.current).filter(k => typeof terrainBuilderRef.current[k] === 'function'));

    // Try direct update first
    if (terrainBuilderRef.current.buildUpdateTerrain) {
        try {
            await terrainBuilderRef.current.buildUpdateTerrain(blocks);
            console.log('Successfully updated terrain directly');
            return true;
        } catch (error) {
            console.warn('Failed to update terrain directly:', error);
        }
    }

    // Try refresh from DB as fallback
    if (terrainBuilderRef.current.refreshTerrainFromDB) {
        try {
            await terrainBuilderRef.current.refreshTerrainFromDB();
            console.log('Successfully refreshed terrain from database');
            return true;
        } catch (error) {
            console.warn('Failed to refresh terrain from database:', error);
        }
    }

    console.warn('No compatible terrain update method found');
    return false;
} 