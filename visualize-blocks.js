/**
 * Minecraft World to Hytopia Converter
 * 
 * This script processes the extracted block data from Minecraft worlds
 * and converts it directly to Hytopia builder format.
 * 
 * Usage: node visualize-blocks.js
 */

const fs = require('fs');
const path = require('path');

// Path to the visualization data JSON file
const visualizationDataPath = path.join(__dirname, 'output', 'visualization_data.json');
// Path to the mapping file
const mappingPath = path.join(__dirname, 'public', 'mapping.json');
// Path for the output file
const outputPath = path.join(__dirname, 'output', 'converted_world.json');

// Configuration options
const CONFIG = {
  generateDefaultMappings: false, // Set to false to use existing block IDs for unmapped blocks
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

// Load visualization data
function loadVisualizationData() {
    try {
        if (!fs.existsSync(visualizationDataPath)) {
            console.error(`Error: Visualization data not found at ${visualizationDataPath}`);
            console.log('Please run the parser first to generate visualization data.');
            process.exit(1);
        }
        
        const rawData = fs.readFileSync(visualizationDataPath, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error loading visualization data:', error);
        process.exit(1);
    }
}

// Load block mappings
function loadBlockMappings() {
    try {
        if (!fs.existsSync(mappingPath)) {
            console.error(`Error: Mapping file not found at ${mappingPath}`);
            console.log('Please ensure the mapping file exists.');
            return { blocks: {} };  // Return empty mapping if file doesn't exist
        }
        
        const rawData = fs.readFileSync(mappingPath, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error loading block mappings:', error);
        return { blocks: {} };  // Return empty mapping on error
    }
}

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

// Main function to convert visualization data to Hytopia format
function convertToHytopiaFormat() {
    console.log('Loading Minecraft world visualization data...');
    const visualizationData = loadVisualizationData();
    
    console.log('Loading block mappings...');
    const mapping = loadBlockMappings();
    
    console.log('\n=== Minecraft World Conversion ===');
    console.log(`Total Blocks: ${visualizationData.metadata.totalBlocks}`);
    console.log(`Unique Block Types: ${visualizationData.metadata.uniqueBlockTypes}`);
    console.log(`Height Range: Y=${visualizationData.metadata.heightRange.min} to Y=${visualizationData.metadata.heightRange.max}`);
    
    // Create the output structure for Hytopia format
    const outputData = {
        blockTypes: [],
        blocks: {}
    };
    
    // Process block types from the mapping
    const processedBlockTypes = new Set();
    const blockTypeMap = new Map();
    
    // Extract unique block types from the mapping
    console.log('Processing block types from mapping...');
    Object.entries(mapping.blocks).forEach(([minecraftName, blockInfo]) => {
        if (!processedBlockTypes.has(blockInfo.id)) {
            outputData.blockTypes.push({
                id: blockInfo.id,
                name: blockInfo.hytopiaBlock,
                textureUri: blockInfo.textureUri || `blocks/${blockInfo.hytopiaBlock}.png`,
                isCustom: false
            });
            
            processedBlockTypes.add(blockInfo.id);
            blockTypeMap.set(minecraftName, blockInfo.id);
        }
    });
    
    console.log(`Processed ${outputData.blockTypes.length} unique block types from mapping.`);
    
    // Create a map of unmapped blocks to their fallback blocks
    const unmappedBlocksMap = new Map();
    
    // Collect all block types that need mappings
    const unmappedBlocks = new Set();
    
    // Detect unmapped blocks from all sources
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
    
    // If we have blocksByType section, add those as well
    if (visualizationData.blocksByType && typeof visualizationData.blocksByType === 'object') {
        Object.keys(visualizationData.blocksByType).forEach(blockName => {
            if (!blockTypeMap.has(blockName) && !mapping.blocks[blockName]) {
                unmappedBlocks.add(blockName);
            }
        });
    }
    
    console.log(`Found ${unmappedBlocks.size} unmapped block types.`);
    
    // Assign fallback blocks to unmapped blocks
    unmappedBlocks.forEach(blockName => {
        const fallbackBlock = findFallbackBlock(blockName);
        unmappedBlocksMap.set(blockName, fallbackBlock);
        console.log(`Assigned fallback block ${fallbackBlock} to unmapped block ${blockName}`);
    });
    
    // Process blocks and their positions
    let totalPositionsAdded = 0;
    
    // Process blocks from topBlocks section
    if (visualizationData.topBlocks && visualizationData.topBlocks.length > 0) {
        console.log('Processing blocks from topBlocks section...');
        
        for (const blockType of visualizationData.topBlocks) {
            const minecraftName = blockType.name;
            
            // Skip air blocks
            if (minecraftName === 'minecraft:air') continue;
            
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
                        textureUri: mapping.blocks[minecraftName].textureUri || `blocks/${mapping.blocks[minecraftName].hytopiaBlock}.png`,
                        isCustom: false
                    });
                    
                    processedBlockTypes.add(blockId);
                    blockTypeMap.set(minecraftName, blockId);
                }
            } else if (unmappedBlocksMap.has(minecraftName)) {
                // Use the fallback block
                const fallbackBlock = unmappedBlocksMap.get(minecraftName);
                
                // Get the ID for the fallback block
                if (blockTypeMap.has(fallbackBlock)) {
                    blockId = blockTypeMap.get(fallbackBlock);
                } else if (mapping.blocks[fallbackBlock]) {
                    blockId = mapping.blocks[fallbackBlock].id;
                } else {
                    // Use stone as the ultimate fallback
                    blockId = mapping.blocks["minecraft:stone"].id || 37;
                }
                
                usedFallback = true;
            } else {
                // Use the default block type as a last resort
                blockId = blockTypeMap.get(CONFIG.defaultBlockType) || 37; // 37 is stone
                usedFallback = true;
            }
            
            // Add positions to the output
            if (blockType.positions && blockType.positions.length > 0) {
                let positionsAdded = 0;
                
                for (const pos of blockType.positions) {
                    // Format: "x,y,z": blockId
                    const key = `${pos.x},${pos.y},${pos.z}`;
                    outputData.blocks[key] = blockId;
                    positionsAdded++;
                }
                
                console.log(`Added ${positionsAdded} positions for block ${minecraftName} ${usedFallback ? "(using fallback)" : ""}`);
                totalPositionsAdded += positionsAdded;
            }
        }
    }
    
    // Additionally, if we have blocksByType in visualization data and CONFIG.processAllBlocks is true
    if (CONFIG.processAllBlocks && visualizationData.blocksByType) {
        console.log('Processing all blocks from blocksByType section...');
        
        for (const [minecraftName, positions] of Object.entries(visualizationData.blocksByType)) {
            // Skip air blocks and blocks we've already processed
            if (minecraftName === 'minecraft:air') continue;
            
            // Skip block types already processed in topBlocks to avoid duplication
            if (visualizationData.topBlocks && visualizationData.topBlocks.some(b => b.name === minecraftName)) {
                console.log(`Skipping ${minecraftName} as it was already processed in topBlocks`);
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
                        textureUri: mapping.blocks[minecraftName].textureUri || `blocks/${mapping.blocks[minecraftName].hytopiaBlock}.png`,
                        isCustom: false
                    });
                    
                    processedBlockTypes.add(blockId);
                    blockTypeMap.set(minecraftName, blockId);
                }
            } else if (unmappedBlocksMap.has(minecraftName)) {
                // Use the fallback block
                const fallbackBlock = unmappedBlocksMap.get(minecraftName);
                
                // Get the ID for the fallback block
                if (blockTypeMap.has(fallbackBlock)) {
                    blockId = blockTypeMap.get(fallbackBlock);
                } else if (mapping.blocks[fallbackBlock]) {
                    blockId = mapping.blocks[fallbackBlock].id;
                } else {
                    // Use stone as the ultimate fallback
                    blockId = mapping.blocks["minecraft:stone"].id || 37;
                }
                
                usedFallback = true;
            } else {
                // Use the default block type as a last resort
                blockId = blockTypeMap.get(CONFIG.defaultBlockType) || 37; // 37 is stone
                usedFallback = true;
            }
            
            // Add positions to the output
            if (Array.isArray(positions) && positions.length > 0) {
                let positionsAdded = 0;
                
                for (const pos of positions) {
                    // Format: "x,y,z": blockId
                    const key = `${pos.x},${pos.y},${pos.z}`;
                    
                    // Only add if not already added (to prevent overwriting)
                    if (!outputData.blocks[key]) {
                        outputData.blocks[key] = blockId;
                        positionsAdded++;
                    }
                }
                
                console.log(`Added ${positionsAdded} positions for block ${minecraftName} ${usedFallback ? "(using fallback)" : ""}`);
                totalPositionsAdded += positionsAdded;
            }
        }
    }
    
    console.log(`\nTotal positions added: ${totalPositionsAdded}`);
    console.log(`Total block types in output: ${outputData.blockTypes.length}`);
    
    // Write the output to a file
    try {
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`Conversion complete. Output written to ${outputPath}`);
    } catch (error) {
        console.error('Error writing output file:', error);
    }
}

// Run the conversion
convertToHytopiaFormat(); 