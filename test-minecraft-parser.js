const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const nbt = require('prismarine-nbt');
const pako = require('pako');
const { Buffer } = require('buffer');

// Update fallback mapping to match SchematicConverter.js
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

// Default block mapping that matches SchematicConverter.js
const defaultBlockMapping = {
    blocks: {
        "minecraft:stone": { id: 37, hytopiaBlock: "stone" },
        "minecraft:dirt": { id: 8, hytopiaBlock: "dirt" },
        "minecraft:grass_block": { id: 16, hytopiaBlock: "grass" },
        "minecraft:oak_planks": { id: 28, hytopiaBlock: "oak-planks" },
        "minecraft:oak_log": { id: 23, hytopiaBlock: "log" },
        "minecraft:glass": { id: 14, hytopiaBlock: "glass" },
        "minecraft:bricks": { id: 1, hytopiaBlock: "bricks" },
        "minecraft:black_wool": { id: 37, hytopiaBlock: "stone" },
        "minecraft:white_wool": { id: 43, hytopiaBlock: "water-still" },
        "minecraft:red_wool": { id: 1, hytopiaBlock: "bricks" },
        "minecraft:brown_wool": { id: 8, hytopiaBlock: "dirt" },
        "minecraft:brown_concrete": { id: 8, hytopiaBlock: "dirt" },
        "minecraft:white_concrete": { id: 14, hytopiaBlock: "glass" },
        "minecraft:black_concrete": { id: 37, hytopiaBlock: "stone" },
        "minecraft:white_concrete_powder": { id: 14, hytopiaBlock: "glass" },
        "minecraft:coal_block": { id: 37, hytopiaBlock: "stone" }
    }
};

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
    }
};

// Add loadBlockMapping function from SchematicConverter.js
async function loadBlockMapping(mappingPath = 'mapping.json') {
    try {
        console.log(`Attempting to load block mapping from: ${mappingPath}`);
        const data = await fs.promises.readFile(mappingPath, 'utf8');
        const mappingData = JSON.parse(data);
        console.log(`Successfully loaded mapping with ${Object.keys(mappingData.blocks || {}).length} block definitions`);
        return mappingData;
    } catch (error) {
        console.error(`Error loading block mapping file: ${error.message}`);
        console.log('Using default fallback mappings');
        return defaultBlockMapping;
    }
}

