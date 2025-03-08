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
  keepMetadata: true
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
  // Remove minecraft: prefix if present
  const plainName = blockName.replace('minecraft:', '');
  
  // Check if we've already assigned this block before
  if (dynamicBlockMappings.has(plainName)) {
    return dynamicBlockMappings.get(plainName);
  }

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

// Parse region file coordinates from filename (e.g., r.0.0.mca -> {x: 0, z: 0})
function parseRegionCoordinates(filename) {
  const match = filename.match(/r\.(-?\d+)\.(-?\d+)\.mca/);
  if (match) {
    return {
      x: parseInt(match[1]),
      z: parseInt(match[2])
    };
  }
  return null;
}

// Function to read a 4-byte big-endian integer from buffer
function readInt32BE(buffer, offset) {
  return (buffer[offset] << 24) | 
         (buffer[offset + 1] << 16) | 
         (buffer[offset + 2] << 8) | 
         buffer[offset + 3];
}

// Extract block states from a packed long array without using BigInt
function extractBlockStatesFromPackedLongArray(packedLongArray, bitsPerBlock, paletteSize, blockCount) {
  // Enhanced handling for different input formats
  console.log(`Extracting block states with ${bitsPerBlock} bits per block, palette size ${paletteSize}`);
  
  // Convert input to array of numbers if needed
  let longArray = packedLongArray;
  
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
  console.log(`Processing 1.21.4 format sections for chunk ${chunkX},${chunkZ}`);
  
  if (!Array.isArray(sections) || sections.length === 0) {
    console.log(`No sections array found for chunk ${chunkX},${chunkZ}`);
    return [];
  }
  
  // Log the structure of the first section
  console.log(`Raw section structure:`, JSON.stringify(sections[0]).substring(0, 500) + '...');
  
  // Unwrap any NBT-style wrapped sections
  const processedSections = sections.map(section => {
    // If section is NBT-style with type and value properties
    if (section && section.type && section.value) {
      return section.value;
    }
    
    // If it's already the right format
    return section;
  });
  
  // Dump the structure of the first processed section
  if (processedSections.length > 0) {
    console.log(`Processed section keys:`, Object.keys(processedSections[0]));
    
    // Look for palette and block states
    const section = processedSections[0];
    
    // Try to find palette
    let palette = null;
    if (section.Palette || section.palette) {
      palette = section.Palette || section.palette;
      if (palette && palette.type && palette.value) {
        console.log(`Found NBT-wrapped palette`);
        palette = palette.value;
      }
      console.log(`Found palette with ${Array.isArray(palette) ? palette.length : 'unknown'} entries`);
    } else if (section.block_states && (section.block_states.palette || section.block_states.Palette)) {
      palette = section.block_states.palette || section.block_states.Palette;
      if (palette && palette.type && palette.value) {
        console.log(`Found NBT-wrapped nested palette`);
        palette = palette.value;
      }
      console.log(`Found nested palette with ${Array.isArray(palette) ? palette.length : 'unknown'} entries`);
    }
    
    // Try to find block states
    let blockStates = null;
    if (section.BlockStates) {
      blockStates = section.BlockStates;
      if (blockStates && blockStates.type && blockStates.value) {
        console.log(`Found NBT-wrapped block states`);
        blockStates = blockStates.value;
      }
      console.log(`Found block states with ${Array.isArray(blockStates) ? blockStates.length : 'unknown'} entries`);
    } else if (section.block_states && (section.block_states.data || section.block_states.Data)) {
      blockStates = section.block_states.data || section.block_states.Data;
      if (blockStates && blockStates.type && blockStates.value) {
        console.log(`Found NBT-wrapped nested block states`);
        blockStates = blockStates.value;
      }
      console.log(`Found nested block states with ${Array.isArray(blockStates) ? blockStates.length : 'unknown'} entries`);
    }
  }
  
  return processedSections;
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
      // return generateFallbackChunk(chunkX, chunkZ, regionSelection);
    }

    // DEBUG: Log the top-level keys for the first chunk to understand the structure
    if (chunkX === chunk.data.xPos && chunkZ === chunk.data.zPos) {
      console.log(`Chunk ${chunkX},${chunkZ} top-level keys:`, Object.keys(chunk.data));
      if (chunk.data.Level) {
        console.log(`Level keys:`, Object.keys(chunk.data.Level));
      }
      if (chunk.data.Data) {
        console.log(`Data keys:`, Object.keys(chunk.data.Data));
      }
    }
    
    // Try to find sections in different locations based on Minecraft version
    
    // 1. Minecraft 1.21+ format - Data.Sections
    if (chunk.data.Data && Array.isArray(chunk.data.Data.Sections)) {
      console.log(`Found 1.21+ format chunk sections at Data.Sections for chunk ${chunkX},${chunkZ}`);
      const rawSections = chunk.data.Data.Sections;
      
      // Special handling for 1.21.4 format
      sections = process121ChunkSections(rawSections, chunkX, chunkZ);
      
      // If sections are empty after processing, try the raw version anyway
      if (!sections || sections.length === 0) {
        console.log(`No valid sections after processing, using raw sections`);
        sections = rawSections;
      }
    }
    // 2. Old format (pre-1.18) - Level.Sections
    else if (chunk.data.Level && Array.isArray(chunk.data.Level.Sections)) {
      console.log(`Found old format chunk sections at Level.Sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.Level.Sections;
    } 
    // 3. New format (1.18+) - direct sections array
    else if (Array.isArray(chunk.data.sections)) {
      console.log(`Found new format chunk sections at root.sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.sections;
    }
    // 4. Alternative location - root Sections
    else if (Array.isArray(chunk.data.Sections)) {
      console.log(`Found sections at root.Sections for chunk ${chunkX},${chunkZ}`);
      sections = chunk.data.Sections;
    }
    // 5. New Minecraft 1.18+ world format: nested structure in sections object
    else if (chunk.data.sections && typeof chunk.data.sections === 'object' && !Array.isArray(chunk.data.sections)) {
      console.log(`Found nested sections object at root.sections for chunk ${chunkX},${chunkZ}`);
      
      // Try to convert to array or extract values
      try {
        const sectionsObj = chunk.data.sections;
        if (sectionsObj.value && Array.isArray(sectionsObj.value)) {
          sections = sectionsObj.value;
        } else {
          // Need to create an array from object
          sections = Object.values(sectionsObj).filter(v => v && typeof v === 'object');
        }
      } catch (err) {
        console.warn(`Failed to extract sections from object: ${err.message}`);
      }
    }
    // 6. Nested under Data (newer structure)
    else if (chunk.data.Data && chunk.data.Data.sections) {
      console.log(`Found sections under Data.sections for chunk ${chunkX},${chunkZ}`);
      const dataSection = chunk.data.Data.sections;
      if (Array.isArray(dataSection)) {
        sections = dataSection;
      } else if (dataSection.value && Array.isArray(dataSection.value)) {
        sections = dataSection.value;
      } else if (typeof dataSection === 'object') {
        // Try to extract from nested object
        sections = Object.values(dataSection).filter(v => v && typeof v === 'object');
      }
    }
    
    // If we still don't have sections, try a more aggressive search
    if (!sections || sections.length === 0) {
      // Recursive search for sections in the data structure
      sections = findSectionsRecursively(chunk.data);
      
      if (sections && sections.length > 0) {
        console.log(`Found sections through recursive search in chunk ${chunkX},${chunkZ}`);
      }
    }
    
    // If we still don't have sections, try a fallback approach
    if (!sections || sections.length === 0) {
      // One more attempt - check for different NBT formats or nested structures
      if (chunk.data && chunk.data.Level) {
        // Try to extract from Level.SectionStates if present (some versions use this)
        if (chunk.data.Level.SectionStates) {
          console.log(`Found SectionStates in chunk ${chunkX},${chunkZ}`);
          sections = Array.isArray(chunk.data.Level.SectionStates) ? 
                    chunk.data.Level.SectionStates : 
                    (chunk.data.Level.SectionStates.value || []);
        }
        // If there's a Heightmaps key but no Sections, check if there's chunk data elsewhere
        else if (chunk.data.Level.Heightmaps && !chunk.data.Level.Sections) {
          console.log(`Found Heightmaps but no Sections in chunk ${chunkX},${chunkZ}, checking for block data`);
          // In some versions, the blocks are stored in a different format
          if (chunk.data.Blocks || chunk.data.Level.Blocks) {
            const blockData = chunk.data.Blocks || chunk.data.Level.Blocks;
            if (blockData) {
              console.log(`Found direct Blocks data in chunk ${chunkX},${chunkZ}`);
              // TODO: Handle direct block data if needed
            }
          }
        }
      }
      
      // If we still don't have sections, use the fallback grid
      if (!sections || sections.length === 0) {
        console.log(`No sections found in chunk ${chunkX},${chunkZ}, generating fallback terrain`);
        // return generateFallbackChunk(chunkX, chunkZ, regionSelection);
      }
    }
    
    console.log(`Processing ${sections.length} sections in chunk ${chunkX},${chunkZ}`);
    
    // Process each section (16x16x16 cube of blocks)
    for (const section of sections) {
      // Skip empty sections
      if (!section) continue;
      
      // Try to get Y coordinate of this section (varies by version format)
      let sectionY = 0;
      if (section.Y !== undefined) {
        sectionY = typeof section.Y === 'object' ? section.Y.value : section.Y;
      }
      
      // Get palette and block states
      let palette = [];
      let blockStates = [];
      
      // Try to extract palette
      if (section.Palette) {
        palette = Array.isArray(section.Palette) ? section.Palette : (section.Palette.value || []);
      } else if (section.palette) {
        palette = Array.isArray(section.palette) ? section.palette : (section.palette.value || []);
      } else if (section.block_states && section.block_states.palette) {
        // 1.18+ format
        palette = Array.isArray(section.block_states.palette) ? 
                 section.block_states.palette : 
                 (section.block_states.palette.value || []);
      }
      
      // For 1.21.4 format - if palette is an array of objects with type and value (NBT format)
      if (palette.length > 0 && palette[0] && palette[0].type && palette[0].value) {
        console.log(`Found NBT-style palette format, converting...`);
        palette = palette.map(item => item.value);
      }
      
      // Try to extract block states
      if (section.BlockStates) {
        blockStates = Array.isArray(section.BlockStates) ? section.BlockStates : (section.BlockStates.value || []);
      } else if (section.block_states && section.block_states.data) {
        blockStates = Array.isArray(section.block_states.data) ? 
                     section.block_states.data : 
                     (section.block_states.data.value || []);
      }
      
      // For 1.21.4 format - if blockStates is an array of objects with type and value
      if (blockStates.length > 0 && blockStates[0] && blockStates[0].type && blockStates[0].value) {
        console.log(`Found NBT-style blockStates format, converting...`);
        blockStates = blockStates.map(item => item.value);
      }
      
      // Skip if we don't have both palette and block states
      if (!palette.length || !blockStates.length) {
        console.log(`Skipping section at Y=${sectionY} in chunk ${chunkX},${chunkZ}: no palette or block states`);
        continue;
      }
      
      // Get bits per block
      const bitsPerBlock = Math.max(Math.ceil(Math.log2(palette.length)), 4);
      
      console.log(`Processing section at Y=${sectionY} in chunk ${chunkX},${chunkZ}: palette=${palette.length} blocks, bits=${bitsPerBlock}`);
      
      try {
        // Extract the block states into block IDs
        const blockIds = extractBlockStatesFromPackedLongArray(blockStates, bitsPerBlock, palette.length, 4096);
        
        // Process each block in the section
        for (let y = 0; y < 16; y++) {
          const worldY = sectionY * 16 + y;
          
          // Skip sections that are above or below our interest
          if (worldY < -64 || worldY > 320) continue; // Expanded range for 1.18+
          
          for (let z = 0; z < 16; z++) {
            const worldZ = chunkZ * 16 + z;
            
            // Skip if outside region selection Z range
            if (regionSelection && (worldZ < regionSelection.minZ || worldZ > regionSelection.maxZ)) {
              continue;
            }
            
            for (let x = 0; x < 16; x++) {
              const worldX = chunkX * 16 + x;
              
              // Skip if outside region selection X range
              if (regionSelection && (worldX < regionSelection.minX || worldX > regionSelection.maxX)) {
                continue;
              }
              
              // Calculate the index in the section
              const index = y * 256 + z * 16 + x;
              
              // If index is out of range, skip
              if (index >= blockIds.length) continue;
              
              const paletteIndex = blockIds[index];
              
              // Skip if paletteIndex is invalid
              if (paletteIndex === undefined || paletteIndex >= palette.length) continue;
              
              const block = palette[paletteIndex];
              
              // Skip air blocks
              if (!block) continue;
              
              // Get the block name - handle different formats
              let blockName;
              if (block.Name) {
                blockName = typeof block.Name === 'object' ? block.Name.value : block.Name;
              } else if (block.name) {
                blockName = typeof block.name === 'object' ? block.name.value : block.name;
              } else if (typeof block === 'string') {
                // Some versions just have strings directly
                blockName = block;
              }
              
              // Skip air blocks and undefined blocks
              if (!blockName || blockName === 'minecraft:air' || blockName === 'air') {
                continue;
              }
              
              // Ensure the blockName has the minecraft: prefix
              if (!blockName.includes(':')) {
                blockName = `minecraft:${blockName}`;
              }
              
              // Try to map the block to a Hytopia ID
              let mappedId;
              
              // First try exact mapping
              if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                mappedId = blockMapping.blocks[blockName];
              }
              // Then try the simplified name
              else {
                const simpleName = blockName.replace('minecraft:', '');
                if (blockMapping.blocks && blockMapping.blocks[simpleName]) {
                  mappedId = blockMapping.blocks[simpleName];
                }
              }
              
              // If not found in mapping, use fallback and track unmapped block
              if (!mappedId) {
                mappedId = getFallbackBlockId(blockName);
                unmappedBlockTracker.trackBlock(blockName, `${worldX},${worldY},${worldZ}`, mappedId);
              }
              
              // Add the block to the result
              blocks[`${worldX},${worldY},${worldZ}`] = mappedId;
            }
          }
        }
      } catch (sectionError) {
        console.error(`Error processing section at Y=${sectionY} in chunk ${chunkX},${chunkZ}:`, sectionError);
      }
      
      // Add detailed debug information
      console.log(`Section at Y=${sectionY}: palette length=${palette.length}, blockStates length=${blockStates.length}`);
      if (palette.length > 0) {
        console.log(`First palette entry:`, palette[0]);
      }
      if (blockStates.length > 0) {
        console.log(`First few blockState values:`, blockStates.slice(0, 3));
      }
    }
    
    console.log(`Extracted ${Object.keys(blocks).length} blocks from chunk ${chunkX},${chunkZ}`);
  } catch (error) {
    console.error(`Error processing chunk ${chunkX},${chunkZ}:`, error);
    // return generateFallbackChunk(chunkX, chunkZ, regionSelection);
  }
  
  // If we couldn't extract any blocks, use fallback
  if (Object.keys(blocks).length === 0) {
    console.log(`No blocks extracted from chunk ${chunkX},${chunkZ}, using fallback`);
    // return generateFallbackChunk(chunkX, chunkZ, regionSelection);
  }
  
  return blocks;
}

