const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const path = require('path');

// Load block mapping file
const loadBlockMapping = (mappingPath = 'mapping.json') => {
    try {
        const mappingData = fs.readFileSync(mappingPath, 'utf8');
        return JSON.parse(mappingData);
    } catch (error) {
        console.error(`Error loading block mapping file: ${error.message}`);
        console.log('Using default empty mapping');
        return { blocks: {} };
    }
};

// Fallback mechanism for blocks without mappings
const hytopiaBaseBlockIds = {
    'bricks': 1,
    'clay': 2,
    'diamond-ore': 3,
    'dirt': 4,
    'dragons-stone': 5,
    'glass': 6,
    'grass': 7,
    'gravel': 8,
    'ice': 9,
    'infected-shadowrock': 10,
    'log-side': 11,
    'log-top': 12,
    'mossy-coblestone': 13,
    'nuit': 14,
    'oak-leaves': 15,
    'oak-planks': 16,
    'sand': 17,
    'shadowrock': 18,
    'stone': 19,
    'stone-bricks': 20,
    'void-sand': 21,
    'water-still': 22
};

// Track generated IDs and highest ID for dynamic assignment
let nextDynamicBlockId = 1000; // Start at 1000 to avoid conflicts with mapping.json IDs
let dynamicBlockMappings = new Map();
let dynamicBlockTypes = [];

// Define default fallback blocks for common categories
const fallbackMapping = {
    "stone": { id: 37, name: "stone", textureUri: "blocks/stone.png" },
    "cobblestone": { id: 24, name: "mossy-coblestone", textureUri: "blocks/mossy-coblestone.png" },
    "brick": { id: 1, name: "bricks", textureUri: "blocks/bricks.png" },
    "wood": { id: 23, name: "log", textureUri: "blocks/log.png" },
    "log": { id: 23, name: "log", textureUri: "blocks/log.png" },
    "planks": { id: 28, name: "oak-planks", textureUri: "blocks/oak-planks.png" },
    "dirt": { id: 8, name: "dirt", textureUri: "blocks/dirt.png" },
    "grass": { id: 16, name: "grass", textureUri: "blocks/grass.png" },
    "sand": { id: 30, name: "sand", textureUri: "blocks/sand.png" },
    "leaves": { id: 27, name: "oak-leaves", textureUri: "blocks/oak-leaves.png" },
    "glass": { id: 14, name: "glass", textureUri: "blocks/glass.png" },
    "ice": { id: 18, name: "ice", textureUri: "blocks/ice.png" },
    "water": { id: 43, name: "water-still", textureUri: "blocks/water-still.png" },
    "ore": { id: 7, name: "diamond-ore", textureUri: "blocks/diamond-ore.png" },
    "clay": { id: 2, name: "clay", textureUri: "blocks/clay.png" },
    "gravel": { id: 17, name: "gravel", textureUri: "blocks/gravel.png" },
    "unknown": { id: 37, name: "stone", textureUri: "blocks/stone.png" } // Default fallback
};

function getDynamicBlockId(blockName) {
    // Check if we've already assigned a dynamic ID for this block
    if (dynamicBlockMappings.has(blockName)) {
        return dynamicBlockMappings.get(blockName);
    }
    
    // Log the unknown block name for debugging
    console.log(`Using dynamically generated ID 1 for block ${blockName}`);

    // Store the dynamic ID for this block
    dynamicBlockMappings.set(blockName, 1);
    
    return 1; // Return brick (ID 1) for all unknown blocks
}