// Update getFallbackBlockId to match SchematicConverter.js logic
function getFallbackBlockId(blockName, blockMapping) {
    const plainName = blockName.replace('minecraft:', '');
    
    // Check if we've already mapped this block
    if (dynamicBlockMappings.has(plainName)) {
        return dynamicBlockMappings.get(plainName);
    }

    // First try exact match in block mapping
    if (blockMapping.blocks && blockMapping.blocks[blockName]) {
        const mappedId = blockMapping.blocks[blockName].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (exact match)`);
        return mappedId;
    }

    // Try without minecraft: prefix
    const withPrefix = `minecraft:${plainName}`;
    if (blockMapping.blocks && blockMapping.blocks[withPrefix]) {
        const mappedId = blockMapping.blocks[withPrefix].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (with prefix)`);
        return mappedId;
    }

    // Try base name without block states
    const baseName = blockName.split('[')[0];
    if (blockMapping.blocks && blockMapping.blocks[baseName]) {
        const mappedId = blockMapping.blocks[baseName].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (base name)`);
        return mappedId;
    }

    // Try fallback category matching
    for (const [category, fallbackBlock] of Object.entries(fallbackMapping)) {
        if (category !== 'unknown' && plainName.toLowerCase().includes(category)) {
            dynamicBlockMappings.set(plainName, fallbackBlock.id);
            console.log(`Mapped ${plainName} to ${fallbackBlock.name} (ID: ${fallbackBlock.id})`);
            return fallbackBlock.id;
        }
    }

    // Use default stone block if no match found
    dynamicBlockMappings.set(plainName, fallbackMapping.unknown.id);
    console.log(`Using default stone block for ${plainName}`);
    return fallbackMapping.unknown.id;
}

// Utility function to read a file as buffer
async function readFileAsBuffer(filePath) {
    return fs.promises.readFile(filePath);
}

// Function to parse NBT data with multiple attempts
async function parseNBTWithFallback(buffer) {
    const attempts = [
        {
            name: 'Direct NBT parse',
            fn: async () => await nbt.parse(buffer)
        },
        {
            name: 'Pako inflate from start',
            fn: async () => {
                const decompressed = pako.inflate(buffer);
                return await nbt.parse(Buffer.from(decompressed));
            }
        },
        {
            name: 'Pako inflate skip GZip header',
            fn: async () => {
                const decompressed = pako.inflate(buffer.slice(8));
                return await nbt.parse(Buffer.from(decompressed));
            }
        },
        {
            name: 'Direct parse without decompression',
            fn: async () => await nbt.parse(Buffer.from(buffer))
        }
    ];

    let lastError = null;
    for (const attempt of attempts) {
        try {
            console.log(`Attempting: ${attempt.name}`);
            const result = await attempt.fn();
            console.log(`Success with: ${attempt.name}`);
            return result;
        } catch (err) {
            console.log(`Failed ${attempt.name}:`, err.message);
            lastError = err;
        }
    }
    
    throw new Error(`All parsing attempts failed. Last error: ${lastError.message}`);
}

// Add this after the other global variables
const blockStatistics = {
    totalBlocks: 0,
    blockTypes: {},
    heightMap: {},
    commonBlocks: [],
    mappingTypes: {}, // Track how blocks were mapped (exact, prefix, fallback, etc.)

    trackBlock: function(blockName, y, mappingType = 'unknown') {
        // Track block type count
        if (!this.blockTypes[blockName]) {
            this.blockTypes[blockName] = 0;
        }
        this.blockTypes[blockName]++;
        this.totalBlocks++;

        // Track height distribution
        const heightKey = Math.floor(y / 16) * 16;
        if (!this.heightMap[heightKey]) {
            this.heightMap[heightKey] = 0;
        }
        this.heightMap[heightKey]++;

        // Track mapping type used
        if (!this.mappingTypes[blockName]) {
            this.mappingTypes[blockName] = mappingType;
        }
    },

    generateReport: function() {
        // Sort block types by frequency
        this.commonBlocks = Object.entries(this.blockTypes)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);

        // Generate report
        let report = '\n=== Block Statistics Report ===\n';
        report += `Total Blocks: ${this.totalBlocks}\n`;
        report += `Unique Block Types: ${Object.keys(this.blockTypes).length}\n`;
        
        report += '\nTop 10 Most Common Blocks:\n';
        this.commonBlocks.forEach(([block, count], index) => {
            const percentage = ((count / this.totalBlocks) * 100).toFixed(2);
            const mappingType = this.mappingTypes[block] || 'unknown';
            report += `${index + 1}. ${block}: ${count} (${percentage}%) [${mappingType}]\n`;
        });

        report += '\nHeight Distribution:\n';
        const sortedHeights = Object.entries(this.heightMap)
            .sort(([a], [b]) => Number(a) - Number(b));
        
        sortedHeights.forEach(([height, count]) => {
            const percentage = ((count / this.totalBlocks) * 100).toFixed(2);
            report += `Y ${height}-${Number(height) + 15}: ${count} blocks (${percentage}%)\n`;
        });

        return report;
    },

    reset: function() {
        this.totalBlocks = 0;
        this.blockTypes = {};
        this.heightMap = {};
        this.commonBlocks = [];
        this.mappingTypes = {};
    }
};

// Add this helper function to find sections recursively
function findSectionsRecursively(obj, depth = 0, maxDepth = 5) {
    if (!obj || typeof obj !== 'object' || depth > maxDepth) {
        return null;
    }
    
    // Check if this is a sections array
    if (Array.isArray(obj) && obj.length > 0 && 
        obj.some(item => item && typeof item === 'object' && 
        (item.Y !== undefined || item.y !== undefined))) {
        return obj;
    }
    
    // Check direct properties
    if (obj.sections && Array.isArray(obj.sections)) {
        return obj.sections;
    }
    if (obj.Sections && Array.isArray(obj.Sections)) {
        return obj.Sections;
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

// Main test function
async function testMinecraftWorldParsing(worldFilePath) {
    try {
        // Reset statistics and mappings at start
        blockStatistics.reset();
        unmappedBlockTracker.reset();
        dynamicBlockMappings.clear();

        console.log('Reading world file:', worldFilePath);
        const buffer = await readFileAsBuffer(worldFilePath);
        
        // Load block mapping first
        const blockMapping = await loadBlockMapping();
        console.log(`Loaded ${Object.keys(blockMapping.blocks || {}).length} block mappings`);

        // Load the ZIP file
        console.log('Loading ZIP file...');
        const zip = await JSZip.loadAsync(buffer);
        
        // List all files in the ZIP
        console.log('\nFiles in ZIP:');
        zip.forEach((relativePath, file) => {
            console.log(relativePath);
        });
        
        // Try to find level.dat
        const potentialPaths = [
            'level.dat',
            '/level.dat',
            './level.dat',
            'world/level.dat',
            'New World/level.dat',
            'saves/level.dat'
        ];
        
        let levelDatFile = null;
        let levelDatPath = '';
        
        // Look for level.dat
        for (const path of potentialPaths) {
            if (zip.file(path)) {
                levelDatFile = zip.file(path);
                levelDatPath = path;
                console.log(`\nFound level.dat at: ${path}`);
                break;
            }
        }
        
        if (!levelDatFile) {
            // Try finding any file ending with level.dat
            const levelDatMatch = Object.keys(zip.files).find(path => path.endsWith('level.dat'));
            if (levelDatMatch) {
                levelDatFile = zip.file(levelDatMatch);
                levelDatPath = levelDatMatch;
                console.log(`\nFound level.dat using general search at: ${levelDatMatch}`);
            }
        }
        
        if (!levelDatFile) {
            throw new Error('level.dat not found in world file');
        }
        
        // Extract and parse level.dat
        console.log('\nExtracting level.dat...');
        const levelDatBuffer = await levelDatFile.async('nodebuffer');
        
        console.log('\nParsing level.dat...');
        const worldData = await parseNBTWithFallback(levelDatBuffer);
        
        // Print parsed data structure
        console.log('\nParsed NBT Structure:');
        console.log(JSON.stringify(worldData, null, 2).substring(0, 1000) + '...');
        
        // Extract basic world info
        const worldInfo = extractWorldInfo(worldData);
        console.log('\nExtracted World Info:', worldInfo);
        
        // Find and analyze region files
        const basePath = levelDatPath.includes('/') ? 
            levelDatPath.substring(0, levelDatPath.lastIndexOf('/') + 1) : '';
        
        await analyzeRegionFiles(zip, basePath);
        
        // After processing all regions, print statistics
        console.log(blockStatistics.generateReport());
        
        // If there are unmapped blocks, show those too
        if (Object.keys(unmappedBlockTracker.blocks).length > 0) {
            console.log('\n=== Unmapped Blocks ===');
            for (const [blockName, data] of Object.entries(unmappedBlockTracker.blocks)) {
                console.log(`${blockName}:`);
                console.log(`  Count: ${data.count}`);
                console.log(`  First occurrence: ${data.positions[0]}`);
                console.log(`  Fallback ID used: ${data.fallbackId}`);
            }
        }

    } catch (error) {
        console.error('Error parsing world:', error);
    }
}

// Helper function to extract world info from NBT data
function extractWorldInfo(worldData) {
    const info = {
        name: 'Unknown',
        gameVersion: 'Unknown',
        gameType: 0,
        spawnX: 0,
        spawnY: 64,
        spawnZ: 0
    };
    
    try {
        if (worldData.value && worldData.value.Data) {
            const data = worldData.value.Data;
            info.name = data.LevelName?.value || info.name;
            info.gameVersion = data.Version?.Name?.value || info.gameVersion;
            info.gameType = data.GameType?.value || info.gameType;
            info.spawnX = data.SpawnX?.value || info.spawnX;
            info.spawnY = data.SpawnY?.value || info.spawnY;
            info.spawnZ = data.SpawnZ?.value || info.spawnZ;
        } else if (worldData.value) {
            // Try to find properties at any level
            const searchNBT = (obj, keys) => {
                if (!obj || typeof obj !== 'object') return null;
                for (const key of keys) {
                    if (obj[key] && obj[key].value !== undefined) {
                        return obj[key].value;
                    }
                }
                for (const prop in obj) {
                    if (typeof obj[prop] === 'object') {
                        const result = searchNBT(obj[prop], keys);
                        if (result !== null) return result;
                    }
                }
                return null;
            };
            
            info.name = searchNBT(worldData.value, ['LevelName']) || info.name;
            info.gameVersion = searchNBT(worldData.value, ['Name', 'Version']) || info.gameVersion;
            info.gameType = searchNBT(worldData.value, ['GameType']) || info.gameType;
            info.spawnX = searchNBT(worldData.value, ['SpawnX']) || info.spawnX;
            info.spawnY = searchNBT(worldData.value, ['SpawnY']) || info.spawnY;
            info.spawnZ = searchNBT(worldData.value, ['SpawnZ']) || info.spawnZ;
        }
    } catch (err) {
        console.warn('Error extracting world info:', err);
    }
    
    return info;
}

// Helper function to analyze region files
async function analyzeRegionFiles(zip, basePath) {
    const regionPaths = [
        `${basePath}region`,
        `${basePath}region/`,
        'region',
        'region/',
        `${basePath}DIM0/region/`,
        `${basePath}DIM0/region`
    ];
    
    console.log('\nSearching for region files...');
    
    let regionFiles = [];
    
    // Find all .mca files
    zip.forEach((relativePath, file) => {
        if (relativePath.endsWith('.mca')) {
            regionFiles.push({
                path: relativePath,
                file: file
            });
        }
    });
    
    console.log(`Found ${regionFiles.length} region files`);
    
    // Sort region files by name to ensure consistent processing order
    regionFiles.sort((a, b) => a.path.localeCompare(b.path));
    
    // Process each region file until we find blocks
    for (const region of regionFiles) {
        console.log(`\nAnalyzing region file: ${region.path}`);
        
        const regionBuffer = await region.file.async('nodebuffer');
        const blocks = await analyzeRegionFile(regionBuffer);
        
        // If we found blocks in this region, we can stop
        if (Object.keys(blocks).length > 0) {
            console.log(`Found ${Object.keys(blocks).length} blocks in ${region.path}`);
            break;
        } else {
            console.log(`No blocks found in ${region.path}, trying next region file...`);
        }
    }
}

// Helper function to safely stringify chunk data
function safeStringifyChunk(data, maxLength = 500) {
    try {
        if (!data) return 'No data';
        const stringified = JSON.stringify(data, null, 2);
        if (stringified.length > maxLength) {
            return stringified.substring(0, maxLength) + '...';
        }
        return stringified;
    } catch (err) {
        return `Error stringifying chunk: ${err.message}`;
    }
}

// Helper function to analyze a single region file
async function analyzeRegionFile(buffer) {
    console.log(`Region file size: ${buffer.length} bytes`);
    const blocks = {};
    let totalValidChunks = 0;
    
    try {
        for (let chunkZ = 0; chunkZ < 32; chunkZ++) {
            for (let chunkX = 0; chunkX < 32; chunkX++) {
                const headerOffset = 4 * (chunkX + chunkZ * 32);
                const offset = (buffer[headerOffset] << 16) | (buffer[headerOffset + 1] << 8) | buffer[headerOffset + 2];
                
                if (offset === 0) {
                    if (chunkX === 0 && chunkZ === 0) console.log('Skipping empty chunk');
                    continue;
                }
                
                const chunkStart = offset * 4096;
                if (chunkStart >= buffer.length) {
                    if (chunkX < 3 && chunkZ < 3) console.log(`Invalid chunk offset at (${chunkX}, ${chunkZ}): ${chunkStart} >= ${buffer.length}`);
                    continue;
                }

                const length = (buffer[chunkStart] << 24) | (buffer[chunkStart + 1] << 16) | 
                             (buffer[chunkStart + 2] << 8) | buffer[chunkStart + 3];
                
                if (length <= 0 || chunkStart + length > buffer.length) {
                    if (chunkX < 3 && chunkZ < 3) console.log(`Invalid chunk length at (${chunkX}, ${chunkZ}): ${length}`);
                    continue;
                }

                try {
                    const compressedData = buffer.slice(chunkStart + 5, chunkStart + 4 + length);
                    const compressionType = buffer[chunkStart + 4];
                    
                    if (chunkX === 0 && chunkZ === 0) {
                        console.log(`First chunk compression type: ${compressionType}`);
                        console.log(`First chunk compressed size: ${compressedData.length} bytes`);
                    }

                    let decompressed;
                    try {
                        decompressed = pako.inflate(compressedData);
                        if (chunkX === 0 && chunkZ === 0) {
                            console.log(`Successfully decompressed first chunk: ${decompressed.length} bytes`);
                        }
                    } catch (err) {
                        if (chunkX < 3 && chunkZ < 3) {
                            console.log(`Decompression error at (${chunkX}, ${chunkZ}):`, err.message);
                            console.log('Trying alternative decompression...');
                        }
                        // Try alternative decompression (skipping potential gzip header)
                        decompressed = pako.inflate(compressedData.slice(2));
                    }

                    const chunkData = await nbt.parse(Buffer.from(decompressed));
                    totalValidChunks++;

                    if (chunkX === 0 && chunkZ === 0) {
                        console.log('\nFirst chunk NBT structure:');
                        console.log(safeStringifyChunk(chunkData, 1000));
                    }

                    // Get the sections from the parsed NBT data
                    const sections = chunkData.parsed?.value?.sections?.value?.value || [];
                    
                    if (sections.length > 0 && chunkX === 0 && chunkZ === 0) {
                        console.log(`\nFound ${sections.length} sections in chunk`);
                        console.log('First section structure:', safeStringifyChunk(sections[0], 500));
                    }

                    for (const section of sections) {
                        if (!section) continue;
                        
                        const sectionY = section.Y?.value || 0;
                        
                        // Get block states from the section
                        const blockStates = section.block_states?.value || {};
                        const palette = blockStates.palette?.value?.value || [];
                        
                        // Get the block data array - handle both direct value and nested value cases
                        let data = blockStates.data?.value;
                        if (Array.isArray(blockStates.data?.value?.value)) {
                            data = blockStates.data.value.value;
                        }
                        
                        if (chunkX === 0 && chunkZ === 0 && section === sections[0]) {
                            console.log(`\nSection Y=${sectionY}`);
                            console.log('Block states:', safeStringifyChunk(blockStates, 200));
                            console.log('Palette entries:', palette.length);
                            if (palette.length > 0) {
                                palette.forEach((entry, idx) => {
                                    if (entry.Name) {
                                        console.log(`Palette entry ${idx}: ${entry.Name.value}`);
                                    } else {
                                        console.log(`Palette entry ${idx}:`, safeStringifyChunk(entry, 200));
                                    }
                                });
                            }
                            console.log('Data array:', data ? `length=${data.length}` : 'undefined');
                            if (data && data.length > 0) {
                                console.log('First few data values:', data.slice(0, 5));
                            }
                        }

                        // Skip if no blocks defined
                        if (!palette.length) {
                            if (chunkX === 0 && chunkZ === 0) {
                                console.log('Skipping section - no palette');
                            }
                            continue;
                        }

                        // If no data array but we have a palette with one entry, it means the entire section is that block
                        if (!data || !data.length) {
                            if (palette.length === 1) {
                                const block = palette[0];
                                let blockName = typeof block === 'string' ? block : (block.Name?.value || block.name?.value);
                                if (blockName && blockName !== 'minecraft:air') {
                                    // Fill entire section with this block
                                    for (let y = 0; y < 16; y++) {
                                        const worldY = sectionY * 16 + y;
                                        for (let z = 0; z < 16; z++) {
                                            for (let x = 0; x < 16; x++) {
                                                const worldX = chunkX * 16 + x;
                                                const worldZ = chunkZ * 16 + z;
                                                
                                                if (chunkX === 0 && chunkZ === 0) {
                                                    console.log(`Found uniform block ${blockName} at ${worldX},${worldY},${worldZ}`);
                                                }
                                                
                                                const mappedId = getFallbackBlockId(blockName, blockMapping);
                                                blocks[`${worldX},${worldY},${worldZ}`] = mappedId;
                                                
                                                let mappingType = 'fallback';
                                                if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                                                    mappingType = 'exact';
                                                } else if (blockMapping.blocks && blockMapping.blocks[`minecraft:${blockName.replace('minecraft:', '')}`]) {
                                                    mappingType = 'prefix';
                                                } else if (blockMapping.blocks && blockMapping.blocks[blockName.split('[')[0]]) {
                                                    mappingType = 'base';
                                                }
                                                
                                                blockStatistics.trackBlock(blockName, worldY, mappingType);
                                            }
                                        }
                                    }
                                } else if (chunkX === 0 && chunkZ === 0) {
                                    console.log('Skipping uniform air section');
                                }
                                continue;
                            } else {
                                if (chunkX === 0 && chunkZ === 0) {
                                    console.log('Skipping section - no data array');
                                }
                                continue;
                            }
                        }

                        // Process blocks in this section
                        for (let y = 0; y < 16; y++) {
                            const worldY = sectionY * 16 + y;
                            for (let z = 0; z < 16; z++) {
                                for (let x = 0; x < 16; x++) {
                                    const index = y * 256 + z * 16 + x;
                                    const paletteIndex = data[index] || 0;
                                    
                                    if (paletteIndex >= palette.length) continue;
                                    
                                    const block = palette[paletteIndex];
                                    if (!block) continue;
                                    
                                    // Handle both string values and compound NBT values
                                    let blockName = typeof block === 'string' ? block : (block.Name?.value || block.name?.value);
                                    if (!blockName || blockName === 'minecraft:air') continue;
                                    
                                    const worldX = chunkX * 16 + x;
                                    const worldZ = chunkZ * 16 + z;
                                    
                                    if (chunkX === 0 && chunkZ === 0 && blockName !== 'minecraft:air') {
                                        console.log(`Found block ${blockName} at ${worldX},${worldY},${worldZ}`);
                                    }
                                    
                                    const mappedId = getFallbackBlockId(blockName, blockMapping);
                                    blocks[`${worldX},${worldY},${worldZ}`] = mappedId;
                                    
                                    // Determine mapping type
                                    let mappingType = 'fallback';
                                    if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                                        mappingType = 'exact';
                                    } else if (blockMapping.blocks && blockMapping.blocks[`minecraft:${blockName.replace('minecraft:', '')}`]) {
                                        mappingType = 'prefix';
                                    } else if (blockMapping.blocks && blockMapping.blocks[blockName.split('[')[0]]) {
                                        mappingType = 'base';
                                    } else {
                                        for (const category of Object.keys(fallbackMapping)) {
                                            if (category !== 'unknown' && blockName.toLowerCase().includes(category)) {
                                                mappingType = `fallback:${category}`;
                                                break;
                                            }
                                        }
                                    }

                                    blockStatistics.trackBlock(blockName, worldY, mappingType);
                                    
                                    if (!dynamicBlockMappings.has(blockName)) {
                                        unmappedBlockTracker.trackBlock(
                                            blockName, 
                                            `${worldX},${worldY},${worldZ}`, 
                                            mappedId
                                        );
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    if (chunkX < 3 && chunkZ < 3) {
                        console.warn(`Error processing chunk at (${chunkX}, ${chunkZ}):`, error.message);
                    }
                }
            }
        }
        console.log(`\nProcessed ${totalValidChunks} valid chunks`);
    } catch (error) {
        console.error('Error analyzing region file:', error);
    }
    
    return blocks;
}

// Run the test if this file is run directly
if (require.main === module) {
    const worldPath = process.argv[2];
    if (!worldPath) {
        console.error('Please provide the path to the Minecraft world file');
        console.log('Usage: node test-minecraft-parser.js <path-to-world-file>');
        process.exit(1);
    }
    
    testMinecraftWorldParsing(worldPath)
        .then(() => console.log('\nTest complete'))
        .catch(err => console.error('Test failed:', err));
} 