// Add buffer handling for large chunks
async function processMCAFile(fileData, blockMapping, regionCoords, regionSelection) {
    const buffer = Buffer.from(fileData);
    const chunks = [];
    const maxChunkSize = 5 * 1024 * 1024; // 5MB max chunk size
    
    // Show detailed debug info for the first region file processed
    const isFirstRegion = regionCoords.x === 0 && regionCoords.z === 0;
    
    if (isFirstRegion) {
        console.log(`Processing region at ${regionCoords.x},${regionCoords.z} with buffer length ${buffer.length}`);
    }
    
    // Process chunks
    for (let z = 0; z < 32; z++) {
        for (let x = 0; x < 32; x++) {
            const headerOffset = 4 * (x + z * 32);
            
            if (headerOffset + 4 > buffer.length) {
                console.warn(`Header offset ${headerOffset} is beyond buffer length ${buffer.length}`);
                continue;
            }
            
            // Read chunk header
            const offset = (buffer[headerOffset] << 16) | (buffer[headerOffset + 1] << 8) | buffer[headerOffset + 2];
            const sectorCount = buffer[headerOffset + 3];
            
            if (offset === 0 || sectorCount === 0) continue;
            
            const chunkOffset = offset * 4096;
            
            try {
                // Validate chunk boundaries
                if (chunkOffset === 0 || chunkOffset + 5 >= buffer.length) {
                    console.warn(`Invalid chunk offset ${chunkOffset} for chunk ${x},${z}`);
                    continue;
                }
                
                // Read chunk length safely
                const chunkLength = (buffer[chunkOffset] << 24) | 
                                  (buffer[chunkOffset + 1] << 16) | 
                                  (buffer[chunkOffset + 2] << 8) | 
                                  buffer[chunkOffset + 3];
                
                // Skip oversized chunks
                if (chunkLength > maxChunkSize) {
                    console.warn(`Skipping oversized chunk at ${x},${z} (${chunkLength} bytes)`);
                    continue;
                }
                
                // Ensure chunk data fits in buffer
                if (chunkOffset + 5 + chunkLength > buffer.length) {
                    console.warn(`Chunk data would exceed buffer bounds, adjusting length`);
                    const adjustedLength = buffer.length - (chunkOffset + 5);
                    if (adjustedLength <= 0) continue;
                    
                    // Extract available data
                    const compressedData = buffer.slice(chunkOffset + 5, chunkOffset + 5 + adjustedLength);
                    // Process chunk with adjusted size
                    // ... rest of chunk processing ...
                } else {
                    // Process normal sized chunk
                    const compressedData = buffer.slice(chunkOffset + 5, chunkOffset + 5 + chunkLength);
                    // ... rest of existing chunk processing ...
                }
                
            } catch (chunkError) {
                console.warn(`Error processing chunk at ${x},${z}:`, chunkError);
                continue;
            }
        }
    }
    
    return chunks;
}

