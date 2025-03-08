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

// Modified loadBlockMappings function to use correct path
async function loadBlockMappings() {
    try {
        // Fix the path to be relative to current directory
        const mappingPath = path.join(__dirname, 'mapping.json');
        const rawData = fs.readFileSync(mappingPath, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error loading block mappings:', error);
        // Return empty mapping instead of {} to match expected structure
        return { blocks: {} };
    }
}

// Update getFallbackBlockId to use the correct mapping structure
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

    // Try with minecraft: prefix if it's missing
    const withPrefix = blockName.startsWith('minecraft:') ? blockName : `minecraft:${plainName}`;
    if (blockMapping.blocks && blockMapping.blocks[withPrefix]) {
        const mappedId = blockMapping.blocks[withPrefix].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (with prefix)`);
        return mappedId;
    }

    // Use stone as fallback (id: 19)
    console.log(`Using fallback stone block for ${blockName}`);
    return 19;
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
        const blockMapping = await loadBlockMappings();
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
        console.log(`Analyzing region file: ${region.path}`);
        const regionBuffer = await region.file.async('nodebuffer');
        const blocks = await analyzeRegionFile(regionBuffer) || {};
        
        // Add null check before Object.keys
        if (blocks && Object.keys(blocks).length > 0) {
            console.log(`Found ${Object.keys(blocks).length} blocks`);
            break;
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
    let blocks = {};
    
    try {
        // Let's look at all chunks in the region file
        for (let chunkX = 0; chunkX < 32; chunkX++) {
            for (let chunkZ = 0; chunkZ < 32; chunkZ++) {
                const headerOffset = 4 * (chunkX + chunkZ * 32);
                const offset = (buffer[headerOffset] << 16) | (buffer[headerOffset + 1] << 8) | buffer[headerOffset + 2];
                
                if (offset === 0) continue;
                
                const chunkStart = offset * 4096;
                if (chunkStart >= buffer.length) continue;

                const length = (buffer[chunkStart] << 24) | (buffer[chunkStart + 1] << 16) | 
                             (buffer[chunkStart + 2] << 8) | buffer[chunkStart + 3];
                
                if (length <= 0 || chunkStart + length > buffer.length) continue;

                try {
                    const compressedData = buffer.slice(chunkStart + 5, chunkStart + 4 + length);
                    const decompressed = pako.inflate(compressedData);
                    const chunkData = await nbt.parse(Buffer.from(decompressed));
                    
                    // Find the sections array
                    const sections = findSectionsRecursively(chunkData.parsed?.value) || [];
                    
                    for (const section of sections) {
                        if (!section) continue;
                        
                        const sectionY = section.Y?.value || 0;
                        const blockStates = section.block_states?.value || {};
                        const palette = blockStates.palette?.value?.value || [];
                        
                        if (!palette.length) continue;

                        let data = blockStates.data?.value;
                        if (Array.isArray(blockStates.data?.value?.value)) {
                            data = blockStates.data.value.value;
                        }

                        if (!Array.isArray(data)) continue;

                        const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
                        const blocksPerLong = Math.floor(64 / bitsPerBlock);
                        const mask = (1n << BigInt(bitsPerBlock)) - 1n;

                        let blockIndex = 0;
                        for (let i = 0; i < data.length; i++) {
                            let longValue;
                            if (Array.isArray(data[i])) {
                                longValue = (BigInt(data[i][0]) << 32n) | BigInt(data[i][1]);
                            } else {
                                longValue = BigInt(data[i]);
                            }

                            for (let j = 0; j < blocksPerLong && blockIndex < 4096; j++) {
                                const shiftAmount = BigInt(j * bitsPerBlock);
                                const index = Number((longValue >> shiftAmount) & mask);
                                const block = palette[index % palette.length];
                                const blockName = typeof block === 'string' ? block : (block.Name?.value || block.name?.value);
                                
                                if (blockName && blockName !== 'minecraft:air') {
                                    const worldX = chunkX * 16 + (blockIndex % 16);
                                    const worldY = sectionY * 16 + Math.floor(blockIndex / 256);
                                    const worldZ = chunkZ * 16 + Math.floor((blockIndex % 256) / 16);
                                    
                                    blockStatistics.trackBlock(blockName, worldY);
                                    
                                    if (!blocks[worldY]) blocks[worldY] = {};
                                    if (!blocks[worldY][worldX]) blocks[worldY][worldX] = {};
                                    blocks[worldY][worldX][worldZ] = blockName;
                                }
                                
                                blockIndex++;
                            }
                        }
                    }
                } catch (err) {
                    continue;
                }
            }
        }
    } catch (error) {
        console.error('Error analyzing region:', error);
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