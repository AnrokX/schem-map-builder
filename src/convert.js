const fs = require('fs');
const path = require('path');

// Force immediate console output
const originalConsoleLog = console.log;
console.log = function() {
  originalConsoleLog.apply(console, arguments);
  // Flush stdout
  process.stdout.write('');
};

// Configuration options
const CONFIG = {
  generateDefaultMappings: false, // Set to false to use existing block IDs for unmapped blocks
  nextAvailableId: 100, // Starting ID for generated mappings (not used when generateDefaultMappings is false)
  updateMappingFile: false, // Set to false since we're not generating new mappings
  processAllBlocks: true, // Set to true to process all blocks, not just topBlocks
  defaultBlockType: "minecraft:stone", // Default block type to use for unmapped blocks
  fallbackBlockTypes: {
    // Map categories of blocks to appropriate fallbacks
    "grass": "minecraft:grass_block",
    "dirt": "minecraft:dirt",
    "wood": "minecraft:oak_log",
    "leaves": "minecraft:oak_leaves",
    "flower": "minecraft:dandelion",
    "stone": "minecraft:stone",
    "brick": "minecraft:stone_bricks",
    "glass": "minecraft:glass",
    "water": "minecraft:water",
    "concrete": "minecraft:stone",
    "ore": "minecraft:stone",
    "log": "minecraft:oak_log",
    "planks": "minecraft:oak_planks",
    "stairs": "minecraft:oak_planks",
    "slab": "minecraft:oak_planks",
    "fence": "minecraft:oak_planks",
    "wall": "minecraft:stone",
    "sand": "minecraft:sand",
    "gravel": "minecraft:gravel"
  }
};

originalConsoleLog('SCRIPT IS RUNNING!');
originalConsoleLog('Starting conversion process...');