async function convertSchemToHytopia(schemPath, outputPath, mappingPath = 'mapping.json') {
    try {
        console.log('Reading schematic file...');
        const rawData = fs.readFileSync(schemPath);
        
        // Load block mapping
        console.log('Loading block mapping from', mappingPath);
        const blockMapping = loadBlockMapping(mappingPath);
        console.log(`Loaded mapping with ${Object.keys(blockMapping.blocks).length} block definitions`);
        
        const isGzipped = rawData[0] === 0x1f && rawData[1] === 0x8b;
        console.log('File appears to be', isGzipped ? 'gzipped' : 'not gzipped');
        
        const fileData = isGzipped ? zlib.gunzipSync(rawData) : rawData;
        
        console.log('Parsing NBT...');
        
        nbt.parse(fileData, (error, data) => {
            if (error) {
                console.error('NBT Parse Error:', error);
                return;
            }
            
            try {
                // Debug the NBT structure first
                console.log('DEBUG: Root NBT keys:', Object.keys(data.value));
                
                // Initialize Hytopia map
                let hytopiaMap = {
                    blockTypes: [],
                    blocks: {}
                };
                
                // Check both possible structures without breaking the working one
                const schematic = data.value.Schematic?.value || data.value;
                
                // Debug the structure we're working with
                console.log('DEBUG: Available structure keys:', Object.keys(schematic));

                let format = 'unknown';
                // Keep existing format detection but modify the modern_worldedit check
                if (schematic.Palette && schematic.BlockData) {
                    format = 'modern_worldedit'; // Westerkerk
                } else if (schematic.Blocks?.value?.Palette) {
                    format = 'modern_worldedit_nested'; // Plague Doctor
                } else if (schematic.BlockData || schematic.blocks) {
                    format = 'modern_alternate';
                } else if (schematic.Blocks && schematic.Data) {
                    format = 'classic_worldedit';
                } else if (schematic.Regions) {
                    format = 'litematica';// 23452.litematic
                }

                console.log(`Detected format: ${format}`);

                let width, height, length, palette, blockData;
                const missingMappings = {}; // Initialize missingMappings for all formats

                // Create block type mapping using the mapping file
                console.log('\n=== Creating Block Type Mapping ===');
                const blockTypeMap = new Map();
                
                // Populate block types array from the mapping file
                const usedHytopiaBlocks = new Set();
                Object.entries(blockMapping.blocks).forEach(([minecraftName, blockInfo]) => {
                    const hytopiaId = blockInfo.id;
                    const hytopiaName = blockInfo.hytopiaBlock;
                    
                    // Only add unique block types to the array
                    if (!usedHytopiaBlocks.has(hytopiaId)) {
                        hytopiaMap.blockTypes.push({
                            id: hytopiaId,
                            name: hytopiaName,
                            textureUri: blockInfo.textureUri
                        });
                        usedHytopiaBlocks.add(hytopiaId);
                    }
                    
                    // Map both with and without block states for more reliable matching
                    blockTypeMap.set(minecraftName, hytopiaId);
                    // Also store the base name without block states
                    const baseName = minecraftName.split('[')[0];
                    if (baseName !== minecraftName) {
                        blockTypeMap.set(baseName, hytopiaId);
                    }
                });

                console.log(`Created mapping for ${blockTypeMap.size} Minecraft blocks to ${usedHytopiaBlocks.size} Hytopia blocks`);
                
                // Add any dynamically generated block types
                if (dynamicBlockTypes.length > 0) {
                    console.log(`Adding ${dynamicBlockTypes.length} dynamically generated block types`);
                    hytopiaMap.blockTypes = [...hytopiaMap.blockTypes, ...dynamicBlockTypes];
                }

                // Handle different formats now that we have our block mapping
                
                switch (format) {
                    case 'modern_worldedit':
                        // Direct access for westerkerk-style format
                        width = schematic.Width?.value || 0;
                        height = schematic.Height?.value || 0;
                        length = schematic.Length?.value || 0;
                        palette = schematic.Palette?.value;
                        blockData = schematic.BlockData?.value;
                        break;

                    case 'modern_worldedit_nested':
                        // Keep existing working code for plague doctor
                        width = schematic.Width?.value || 0;
                        height = schematic.Height?.value || 0;
                        length = schematic.Length?.value || 0;
                        palette = schematic.Blocks?.value?.Palette?.value;
                        blockData = schematic.Blocks?.value?.Data?.value;
                        break;

                    case 'modern_alternate':
                        // Add support for alternate modern format
                        width = schematic.Width || schematic.width || 0;
                        height = schematic.Height || schematic.height || 0;
                        length = schematic.Length || schematic.length || 0;
                        palette = schematic.Palette?.value || schematic.palette;
                        blockData = schematic.BlockData?.value || schematic.blocks;
                        break;

                    case 'classic_worldedit':
                        width = schematic.Width?.value || 0;
                        height = schematic.Height?.value || 0;
                        length = schematic.Length?.value || 0;
                        // Classic format uses block IDs directly
                        palette = createClassicPalette(schematic.Blocks.value, schematic.Data.value, blockMapping);
                        blockData = schematic.Blocks.value;
                        break;

                    case 'litematica':
                        console.log('\n=== LITEMATICA FORMAT DEBUG INFO ===');
                        
                        // Debug Regions structure
                        console.log('\nRegions Overview:');
                        console.log('Available regions:', Object.keys(schematic.Regions.value));
                        
                        // Get the first region
                        const regionName = Object.keys(schematic.Regions.value)[0];
                        const region = schematic.Regions.value[regionName].value;
                        
                        console.log('\nRegion Details:');
                        console.log('Region name:', regionName);
                        console.log('Region keys:', Object.keys(region));
                        
                        // Size information
                        console.log('\nSize Information:');
                        console.log('Raw Size object:', JSON.stringify(region.Size.value, null, 2));
                        console.log('Dimensions:', {
                            x: region.Size.value.x.value,
                            y: region.Size.value.y.value,
                            z: region.Size.value.z.value
                        });
                        
                        // Position information if available
                        if (region.Position) {
                            console.log('\nPosition Information:');
                            console.log('Position:', JSON.stringify(region.Position.value, null, 2));
                        }
                        
                        // Palette information
                        console.log('\nPalette Information:');
                        console.log('Palette length:', region.BlockStatePalette.value.value.length);
                        console.log('First 5 palette entries:');
                        region.BlockStatePalette.value.value.slice(0, 5).forEach((entry, index) => {
                            console.log(`[${index}]:`, JSON.stringify(entry, null, 2));
                        });
                        
                        // BlockStates information
                        console.log('\nBlockStates Information:');
                        console.log('BlockStates type:', typeof region.BlockStates.value);
                        console.log('BlockStates length:', region.BlockStates.value.length);
                        console.log('First 10 block state values:', region.BlockStates.value.slice(0, 10));
                        
                        // Additional metadata if available
                        if (region.Metadata) {
                            console.log('\nMetadata Information:');
                            console.log('Metadata:', JSON.stringify(region.Metadata.value, null, 2));
                        }
                        
                        // Continue with existing code...
                        width = Math.abs(region.Size.value.x.value);
                        height = Math.abs(region.Size.value.y.value);
                        length = Math.abs(region.Size.value.z.value);
                        
                        // Get palette and block data from region
                        palette = region.BlockStatePalette.value.value;
                        blockData = region.BlockStates.value;

                        console.log('Litematica dimensions:', { width, height, length });
                        console.log('Palette size:', palette.length);
                        
                        // Process blocks for litematica format
                        let blockCount = 0;
                        const bitsPerBlock = Math.ceil(Math.log2(palette.length)); // Calculate bits needed per block
                        const blocksPerLong = Math.floor(64 / bitsPerBlock);
                        const maskBits = (1n << BigInt(bitsPerBlock)) - 1n;

                        console.log(`Bits per block: ${bitsPerBlock}`);
                        console.log(`Blocks per long: ${blocksPerLong}`);
                        console.log(`Mask bits: ${maskBits}`);

                        for (let y = 0; y < height; y++) {
                            for (let z = 0; z < length; z++) {
                                for (let x = 0; x < width; x++) {
                                    const index = y * (width * length) + z * width + x;
                                    const longIndex = Math.floor(index / blocksPerLong);
                                    const bitOffset = (index % blocksPerLong) * bitsPerBlock;
                                    
                                    if (longIndex >= blockData.length) continue;

                                    // Extract the block ID from the packed long
                                    const packedValue = blockData[longIndex];
                                    const blockId = Number((packedValue >> BigInt(bitOffset)) & maskBits);
                                    
                                    if (blockId >= palette.length) continue;
                                    
                                    // Get block info from palette
                                    const blockInfo = palette[blockId];
                                    if (!blockInfo) continue;
                                    
                                    const blockName = blockInfo.Name.value;
                                    if (!blockName || blockName === 'minecraft:air') continue;

                                    // Use our mapping to get the Hytopia ID
                                    const hytopiaBlockId = blockTypeMap.get(blockName);
                                    if (!hytopiaBlockId) {
                                        // Try again with base name (without block states)
                                        const baseName = blockName.split('[')[0];
                                        const baseHytopiaId = blockTypeMap.get(baseName);
                                        if (!baseHytopiaId) {
                                            // Instead of skipping, track missing mappings and use fallback
                                            if (!missingMappings[baseName]) {
                                                missingMappings[baseName] = 1;
                                            } else {
                                                missingMappings[baseName]++;
                                            }
                                            
                                            // Use dynamic ID generation like other formats
                                            const fallbackId = getDynamicBlockId(baseName);
                                            console.log(`Using dynamically generated ID ${fallbackId} for block ${baseName}`);
                                            
                                            const key = `${x},${y},${z}`;
                                            hytopiaMap.blocks[key] = fallbackId;
                                            blockCount++;
                                            continue;
                                        }
                                        
                                        const key = `${x},${y},${z}`;
                                        hytopiaMap.blocks[key] = baseHytopiaId;
                                        blockCount++;
                                    } else {
                                        const key = `${x},${y},${z}`;
                                        hytopiaMap.blocks[key] = hytopiaBlockId;
                                        blockCount++;
                                    }
                                }
                            }
                        }
                        
                        console.log(`Processed ${blockCount} blocks for litematica format`);
                        break;

                    default:
                        throw new Error(`Unsupported schematic format: ${format}`);
                }

                // Add debug information
                console.log('DEBUG: Extracted dimensions:', { width, height, length });
                console.log('DEBUG: Palette present:', !!palette);
                console.log('DEBUG: BlockData present:', !!blockData);
                console.log('DEBUG: PaletteMax:', schematic.PaletteMax);

                console.log(`Dimensions: ${width}x${height}x${length}`);

                console.log('\n=== BLOCK DATA ===');
                console.log('Palette:', palette);
                console.log('Data length:', blockData.length);

                if (!palette || !blockData) {
                    throw new Error('Missing palette or block data');
                }

                // Process blocks using our mapping
                console.log('\n=== Processing Blocks ===');
                let blockCount = 0;

                switch (format) {
                    case 'modern_worldedit':
                        // Process blocks for modern WorldEdit format
                        for (let y = 0; y < height; y++) {
                            for (let z = 0; z < length; z++) {
                                for (let x = 0; x < width; x++) {
                                    const index = y * (width * length) + z * width + x;
                                    if (index >= blockData.length) continue;
                                    
                                    const blockId = blockData[index];
                                    
                                    // Find the block name from the palette
                                    const blockName = Object.entries(palette)
                                        .find(([_, id]) => id.value === blockId)?.[0];
                                    
                                    if (!blockName || blockName === 'minecraft:air') continue;

                                    // Get Hytopia block ID from the mapping
                                    let hytopiaBlockId = blockTypeMap.get(blockName);
                                    if (!hytopiaBlockId) {
                                        // Try with base name (without block states)
                                        const baseName = blockName.split('[')[0];
                                        hytopiaBlockId = blockTypeMap.get(baseName);
                                        
                                        if (!hytopiaBlockId) {
                                            if (!missingMappings[baseName]) {
                                                missingMappings[baseName] = 1;
                                            } else {
                                                missingMappings[baseName]++;
                                            }
                                            
                                            // Instead of skipping, use the dynamic ID generation
                                            hytopiaBlockId = getDynamicBlockId(baseName);
                                            console.log(`Using dynamically generated ID ${hytopiaBlockId} for block ${baseName}`);
                                        }
                                    }

                                    const key = `${x},${y},${z}`;
                                    hytopiaMap.blocks[key] = hytopiaBlockId;
                                    blockCount++;
                                }
                            }
                        }
                        break;

                    case 'modern_worldedit_nested':
                        // Process blocks for plague doctor-style format
                        for (let y = 0; y < height; y++) {
                            for (let z = 0; z < length; z++) {
                                for (let x = 0; x < width; x++) {
                                    const index = y * (width * length) + z * width + x;
                                    const blockId = blockData[index];
                                    
                                    // Find the block name from the palette
                                    const blockName = Object.entries(palette)
                                        .find(([_, id]) => id.value === blockId)?.[0];
                                    
                                    if (!blockName || blockName === 'minecraft:air') continue;

                                    // Get Hytopia block ID from the mapping
                                    let hytopiaBlockId = blockTypeMap.get(blockName);
                                    if (!hytopiaBlockId) {
                                        // Try with base name (without block states)
                                        const baseName = blockName.split('[')[0];
                                        hytopiaBlockId = blockTypeMap.get(baseName);
                                        
                                        if (!hytopiaBlockId) {
                                            if (!missingMappings[baseName]) {
                                                missingMappings[baseName] = 1;
                                            } else {
                                                missingMappings[baseName]++;
                                            }
                                            
                                            // Instead of skipping, use the dynamic ID generation
                                            hytopiaBlockId = getDynamicBlockId(baseName);
                                            console.log(`Using dynamically generated ID ${hytopiaBlockId} for block ${baseName}`);
                                        }
                                    }

                                    const key = `${x},${y},${z}`;
                                    hytopiaMap.blocks[key] = hytopiaBlockId;
                                    blockCount++;
                                }
                            }
                        }
                        
                        console.log(`\nProcessing complete for modern_worldedit_nested format:`);
                        console.log(`- Total blocks processed: ${blockCount}`);
                        console.log(`- Final block count: ${Object.keys(hytopiaMap.blocks).length}`);
                        
                        if (Object.keys(missingMappings).length > 0) {
                            console.log("\nMissing block mappings:");
                            Object.entries(missingMappings)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 20)
                                .forEach(([block, count]) => {
                                    console.log(`  ${block}: ${count} occurrences`);
                                });
                        }
                        break;
                        
                    case 'classic_worldedit':
                        // Process blocks for classic WorldEdit format (older .schematic format)
                        // Create a palette for the blocks
                        const classicPalette = createClassicPalette(schematic.Blocks.value, schematic.Data.value, blockMapping);
                        
                        for (let y = 0; y < height; y++) {
                            for (let z = 0; z < length; z++) {
                                for (let x = 0; x < width; x++) {
                                    const index = y * (width * length) + z * width + x;
                                    const blockId = schematic.Blocks.value[index];
                                    const blockData = schematic.Data.value ? schematic.Data.value[index] : 0;
                                    
                                    // Skip air blocks
                                    if (blockId === 0) continue;
                                    
                                    // Get the block name from our palette
                                    const blockKey = `${blockId}:${blockData}`;
                                    const blockName = classicPalette[blockKey] || `minecraft:unknown_${blockKey}`;
                                    
                                    // Get Hytopia block ID from the mapping
                                    let hytopiaBlockId = blockTypeMap.get(blockName);
                                    if (!hytopiaBlockId) {
                                        // Try with base name (without block states)
                                        const baseName = blockName.split('[')[0];
                                        hytopiaBlockId = blockTypeMap.get(baseName);
                                        
                                        if (!hytopiaBlockId) {
                                            if (!missingMappings[baseName]) {
                                                missingMappings[baseName] = 1;
                                            } else {
                                                missingMappings[baseName]++;
                                            }
                                            
                                            // Instead of skipping, use the dynamic ID generation
                                            hytopiaBlockId = getDynamicBlockId(baseName);
                                            console.log(`Using dynamically generated ID ${hytopiaBlockId} for block ${baseName}`);
                                        }
                                    }
                                    
                                    const key = `${x},${y},${z}`;
                                    hytopiaMap.blocks[key] = hytopiaBlockId;
                                }
                            }
                        }
                        
                        console.log(`\nProcessing complete for classic_worldedit format:`);
                        console.log(`- Total blocks processed: ${blockCount}`);
                        console.log(`- Final block count: ${Object.keys(hytopiaMap.blocks).length}`);
                        
                        if (Object.keys(missingMappings).length > 0) {
                            console.log("\nMissing block mappings:");
                            Object.entries(missingMappings)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 20)
                                .forEach(([block, count]) => {
                                    console.log(`  ${block}: ${count} occurrences`);
                                });
                        }
                        break;
                }

                console.log(`\nTotal blocks processed: ${blockCount}`);
                console.log('Sample of first 5 blocks:');
                Object.entries(hytopiaMap.blocks).slice(0, 5).forEach(([pos, id]) => {
                    console.log(`${pos}: ${id}`);
                });

                // We no longer need to add dynamic block types since we're using existing Hytopia blocks
                // The following section has been modified to reflect our new approach
                if (Object.keys(missingMappings).length > 0) {
                    console.log("\nMissing block mappings - using fallback textures:");
                    Object.entries(missingMappings)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 20) // Limit to top 20 for readability
                        .forEach(([block, count]) => {
                            console.log(`  ${block}: ${count} occurrences (mapped to existing Hytopia block)`);
                        });
                }

                // Write final Hytopia map to output file
                fs.writeFileSync(outputPath, JSON.stringify(hytopiaMap, null, 2));
                console.log(`\nConversion complete! Saved to ${outputPath}`);
                console.log(`Processed ${Object.keys(hytopiaMap.blocks).length} blocks`);
                console.log(`Created ${hytopiaMap.blockTypes.length} block types`);

            } catch (processError) {
                console.error('Error processing schematic data:', processError);
                console.error('Full error:', processError.stack);
            }
        });

    } catch (error) {
        console.error('Error during conversion:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Helper function for classic WorldEdit format
function createClassicPalette(blocks, data, blockMapping) {
    const palette = new Map();
    // Use the mapping file to convert classic block IDs to modern names
    const classicToModern = {
        1: 'minecraft:stone',
        2: 'minecraft:grass_block',
        3: 'minecraft:dirt',
        4: 'minecraft:cobblestone',
        5: 'minecraft:oak_planks',
        // Add more default mappings as needed
    };

    for (let i = 0; i < blocks.length; i++) {
        const blockId = blocks[i];
        const blockData = data[i];
        const key = `${blockId}:${blockData}`;
        if (!palette.has(key)) {
            palette.set(key, classicToModern[blockId] || `minecraft:unknown_${blockId}`);
        }
    }
    return palette;
}

// Usage example
async function main() {
    try {
        const inputPath = process.argv[2];
        const outputPath = process.argv[3];
        const mappingPath = process.argv[4] || 'mapping.json';

        if (!inputPath || !outputPath) {
            console.error('Usage: node convertSchem.js <input_path> <output_path> [mapping_path]');
            process.exit(1);
        }

        // Ensure output path ends in .json
        let finalOutputPath = outputPath;
        if (!finalOutputPath.toLowerCase().endsWith('.json')) {
            finalOutputPath = finalOutputPath.replace(/\.[^/.]+$/, '') + '.json';
        }

        const schemPath = path.join(process.cwd(), inputPath);
        const outputFilePath = path.join(process.cwd(), finalOutputPath);
        const fullMappingPath = path.join(process.cwd(), mappingPath);

        console.log('Reading from:', schemPath);
        console.log('Writing to:', outputFilePath);
        console.log('Using mapping:', fullMappingPath);

        await convertSchemToHytopia(schemPath, outputFilePath, fullMappingPath);
    } catch (error) {
        console.error('Failed to convert schematic:', error);
    }
}

main(); 