/* global BigInt */
import { DatabaseManager, STORES } from "./DatabaseManager";
import * as nbt from 'prismarine-nbt';
import pako from 'pako';
import { Buffer } from 'buffer';
import JSZip from 'jszip';

// Add BigInt polyfill
const BigIntPolyfill = typeof BigInt !== 'undefined' ? BigInt : Number;

// const fs = require('fs');
// const path = require('path');
// const { Buffer } = require('buffer'); // Already imported above

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
    },
    hasUnmappedBlocks: function() {
        return Object.keys(this.blocks).length > 0;
    }
};

// Modified loadBlockMappings function to use fetch instead of fs
async function loadBlockMapping(mappingUrl = '/mapping.json') {
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
        
        return mappingData;
    } catch (error) {
        console.error('Error loading block mappings:', error);
        // Return default mapping if loading fails
        return defaultBlockMapping;
    }
}

// Update getFallbackBlockId to handle missing blockMapping parameter
function getFallbackBlockId(blockName, blockMapping = defaultBlockMapping) {
    const plainName = blockName.replace('minecraft:', '');
    
    // Check if we've already mapped this block
    if (dynamicBlockMappings.has(plainName)) {
        return dynamicBlockMappings.get(plainName);
    }

    // First try exact match in block mapping
    if (blockMapping?.blocks && blockMapping.blocks[blockName]) {
        const mappedId = blockMapping.blocks[blockName].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (exact match)`);
        return mappedId;
    }

    // Try with minecraft: prefix if it's missing
    const withPrefix = blockName.startsWith('minecraft:') ? blockName : `minecraft:${plainName}`;
    if (blockMapping?.blocks && blockMapping.blocks[withPrefix]) {
        const mappedId = blockMapping.blocks[withPrefix].id;
        dynamicBlockMappings.set(plainName, mappedId);
        console.log(`Mapped ${blockName} to ID ${mappedId} (with prefix)`);
        return mappedId;
    }

    // Try to find a fallback based on block name
    for (const [category, fallback] of Object.entries(fallbackMapping)) {
        if (category !== 'unknown' && plainName.toLowerCase().includes(category)) {
            const fallbackId = fallback.id;
            dynamicBlockMappings.set(plainName, fallbackId);
            console.log(`Using fallback ${category} (ID: ${fallbackId}) for ${blockName}`);
            return fallbackId;
        }
    }

    // Use stone as ultimate fallback
    console.log(`Using default stone block for ${blockName}`);
    return fallbackMapping.stone.id;
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

// Add a new class for storing block data for visualization
const BlockDataCollector = {
    blocksByType: {},  // Stores blocks grouped by type with coordinates
    blocksByRegion: {}, // Stores blocks organized by 16x16x16 regions
    chunkData: {},     // Stores chunk-level data
    totalBlockCount: 0,
    maxHeight: 0,
    minHeight: 999,
    
    // Track a block with its position and attributes
    addBlock: function(blockName, x, y, z, attributes = {}) {
        this.totalBlockCount++;
        
        // Update height bounds
        this.maxHeight = Math.max(this.maxHeight, y);
        this.minHeight = Math.min(this.minHeight, y);
        
        // Store by block type
        if (!this.blocksByType[blockName]) {
            this.blocksByType[blockName] = [];
        }
        this.blocksByType[blockName].push({x, y, z, ...attributes});
        
        // Store by region (16x16x16 volumes)
        const regionX = Math.floor(x / 16);
        const regionY = Math.floor(y / 16);
        const regionZ = Math.floor(z / 16);
        const regionKey = `${regionX},${regionY},${regionZ}`;
        
        if (!this.blocksByRegion[regionKey]) {
            this.blocksByRegion[regionKey] = {
                x: regionX, y: regionY, z: regionZ,
                blocks: {}
            };
        }
        
        if (!this.blocksByRegion[regionKey].blocks[blockName]) {
            this.blocksByRegion[regionKey].blocks[blockName] = [];
        }
        
        this.blocksByRegion[regionKey].blocks[blockName].push({
            x: x % 16, y: y % 16, z: z % 16, ...attributes
        });
        
        // Store chunk data
        const chunkX = Math.floor(x / 16);
        const chunkZ = Math.floor(z / 16);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        if (!this.chunkData[chunkKey]) {
            this.chunkData[chunkKey] = {
                x: chunkX, z: chunkZ,
                blockCount: 0,
                blockTypes: {},
                heightMap: {}
            };
        }
        
        this.chunkData[chunkKey].blockCount++;
        if (!this.chunkData[chunkKey].blockTypes[blockName]) {
            this.chunkData[chunkKey].blockTypes[blockName] = 0;
        }
        this.chunkData[chunkKey].blockTypes[blockName]++;
        
        // Update chunk heightmap
        if (!this.chunkData[chunkKey].heightMap[`${x % 16},${z % 16}`] ||
            this.chunkData[chunkKey].heightMap[`${x % 16},${z % 16}`] < y) {
            this.chunkData[chunkKey].heightMap[`${x % 16},${z % 16}`] = y;
        }
    },
    
    // Generate a report about the collected data
    generateVisualizationReport: function() {
        // Count regions and chunks
        const regionCount = Object.keys(this.blocksByRegion).length;
        const chunkCount = Object.keys(this.chunkData).length;
        
        // Find most populated regions
        const topRegions = Object.entries(this.blocksByRegion)
            .map(([key, region]) => {
                const blockCount = Object.values(region.blocks)
                    .reduce((sum, blocks) => sum + blocks.length, 0);
                return { key, x: region.x, y: region.y, z: region.z, blockCount };
            })
            .sort((a, b) => b.blockCount - a.blockCount)
            .slice(0, 5);
        
        // Find block type distribution
        const blockTypeDistribution = Object.entries(this.blocksByType)
            .map(([blockName, blocks]) => ({
                blockName,
                count: blocks.length,
                percentage: (blocks.length / this.totalBlockCount * 100).toFixed(2)
            }))
            .sort((a, b) => b.count - a.count);
        
        // Generate and return the report
        let report = '\n=== Block Visualization Data Report ===\n';
        report += `Total Blocks: ${this.totalBlockCount}\n`;
        report += `Unique Block Types: ${Object.keys(this.blocksByType).length}\n`;
        report += `Height Range: Y=${this.minHeight} to Y=${this.maxHeight}\n`;
        report += `Regions (16x16x16): ${regionCount}\n`;
        report += `Chunks (16x256x16): ${chunkCount}\n\n`;
        
        report += 'Top 5 Most Populated Regions:\n';
        topRegions.forEach((region, i) => {
            report += `${i+1}. Region (${region.x},${region.y},${region.z}): ${region.blockCount} blocks\n`;
        });
        
        report += '\nBlock Type Distribution (Top 10):\n';
        blockTypeDistribution.slice(0, 10).forEach((blockType, i) => {
            report += `${i+1}. ${blockType.blockName}: ${blockType.count} (${blockType.percentage}%)\n`;
        });
        
        return report;
    },
    
    // Export data for visualization or further processing
    exportData: function() {
        try {
            // Create a simplified version of the data for export
            return {
                metadata: {
                    totalBlocks: this.totalBlockCount,
                    uniqueBlockTypes: Object.keys(this.blocksByType).length,
                    heightRange: { min: this.minHeight, max: this.maxHeight }
                },
                blockTypeStats: Object.entries(this.blocksByType).map(([name, blocks]) => ({
                    name, count: blocks.length
                })),
                topBlocks: Object.entries(this.blocksByType)
                    .sort((a, b) => b[1].length - a[1].length)
                    .slice(0, 10)
                    .map(([name, blocks]) => ({
                        name,
                        count: blocks.length,
                        positions: blocks.slice(0, 1000)
                    }))
            };
        } catch (error) {
            console.error('Error exporting visualization data:', error);
            return null;
        }
    },
    
    reset: function() {
        this.blocksByType = {};
        this.blocksByRegion = {};
        this.chunkData = {};
        this.totalBlockCount = 0;
        this.maxHeight = 0;
        this.minHeight = 999;
    }
};

// Update the main function to use file.arrayBuffer() instead of readFileAsBuffer
async function testMinecraftWorldParsing(file) {
    try {
        // Reset statistics and mappings at start
        blockStatistics.reset();
        unmappedBlockTracker.reset();
        dynamicBlockMappings.clear();
        BlockDataCollector.reset();

        console.log('Reading world file:', file.name);
        const buffer = await file.arrayBuffer();
        
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
        
        // Print visualization data report
        console.log(BlockDataCollector.generateVisualizationReport());
        
        // Export visualization data
        const exportData = BlockDataCollector.exportData();
        console.log('Generated visualization data:', exportData);
        
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
                        const mask = (BigIntPolyfill(1) << BigIntPolyfill(bitsPerBlock)) - BigIntPolyfill(1);

                        let blockIndex = 0;
                        for (let i = 0; i < data.length; i++) {
                            let longValue;
                            if (Array.isArray(data[i])) {
                                longValue = (BigIntPolyfill(data[i][0]) << BigIntPolyfill(32)) | BigIntPolyfill(data[i][1]);
                            } else {
                                longValue = BigIntPolyfill(data[i]);
                            }

                            for (let j = 0; j < blocksPerLong && blockIndex < 4096; j++) {
                                const shiftAmount = BigIntPolyfill(j * bitsPerBlock);
                                const index = Number((longValue >> shiftAmount) & mask);
                                const block = palette[index % palette.length];
                                
                                // Extract block name and properties
                                let blockName, blockProperties = {};
                                
                                if (typeof block === 'string') {
                                    blockName = block;
                                } else {
                                    blockName = block.Name?.value || block.name?.value;
                                    
                                    // Extract block properties if available
                                    const propsObj = block.Properties?.value || block.properties?.value;
                                    if (propsObj) {
                                        for (const propKey in propsObj) {
                                            if (propsObj[propKey] && propsObj[propKey].value !== undefined) {
                                                blockProperties[propKey] = propsObj[propKey].value;
                                            }
                                        }
                                    }
                                }
                                
                                if (blockName && blockName !== 'minecraft:air') {
                                    const worldX = chunkX * 16 + (blockIndex % 16);
                                    const worldY = sectionY * 16 + Math.floor(blockIndex / 256);
                                    const worldZ = chunkZ * 16 + Math.floor((blockIndex % 256) / 16);
                                    
                                    // Track in BlockDataCollector for visualization
                                    BlockDataCollector.addBlock(blockName, worldX, worldY, worldZ, blockProperties);
                                    
                                    // Track in our existing statistics
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

// Add progress bar functions
function createProgressBar() {
    // Check if the progress bar already exists
    if (document.getElementById('minecraft-import-progress')) {
        return;
    }
    
    const progressContainer = document.createElement('div');
    progressContainer.id = 'minecraft-import-progress';
    progressContainer.style.position = 'fixed';
    progressContainer.style.top = '50%';
    progressContainer.style.left = '50%';
    progressContainer.style.transform = 'translate(-50%, -50%)';
    progressContainer.style.width = '300px';
    progressContainer.style.padding = '20px';
    progressContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    progressContainer.style.borderRadius = '8px';
    progressContainer.style.zIndex = '9999';
    
    const progressText = document.createElement('div');
    progressText.id = 'minecraft-import-progress-text';
    progressText.style.color = 'white';
    progressText.style.marginBottom = '10px';
    progressText.style.textAlign = 'center';
    progressText.textContent = 'Importing Minecraft World...';
    
    const progressBarOuter = document.createElement('div');
    progressBarOuter.style.width = '100%';
    progressBarOuter.style.height = '20px';
    progressBarOuter.style.backgroundColor = '#444';
    progressBarOuter.style.borderRadius = '4px';
    progressBarOuter.style.overflow = 'hidden';
    
    const progressBarInner = document.createElement('div');
    progressBarInner.id = 'minecraft-import-progress-bar';
    progressBarInner.style.width = '0%';
    progressBarInner.style.height = '100%';
    progressBarInner.style.backgroundColor = '#4CAF50';
    progressBarInner.style.transition = 'width 0.3s';
    
    progressBarOuter.appendChild(progressBarInner);
    progressContainer.appendChild(progressText);
    progressContainer.appendChild(progressBarOuter);
    
    document.body.appendChild(progressContainer);
}

function updateProgressBar(progress, message = null) {
    const progressBar = document.getElementById('minecraft-import-progress');
    const progressBarInner = document.getElementById('minecraft-import-progress-bar');
    const progressText = document.getElementById('minecraft-import-progress-text');
    
    if (!progressBar || !progressBarInner || !progressText) return;
    
    // Make sure progress bar is visible
    progressBar.style.display = 'block';
    
    // Update progress percentage
    const clampedProgress = Math.max(0, Math.min(100, progress));
    progressBarInner.style.width = `${clampedProgress}%`;
    
    // Update progress text if message provided
    if (message) {
        progressText.textContent = message;
    } else {
        progressText.textContent = `Importing... ${Math.round(clampedProgress)}%`;
    }
    
    // Hide progress bar when complete
    if (progress >= 100) {
        setTimeout(() => {
            progressBar.style.display = 'none';
            setTimeout(() => {
                progressBar.remove();
            }, 300);
        }, 1000);
    }
}

// Update importMinecraftWorld to not use fs/path
export async function importMinecraftWorld(file, terrainBuilderRef, environmentBuilderRef, mappingUrl = '/mapping.json', regionSelection = null) {
    try {
        // Reset statistics and mappings at start
        blockStatistics.reset();
        unmappedBlockTracker.reset();
        dynamicBlockMappings.clear();
        BlockDataCollector.reset();

        console.log('Reading world file:', file.name);
        const buffer = await file.arrayBuffer();
        
        // Load block mapping first
        const blockMapping = await loadBlockMapping(mappingUrl);
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
        
        // Print visualization data report
        console.log(BlockDataCollector.generateVisualizationReport());
        
        // Export visualization data
        const exportData = BlockDataCollector.exportData();
        console.log('Generated visualization data:', exportData);
        
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

        // Get the block data from BlockDataCollector
        const blockData = BlockDataCollector.blocksByType;
        const hytopiaMap = {
            blocks: {}
        };

        // Convert collected blocks to Hytopia format
        for (const [blockName, positions] of Object.entries(blockData)) {
            // Skip air blocks
            if (blockName === 'minecraft:air') continue;

            // Get Hytopia block ID
            let hytopiaBlockId;
            if (blockMapping.blocks && blockMapping.blocks[blockName]) {
                hytopiaBlockId = blockMapping.blocks[blockName].id;
            } else {
                const shortName = blockName.replace('minecraft:', '');
                const baseName = blockName.split('[')[0];
                
                if (blockMapping.blocks && blockMapping.blocks[`minecraft:${shortName}`]) {
                    hytopiaBlockId = blockMapping.blocks[`minecraft:${shortName}`].id;
                } else if (blockMapping.blocks && blockMapping.blocks[baseName]) {
                    hytopiaBlockId = blockMapping.blocks[baseName].id;
                } else {
                    hytopiaBlockId = getFallbackBlockId(blockName, blockMapping);
                }
            }

            // Add blocks to Hytopia map
            for (const pos of positions) {
                const key = `${pos.x},${pos.y},${pos.z}`;
                hytopiaMap.blocks[key] = hytopiaBlockId;
            }
        }

        // Save terrain data to IndexedDB
        await DatabaseManager.saveData(STORES.TERRAIN, "current", hytopiaMap.blocks);
        
        // Refresh terrain builder
        if (terrainBuilderRef && terrainBuilderRef.current) {
            await terrainBuilderRef.current.refreshTerrainFromDB();
        }
        
        console.log("Minecraft world import complete");
        
        return {
            success: true,
            blockCount: Object.keys(hytopiaMap.blocks).length,
            regionSelection: regionSelection
        };

    } catch (error) {
        console.error('Error importing Minecraft world:', error);
        throw error;
    }
}

// Add a preview function for the world selection modal
export async function previewMinecraftWorld(file) {
    try {
        console.log(`Previewing Minecraft world file: ${file.name}`);
        
        // Read the file as ArrayBuffer
        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        
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
                console.log(`Found level.dat at: ${path}`);
                break;
            }
        }
        
        if (!levelDatFile) {
            // Try finding any file ending with level.dat
            const levelDatMatch = Object.keys(zip.files).find(path => path.endsWith('level.dat'));
            if (levelDatMatch) {
                levelDatFile = zip.file(levelDatMatch);
                levelDatPath = levelDatMatch;
                console.log(`Found level.dat using general search at: ${levelDatMatch}`);
            }
        }
        
        if (!levelDatFile) {
            throw new Error('level.dat not found in world file');
        }
        
        // Extract and parse level.dat
        const levelDatBuffer = await levelDatFile.async('nodebuffer');
        const worldData = await parseNBTWithFallback(levelDatBuffer);
        
        // Extract world info
        const worldInfo = extractWorldInfo(worldData);
        
        return {
            success: true,
            worldInfo: {
                ...worldInfo,
                filePath: levelDatPath
            }
        };
    } catch (error) {
        console.error('Error previewing Minecraft world:', error);
        throw error;
    }
}

// Export other necessary functions and utilities
export {
    BlockDataCollector,
    loadBlockMapping,
    createProgressBar,
    updateProgressBar
}; 