try {
  // Read the input files
  originalConsoleLog('Reading input files...');
  const visualizationDataPath = path.join(__dirname, '../output/visualization_data.json');
  const mappingPath = path.join(__dirname, '../public/mapping.json');
  
  originalConsoleLog(`Reading visualization data from: ${visualizationDataPath}`);
  const visualizationData = JSON.parse(fs.readFileSync(visualizationDataPath, 'utf8'));
  
  originalConsoleLog(`Reading mapping from: ${mappingPath}`);
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

  originalConsoleLog('Files loaded successfully.');
  originalConsoleLog(`Found ${visualizationData.blockTypeStats.length} block types in visualization data.`);
  originalConsoleLog(`Found ${visualizationData.topBlocks ? visualizationData.topBlocks.length : 0} top blocks with positions.`);
  
  // Check if there are other sections with block positions
  const hasAllBlocks = visualizationData.allBlocks && Array.isArray(visualizationData.allBlocks);
  const hasBlocksByType = visualizationData.blocksByType && typeof visualizationData.blocksByType === 'object';
  
  if (hasAllBlocks) {
    originalConsoleLog(`Found ${visualizationData.allBlocks.length} blocks in allBlocks section.`);
  }
  
  if (hasBlocksByType) {
    originalConsoleLog(`Found ${Object.keys(visualizationData.blocksByType).length} block types in blocksByType section.`);
  }
  
  originalConsoleLog(`Found ${Object.keys(mapping.blocks).length} block mappings.`);

  // Create the output structure
  const outputData = {
    blockTypes: [],
    blocks: {}
  };

  // Process block types from the mapping
  const processedBlockTypes = new Set();
  const blockTypeMap = new Map();

  // Extract unique block types from the mapping
  originalConsoleLog('Processing block types from mapping...');
  Object.entries(mapping.blocks).forEach(([minecraftName, blockInfo]) => {
    if (!processedBlockTypes.has(blockInfo.id)) {
      outputData.blockTypes.push({
        id: blockInfo.id,
        name: blockInfo.hytopiaBlock,
        textureUri: blockInfo.textureUri,
        isCustom: false
      });
      
      processedBlockTypes.add(blockInfo.id);
      blockTypeMap.set(minecraftName, blockInfo.id);
    }
  });

  originalConsoleLog(`Processed ${outputData.blockTypes.length} unique block types from mapping.`);

  // Function to find the best fallback block for an unmapped block
  function findFallbackBlock(blockName) {
    // Remove minecraft: prefix
    const simpleName = blockName.replace('minecraft:', '');
    
    // Check if the block name contains any of the fallback categories
    for (const [category, fallbackBlock] of Object.entries(CONFIG.fallbackBlockTypes)) {
      if (simpleName.includes(category)) {
        return fallbackBlock;
      }
    }
    
    // If no match found, use the default block type
    return CONFIG.defaultBlockType;
  }

  // Create a map of unmapped blocks to their fallback blocks
  const unmappedBlocksMap = new Map();
  
  // Collect all block types that need mappings
  const unmappedBlocks = new Set();
  
  // Add block types from blockTypeStats
  visualizationData.blockTypeStats.forEach(blockType => {
    if (!blockTypeMap.has(blockType.name) && !mapping.blocks[blockType.name]) {
      unmappedBlocks.add(blockType.name);
    }
  });
  
  // Add block types from topBlocks if available
  if (visualizationData.topBlocks) {
    visualizationData.topBlocks.forEach(blockType => {
      if (!blockTypeMap.has(blockType.name) && !mapping.blocks[blockType.name]) {
        unmappedBlocks.add(blockType.name);
      }
    });
  }
  
  // Add block types from blocksByType if available
  if (hasBlocksByType) {
    Object.keys(visualizationData.blocksByType).forEach(blockName => {
      if (!blockTypeMap.has(blockName) && !mapping.blocks[blockName]) {
        unmappedBlocks.add(blockName);
      }
    });
  }
  
  originalConsoleLog(`Found ${unmappedBlocks.size} unmapped block types.`);
  
  // Assign fallback blocks to unmapped blocks
  unmappedBlocks.forEach(blockName => {
    const fallbackBlock = findFallbackBlock(blockName);
    unmappedBlocksMap.set(blockName, fallbackBlock);
    originalConsoleLog(`Assigned fallback block ${fallbackBlock} to unmapped block ${blockName}`);
  });

  // Process blocks from visualization data
  let blocksProcessed = 0;
  let blocksSkipped = 0;
  let totalPositionsAdded = 0;
  let blockTypesWithMapping = 0;
  let blockTypesWithoutMapping = 0;
  let unmappedBlocksUsed = 0;

  // Process blocks from topBlocks section if available
  if (visualizationData.topBlocks && visualizationData.topBlocks.length > 0) {
    originalConsoleLog('Processing blocks from topBlocks section...');
    
    for (const blockType of visualizationData.topBlocks) {
      const minecraftName = blockType.name;
      
      // Get the block ID from the mapping or use a fallback
      let blockId;
      let usedFallback = false;
      
      if (blockTypeMap.has(minecraftName)) {
        blockId = blockTypeMap.get(minecraftName);
      } else if (mapping.blocks[minecraftName]) {
        blockId = mapping.blocks[minecraftName].id;
        
        // Add to block types if not already added
        if (!processedBlockTypes.has(blockId)) {
          outputData.blockTypes.push({
            id: blockId,
            name: mapping.blocks[minecraftName].hytopiaBlock,
            textureUri: mapping.blocks[minecraftName].textureUri,
            isCustom: false
          });
          
          processedBlockTypes.add(blockId);
          blockTypeMap.set(minecraftName, blockId);
        }
      } else if (unmappedBlocksMap.has(minecraftName)) {
        // Use the fallback block
        const fallbackBlock = unmappedBlocksMap.get(minecraftName);
        blockId = blockTypeMap.get(fallbackBlock);
        usedFallback = true;
        unmappedBlocksUsed++;
      } else {
        // Use the default block type as a last resort
        blockId = blockTypeMap.get(CONFIG.defaultBlockType);
        usedFallback = true;
        unmappedBlocksUsed++;
      }
      
      if (usedFallback) {
        blockTypesWithoutMapping++;
      } else {
        blockTypesWithMapping++;
      }
      
      // Check if this block type has positions
      if (!blockType.positions || blockType.positions.length === 0) {
        originalConsoleLog(`No positions found for block type: ${minecraftName}`);
        continue;
      }
      
      let positionsAdded = 0;
      
      // Add positions to the output
      for (const pos of blockType.positions) {
        // Format: "x,y,z": blockId
        const key = `${pos.x},${pos.y},${pos.z}`;
        outputData.blocks[key] = blockId;
        positionsAdded++;
      }
      
      if (usedFallback) {
        originalConsoleLog(`Added ${positionsAdded} positions for unmapped block type: ${minecraftName} using fallback block ID: ${blockId}`);
      } else {
        originalConsoleLog(`Added ${positionsAdded} positions for block type: ${minecraftName} (ID: ${blockId})`);
      }
      
      totalPositionsAdded += positionsAdded;
      blocksProcessed++;
    }
  }

  // Process blocks from blocksByType section if available and enabled
  if (CONFIG.processAllBlocks && hasBlocksByType) {
    originalConsoleLog('Processing blocks from blocksByType section...');
    
    for (const [minecraftName, blockData] of Object.entries(visualizationData.blocksByType)) {
      // Get the block ID from the mapping or use a fallback
      let blockId;
      let usedFallback = false;
      
      if (blockTypeMap.has(minecraftName)) {
        blockId = blockTypeMap.get(minecraftName);
      } else if (mapping.blocks[minecraftName]) {
        blockId = mapping.blocks[minecraftName].id;
        
        // Add to block types if not already added
        if (!processedBlockTypes.has(blockId)) {
          outputData.blockTypes.push({
            id: blockId,
            name: mapping.blocks[minecraftName].hytopiaBlock,
            textureUri: mapping.blocks[minecraftName].textureUri,
            isCustom: false
          });
          
          processedBlockTypes.add(blockId);
          blockTypeMap.set(minecraftName, blockId);
        }
      } else if (unmappedBlocksMap.has(minecraftName)) {
        // Use the fallback block
        const fallbackBlock = unmappedBlocksMap.get(minecraftName);
        blockId = blockTypeMap.get(fallbackBlock);
        usedFallback = true;
        unmappedBlocksUsed++;
      } else {
        // Use the default block type as a last resort
        blockId = blockTypeMap.get(CONFIG.defaultBlockType);
        usedFallback = true;
        unmappedBlocksUsed++;
      }
      
      if (usedFallback) {
        blockTypesWithoutMapping++;
      } else {
        blockTypesWithMapping++;
      }
      
      // Check if this block type has positions
      if (!blockData.positions || blockData.positions.length === 0) {
        originalConsoleLog(`No positions found for block type: ${minecraftName}`);
        continue;
      }
      
      let positionsAdded = 0;
      
      // Add positions to the output
      for (const pos of blockData.positions) {
        // Format: "x,y,z": blockId
        const key = `${pos.x},${pos.y},${pos.z}`;
        outputData.blocks[key] = blockId;
        positionsAdded++;
      }
      
      if (usedFallback) {
        originalConsoleLog(`Added ${positionsAdded} positions for unmapped block type: ${minecraftName} using fallback block ID: ${blockId}`);
      } else {
        originalConsoleLog(`Added ${positionsAdded} positions for block type: ${minecraftName} (ID: ${blockId})`);
      }
      
      totalPositionsAdded += positionsAdded;
      blocksProcessed++;
    }
  }

  // Process blocks from allBlocks section if available and enabled
  if (CONFIG.processAllBlocks && hasAllBlocks) {
    originalConsoleLog('Processing blocks from allBlocks section...');
    
    let allBlocksProcessed = 0;
    let allBlocksSkipped = 0;
    
    for (const block of visualizationData.allBlocks) {
      const minecraftName = block.name;
      
      // Get the block ID from the mapping or use a fallback
      let blockId;
      let usedFallback = false;
      
      if (blockTypeMap.has(minecraftName)) {
        blockId = blockTypeMap.get(minecraftName);
      } else if (mapping.blocks[minecraftName]) {
        blockId = mapping.blocks[minecraftName].id;
        
        // Add to block types if not already added
        if (!processedBlockTypes.has(blockId)) {
          outputData.blockTypes.push({
            id: blockId,
            name: mapping.blocks[minecraftName].hytopiaBlock,
            textureUri: mapping.blocks[minecraftName].textureUri,
            isCustom: false
          });
          
          processedBlockTypes.add(blockId);
          blockTypeMap.set(minecraftName, blockId);
        }
      } else if (unmappedBlocksMap.has(minecraftName)) {
        // Use the fallback block
        const fallbackBlock = unmappedBlocksMap.get(minecraftName);
        blockId = blockTypeMap.get(fallbackBlock);
        usedFallback = true;
        unmappedBlocksUsed++;
      } else {
        // Use the default block type as a last resort
        blockId = blockTypeMap.get(CONFIG.defaultBlockType);
        usedFallback = true;
        unmappedBlocksUsed++;
      }
      
      // Format: "x,y,z": blockId
      const key = `${block.x},${block.y},${block.z}`;
      outputData.blocks[key] = blockId;
      
      if (usedFallback) {
        allBlocksSkipped++;
      } else {
        allBlocksProcessed++;
      }
    }
    
    originalConsoleLog(`Processed ${allBlocksProcessed} blocks from allBlocks section.`);
    originalConsoleLog(`Used fallback for ${allBlocksSkipped} blocks from allBlocks section.`);
    totalPositionsAdded += allBlocksProcessed + allBlocksSkipped;
  }

  // Process blocks from blockTypeStats section if they have positions
  originalConsoleLog('Processing blocks from blockTypeStats section...');
  
  for (const blockType of visualizationData.blockTypeStats) {
    const minecraftName = blockType.name;
    
    // Skip blocks that don't have positions
    if (!blockType.positions || blockType.positions.length === 0) {
      continue;
    }
    
    // Get the block ID from the mapping or use a fallback
    let blockId;
    let usedFallback = false;
    
    if (blockTypeMap.has(minecraftName)) {
      blockId = blockTypeMap.get(minecraftName);
    } else if (mapping.blocks[minecraftName]) {
      blockId = mapping.blocks[minecraftName].id;
      
      // Add to block types if not already added
      if (!processedBlockTypes.has(blockId)) {
        outputData.blockTypes.push({
          id: blockId,
          name: mapping.blocks[minecraftName].hytopiaBlock,
          textureUri: mapping.blocks[minecraftName].textureUri,
          isCustom: false
        });
        
        processedBlockTypes.add(blockId);
        blockTypeMap.set(minecraftName, blockId);
      }
    } else if (unmappedBlocksMap.has(minecraftName)) {
      // Use the fallback block
      const fallbackBlock = unmappedBlocksMap.get(minecraftName);
      blockId = blockTypeMap.get(fallbackBlock);
      usedFallback = true;
      unmappedBlocksUsed++;
    } else {
      // Use the default block type as a last resort
      blockId = blockTypeMap.get(CONFIG.defaultBlockType);
      usedFallback = true;
      unmappedBlocksUsed++;
    }
    
    let positionsAdded = 0;
    
    // Add positions to the output
    for (const pos of blockType.positions) {
      // Format: "x,y,z": blockId
      const key = `${pos.x},${pos.y},${pos.z}`;
      outputData.blocks[key] = blockId;
      positionsAdded++;
    }
    
    if (usedFallback) {
      originalConsoleLog(`Added ${positionsAdded} positions for unmapped block type: ${minecraftName} using fallback block ID: ${blockId} from blockTypeStats`);
    } else {
      originalConsoleLog(`Added ${positionsAdded} positions for block type: ${minecraftName} (ID: ${blockId}) from blockTypeStats`);
    }
    
    totalPositionsAdded += positionsAdded;
  }

  originalConsoleLog(`Block types with direct mapping: ${blockTypesWithMapping}`);
  originalConsoleLog(`Block types using fallback mapping: ${blockTypesWithoutMapping}`);
  originalConsoleLog(`Unmapped blocks converted using fallbacks: ${unmappedBlocksUsed}`);
  originalConsoleLog(`Total positions added: ${totalPositionsAdded}`);
  originalConsoleLog(`Total blocks in output: ${Object.keys(outputData.blocks).length}`);

  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write the output file
  const outputPath = path.join(outputDir, 'converted_world.json');
  originalConsoleLog(`Writing output to: ${outputPath}`);
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

  originalConsoleLog('Conversion complete! Output saved to output/converted_world.json');
} catch (error) {
  console.error('Error during conversion:', error);
} 