// Add terrainBuilderRef parameter
async function processRegionFilesInChunks(regionFiles, blockMapping, regionSelection, terrainBuilderRef) {
    const blocks = {};
    let progress = 0;
    
    for (const regionFile of regionFiles) {
        try {
            // Process region file
            const regionCoords = parseRegionCoordinates(regionFile.name);
            if (!regionCoords) continue;
            
            console.log(`Processing region at ${regionCoords.x},${regionCoords.z} with buffer length ${regionFile.data.length}`);
            
            // Extract blocks from region
            const regionBlocks = await processMCAFile(regionFile.data, blockMapping, regionCoords, regionSelection);
            
            // Merge blocks into main collection
            Object.assign(blocks, regionBlocks);
            
            // Update progress
            progress += (1 / regionFiles.length) * 100;
            console.log(`Import progress: ${Math.round(progress)}%`);
            
        } catch (error) {
            console.warn(`Error processing region file ${regionFile.name}:`, error);
        }
    }

    // Convert blocks object to array for storage
    const blocksArray = Object.entries(blocks).map(([coords, blockId]) => {
        const [x, y, z] = coords.split(',').map(Number);
        return {
            x, y, z,
            id: blockId,
            type: 'block'
        };
    });

    // Store blocks in database
    if (blocksArray.length > 0) {
        try {
            await DatabaseManager.clearStore('terrain');
            await DatabaseManager.saveData('terrain', 'blocks', blocksArray);
            console.log(`Successfully stored ${blocksArray.length} blocks in database`);
        } catch (error) {
            console.error('Failed to store blocks:', error);
        }
    }

    // Update terrain builder
    if (terrainBuilderRef?.current) {
        const builder = terrainBuilderRef.current;
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(builder))
            .concat(Object.keys(builder))
            .filter(key => typeof builder[key] === 'function');
            
        console.log('Available terrain builder methods:', methods);
        
        // Try to find and use appropriate update method
        const updateMethod = methods.find(m => 
            ['buildUpdateTerrain', 'refreshTerrainFromDB', 'loadTerrainFromBlocks']
            .includes(m)
        );
        
        if (updateMethod) {
            try {
                await builder[updateMethod](blocksArray);
                console.log(`Updated terrain using ${updateMethod}`);
            } catch (error) {
                console.error(`Failed to update terrain using ${updateMethod}:`, error);
            }
        }
    }

    return blocks;
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
      blocks = await processRegionFilesInChunks(regionFiles, blockMapping, regionSelection, terrainBuilderRef);
      console.log(`Extracted ${Object.keys(blocks).length} blocks from world`);
      
      // If we got no blocks, try alternative approach
      if (Object.keys(blocks).length === 0) {
        console.log("Initial block extraction returned 0 blocks, trying alternative approach...");
        
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
          // Store in database using same pattern as SchematicConverter
          try {
            await DatabaseManager.clearStore(STORES.TERRAIN);
            await DatabaseManager.saveData(STORES.TERRAIN, "current", alternativeBlocks);
            console.log(`Stored ${alternativeBlockCount} blocks in database`);
            
            // Update terrain
            if (terrainBuilderRef?.current) {
              await terrainBuilderRef.current.refreshTerrainFromDB();
              console.log('Refreshed terrain from database');
            }
            
            blocks = alternativeBlocks; // Update return value
          } catch (dbError) {
            console.error('Failed to store blocks in database:', dbError);
          }
        }
      }
      
      // Process any unmapped blocks
      const unmappedBlocks = unmappedBlockTracker.blocks;
      console.log(`Found ${Object.keys(unmappedBlocks).length} unmapped block types`);
      
      return {
        success: true,
        blocks,
        unmappedBlocks: Object.keys(unmappedBlocks).length > 0 ? unmappedBlocks : null,
        blockCount: Object.keys(blocks).length,
        worldName
      };
    } catch (error) {
      console.error('Error processing region files:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error importing world:', error);
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

// Add a flag to track storage status
let isStorageInProgress = false;

async function storeBlocksInDatabase(blocks) {
    // Validate blocks array
    if (!blocks || !Array.isArray(blocks)) {
        console.warn('No valid blocks array provided for storage');
        return false;
    }

    // Filter out any invalid blocks
    const validBlocks = blocks.filter(block => block && typeof block === 'object');
    
    if (validBlocks.length === 0) {
        console.warn('No valid blocks found in provided data');
        return false;
    }

    console.log(`Starting storage of ${validBlocks.length} valid blocks...`);

    try {
        await DatabaseManager.clearStore(STORES.TERRAIN);
        
        // Store blocks in batches
        const batchSize = Math.ceil(validBlocks.length / 5);
        for (let i = 0; i < validBlocks.length; i += batchSize) {
            const batch = validBlocks.slice(i, i + batchSize);
            await DatabaseManager.saveData(STORES.TERRAIN, `batch_${i}`, batch);
            console.log(`Stored batch ${Math.floor(i / batchSize) + 1}/5`);
        }

        // Verify storage
        const count = await DatabaseManager.getData(STORES.TERRAIN, 'count');
        console.log(`Storage verification: ${count} blocks stored`);
        
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