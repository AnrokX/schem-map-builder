const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const nbt = require('prismarine-nbt');
const pako = require('pako');
const { Buffer } = require('buffer');

// Add these after the existing requires
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
    }
};

// Add this helper function
function getFallbackBlockId(blockName) {
    const plainName = blockName.replace('minecraft:', '');
    
    if (dynamicBlockMappings.has(plainName)) {
        return dynamicBlockMappings.get(plainName);
    }

    for (const [category, fallbackBlock] of Object.entries(fallbackMapping)) {
        if (category !== 'unknown' && plainName.toLowerCase().includes(category)) {
            dynamicBlockMappings.set(plainName, fallbackBlock.id);
            console.log(`Mapped ${plainName} to ${fallbackBlock.name} (ID: ${fallbackBlock.id})`);
            return fallbackBlock.id;
        }
    }

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

    trackBlock: function(blockName, y) {
        // Track block type count
        if (!this.blockTypes[blockName]) {
            this.blockTypes[blockName] = 0;
        }
        this.blockTypes[blockName]++;
        this.totalBlocks++;

        // Track height distribution
        const heightKey = Math.floor(y / 16) * 16; // Group by 16-block sections
        if (!this.heightMap[heightKey]) {
            this.heightMap[heightKey] = 0;
        }
        this.heightMap[heightKey]++;
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
            report += `${index + 1}. ${block}: ${count} (${percentage}%)\n`;
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
        // Reset statistics at start
        blockStatistics.reset();

        console.log('Reading world file:', worldFilePath);
        const buffer = await readFileAsBuffer(worldFilePath);
        
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
    
    // Analyze first region file if available
    if (regionFiles.length > 0) {
        const firstRegion = regionFiles[0];
        console.log(`\nAnalyzing first region file: ${firstRegion.path}`);
        
        const regionBuffer = await firstRegion.file.async('nodebuffer');
        await analyzeRegionFile(regionBuffer);
    }
}

// Helper function to analyze a single region file
async function analyzeRegionFile(buffer) {
    console.log(`Region file size: ${buffer.length} bytes`);
    const blocks = {};
    
    try {
        for (let chunkZ = 0; chunkZ < 32; chunkZ++) {
            for (let chunkX = 0; chunkX < 32; chunkX++) {
                const headerOffset = 4 * (chunkX + chunkZ * 32);
                const offset = (buffer[headerOffset] << 16) | (buffer[headerOffset + 1] << 8) | buffer[headerOffset + 2];
                
                if (offset === 0) continue;
                
                const chunkStart = offset * 4096;
                const length = (buffer[chunkStart] << 24) | (buffer[chunkStart + 1] << 16) | 
                             (buffer[chunkStart + 2] << 8) | buffer[chunkStart + 3];
                
                try {
                    const compressedData = buffer.slice(chunkStart + 5, chunkStart + 4 + length);
                    const decompressed = pako.inflate(compressedData);
                    const chunkData = await nbt.parse(Buffer.from(decompressed));
                    
                    // Find sections using recursive search
                    const sections = findSectionsRecursively(chunkData.value) || [];
                    console.log(`Found ${sections.length} sections in chunk (${chunkX}, ${chunkZ})`);

                    for (const section of sections) {
                        if (!section || typeof section !== 'object') continue;
                        
                        const sectionY = section.Y?.value || 0;
                        console.log(`Processing section Y=${sectionY}`);

                        // Handle 1.21 format where block states are nested
                        const blockStatesContainer = section.block_states || section.BlockStates;
                        if (!blockStatesContainer) {
                            console.log(`No block states found in section Y=${sectionY}`);
                            continue;
                        }

                        // Get palette from the new structure
                        const palette = blockStatesContainer.palette?.value || 
                                      blockStatesContainer.Palette?.value || [];
                        
                        if (!palette.length) {
                            console.log(`No palette found in section Y=${sectionY}`);
                            continue;
                        }

                        // Get block states data
                        const blockStates = blockStatesContainer.data?.value || [];
                        
                        if (!blockStates.length) {
                            console.log(`No block states data found in section Y=${sectionY}`);
                            continue;
                        }

                        console.log(`Processing section Y=${sectionY} with palette size ${palette.length}`);

                        // Process blocks in this section
                        for (let y = 0; y < 16; y++) {
                            const worldY = sectionY * 16 + y;
                            for (let z = 0; z < 16; z++) {
                                for (let x = 0; x < 16; x++) {
                                    const index = y * 256 + z * 16 + x;
                                    const paletteIndex = blockStates[index] || 0;
                                    
                                    if (paletteIndex >= palette.length) continue;
                                    
                                    const block = palette[paletteIndex];
                                    if (!block) continue;
                                    
                                    let blockName = block.Name?.value || block.name?.value;
                                    if (!blockName || blockName === 'minecraft:air') continue;
                                    
                                    const worldX = chunkX * 16 + x;
                                    const worldZ = chunkZ * 16 + z;
                                    
                                    const mappedId = getFallbackBlockId(blockName);
                                    blocks[`${worldX},${worldY},${worldZ}`] = mappedId;
                                    
                                    blockStatistics.trackBlock(blockName, worldY);
                                    
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
                    console.warn(`Error processing chunk at (${chunkX}, ${chunkZ}):`, error.message);
                }
            }
        }
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