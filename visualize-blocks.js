/**
 * Example Minecraft Block Data Visualizer
 * 
 * This script demonstrates how to use the extracted block data from the enhanced parser.
 * It generates an ASCII visualization of the height map and block distribution.
 * 
 * Usage: node visualize-blocks.js
 */

const fs = require('fs');
const path = require('path');

// Path to the visualization data JSON file
const dataPath = path.join(__dirname, 'output', 'visualization_data.json');

// Load visualization data
function loadVisualizationData() {
    try {
        if (!fs.existsSync(dataPath)) {
            console.error(`Error: Visualization data not found at ${dataPath}`);
            console.log('Please run the parser first to generate visualization data.');
            process.exit(1);
        }
        
        const rawData = fs.readFileSync(dataPath, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error loading visualization data:', error);
        process.exit(1);
    }
}

// Convert height map to ASCII art
function generateHeightMapVisualization(heightMapData) {
    // Get all chunk coordinates
    const chunks = Object.keys(heightMapData);
    if (chunks.length === 0) {
        return 'No height map data available';
    }
    
    // Find the bounds of the map
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    chunks.forEach(chunk => {
        const [x, z] = chunk.split(',').map(Number);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    });
    
    // Define characters for height representation
    const heightChars = ' .:-=+*#%@';
    
    // Generate ASCII map
    let asciiMap = '';
    for (let z = minZ; z <= maxZ; z++) {
        let line = '';
        for (let x = minX; x <= maxX; x++) {
            const chunkKey = `${x},${z}`;
            if (heightMapData[chunkKey]) {
                // Calculate average height for this chunk
                const heights = Object.values(heightMapData[chunkKey]);
                const avgHeight = heights.reduce((sum, h) => sum + h, 0) / heights.length;
                
                // Normalize to 0-9 range for our character set
                const normalizedHeight = Math.min(9, Math.floor(avgHeight / 16));
                line += heightChars[normalizedHeight];
            } else {
                line += ' '; // Empty chunk
            }
        }
        asciiMap += line + '\n';
    }
    
    return asciiMap;
}

// Generate a histogram of block heights
function generateHeightHistogram(blocksData) {
    // Extract top blocks
    const topBlocks = blocksData.topBlocks || [];
    if (topBlocks.length === 0) {
        return 'No block data available';
    }
    
    // Build histogram data for heights
    const heightBuckets = {};
    const bucketSize = 16; // Group heights by 16 blocks
    
    topBlocks.forEach(blockType => {
        blockType.positions.forEach(pos => {
            const bucketIndex = Math.floor(pos.y / bucketSize) * bucketSize;
            if (!heightBuckets[bucketIndex]) {
                heightBuckets[bucketIndex] = 0;
            }
            heightBuckets[bucketIndex]++;
        });
    });
    
    // Sort buckets by height
    const sortedBuckets = Object.entries(heightBuckets)
        .sort(([a], [b]) => Number(a) - Number(b));
    
    // Find max count for scaling
    const maxCount = Math.max(...Object.values(heightBuckets));
    const scale = 50; // Max bar length
    
    // Generate histogram
    let histogram = '\nHeight Distribution Histogram\n';
    histogram += '-----------------------------\n';
    
    sortedBuckets.forEach(([height, count]) => {
        const barLength = Math.max(1, Math.round((count / maxCount) * scale));
        const bar = '█'.repeat(barLength);
        histogram += `Y: ${height.padStart(3, ' ')}-${(Number(height) + bucketSize - 1).toString().padStart(3, ' ')} | ${bar} (${count})\n`;
    });
    
    return histogram;
}

// Main function
function visualizeBlockData() {
    console.log('Loading Minecraft world visualization data...');
    const data = loadVisualizationData();
    
    // Display basic metadata
    console.log('\n=== Minecraft World Block Data ===');
    console.log(`Total Blocks: ${data.metadata.totalBlocks}`);
    console.log(`Unique Block Types: ${data.metadata.uniqueBlockTypes}`);
    console.log(`Height Range: Y=${data.metadata.heightRange.min} to Y=${data.metadata.heightRange.max}`);
    
    // Display block type statistics
    console.log('\nMost Common Block Types:');
    data.blockTypeStats
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .forEach((block, index) => {
            console.log(`${index + 1}. ${block.name}: ${block.count} blocks`);
        });
    
    // Generate and display height histogram
    console.log(generateHeightHistogram(data));
    
    // Generate and display ASCII height map
    console.log('\nTop-down Height Map Visualization:');
    console.log('(Higher elevation = darker character)');
    console.log(generateHeightMapVisualization(data.heightMap));
    
    console.log('\nThis is a simple ASCII visualization. The exported JSON data can be used');
    console.log('with 3D visualization libraries to create more detailed renderings.');
}

// Run the visualization
visualizeBlockData(); 