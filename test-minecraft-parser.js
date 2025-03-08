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

// Main test function
async function testMinecraftWorldParsing(worldFilePath) {
    try {
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
    
    // Read the first chunk location
    const offset = (buffer[0] << 16) | (buffer[1] << 8) | buffer[2];
    const sectorCount = buffer[3];
    
    console.log(`First chunk: offset=${offset}, sectors=${sectorCount}`);
    
    if (offset === 0 || sectorCount === 0) {
        console.log('First chunk is empty');
        return;
    }
    
    const chunkOffset = offset * 4096;
    console.log(`Chunk data starts at byte ${chunkOffset}`);
    
    try {
        // Read chunk length and compression type
        const chunkLength = (buffer[chunkOffset] << 24) | 
                          (buffer[chunkOffset + 1] << 16) | 
                          (buffer[chunkOffset + 2] << 8) | 
                          buffer[chunkOffset + 3];
        const compressionType = buffer[chunkOffset + 4];
        
        console.log(`Chunk length: ${chunkLength}, compression type: ${compressionType}`);
        
        // Extract chunk data
        const compressedData = buffer.slice(chunkOffset + 5, chunkOffset + 5 + chunkLength);
        console.log(`Compressed data length: ${compressedData.length}`);
        
        // Try to decompress and parse
        let chunkData;
        if (compressionType === 1 || compressionType === 2) {
            console.log('Decompressing chunk data...');
            const decompressed = pako.inflate(new Uint8Array(compressedData));
            chunkData = Buffer.from(decompressed.buffer);
            
            console.log('Parsing chunk NBT data...');
            const nbtData = await parseNBTWithFallback(chunkData);
            
            // Print chunk structure
            console.log('\nChunk NBT Structure:');
            console.log(JSON.stringify(nbtData, null, 2).substring(0, 1000) + '...');
        } else {
            console.log(`Unsupported compression type: ${compressionType}`);
        }
    } catch (error) {
        console.error('Error analyzing chunk:', error);
    }
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